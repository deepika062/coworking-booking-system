/**
 * Integration tests against a real PostgreSQL database.
 * Requires TEST_DATABASE_URL (a throwaway DB - all tables are truncated!).
 *   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/coworking_test npm test
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import request from 'supertest';

if (!process.env.TEST_DATABASE_URL) {
  console.warn('TEST_DATABASE_URL not set - skipping integration tests');
  process.exit(0);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET ||= 'test-secret';
process.env.AUTH_RATE_LIMIT_MAX = '60';

const { createApp } = await import('../src/app.js');
const { migrate } = await import('../src/db/migrate.js');
const { seed } = await import('../src/db/seed.js');
const { pool } = await import('../src/db/pool.js');
const { sentNotifications } = await import('../src/services/notifier.js');

const app = createApp();
const api = () => request(app);

// A date safely in the future (2 days ahead) and one in the past, as YYYY-MM-DD.
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const FUTURE = day(2);
const PAST = day(-2);

let adminToken;
let memberToken;
let spaceId;

async function login(email, password) {
  const res = await api().post('/api/auth/login').send({ email, password });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data.accessToken;
}

async function registerMember(n) {
  const res = await api()
    .post('/api/auth/register')
    .send({ name: `Racer ${n}`, email: `racer${n}@test.dev`, password: 'Passw0rd!' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data.accessToken;
}

const book = (token, body) =>
  api()
    .post('/api/bookings')
    .set('Authorization', `Bearer ${token}`)
    .send({ spaceId, date: FUTURE, ...body });

before(async () => {
  await migrate({ log: () => {} });
  await pool.query('TRUNCATE maintenance_windows, bookings, refresh_tokens, spaces, users CASCADE');
  await seed({ log: () => {} });
  adminToken = await login('admin@cowork.test', 'Admin@123');
  memberToken = await login('member@cowork.test', 'Member@123');
  const { rows } = await pool.query("SELECT id FROM spaces WHERE name = 'Huddle Room'");
  spaceId = rows[0].id;
});

after(() => pool.end());

describe('errors & validation', () => {
  test('validation errors use the consistent JSON shape', async () => {
    const res = await api().post('/api/auth/register').send({ email: 'nope', password: 'short' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.ok(Array.isArray(res.body.error.details));
    assert.ok(res.body.error.details.some((d) => d.field === 'email'));
  });

  test('malformed JSON -> 400 INVALID_JSON', async () => {
    const res = await api().post('/api/auth/login').set('Content-Type', 'application/json').send('{bad');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_JSON');
  });

  test('unknown route -> 404 ROUTE_NOT_FOUND', async () => {
    const res = await api().get('/api/nope');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'ROUTE_NOT_FOUND');
  });
});

describe('auth', () => {
  test('duplicate email -> 409', async () => {
    const res = await api()
      .post('/api/auth/register')
      .send({ name: 'Dup', email: 'MEMBER@cowork.test', password: 'Passw0rd!' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'EMAIL_TAKEN');
  });

  test('wrong password -> 401', async () => {
    const res = await api().post('/api/auth/login').send({ email: 'member@cowork.test', password: 'wrong' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
  });

  test('refresh rotates the cookie; replaying an old token after the grace period is rejected', async () => {
    const agent = request.agent(app);
    const loginRes = await agent.post('/api/auth/login').send({ email: 'member@cowork.test', password: 'Member@123' });
    const firstCookie = loginRes.headers['set-cookie'][0];
    assert.match(firstCookie, /HttpOnly/);

    const refreshed = await agent.post('/api/auth/refresh');
    assert.equal(refreshed.status, 200);
    assert.ok(refreshed.body.data.accessToken);
    assert.notEqual(refreshed.headers['set-cookie'][0], firstCookie);

    // Pretend the first token was rotated long ago, then replay it -> reuse detected.
    await pool.query("UPDATE refresh_tokens SET revoked_at = now() - interval '1 hour' WHERE revoked_at IS NOT NULL");
    const replay = await api().post('/api/auth/refresh').set('Cookie', firstCookie.split(';')[0]);
    assert.equal(replay.status, 401);
    assert.equal(replay.body.error.code, 'REFRESH_TOKEN_REUSED');

    // ...and the whole family is revoked, so the agent's current token is dead too.
    const after = await agent.post('/api/auth/refresh');
    assert.equal(after.status, 401);
  });

  test('protected route without token -> 401, member on admin route -> 403', async () => {
    assert.equal((await api().get('/api/bookings/me')).status, 401);
    const res = await api().get('/api/admin/bookings').set('Authorization', `Bearer ${memberToken}`);
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  test('garbage token -> 401 INVALID_TOKEN', async () => {
    const res = await api().get('/api/auth/me').set('Authorization', 'Bearer abc.def.ghi');
    assert.equal(res.body.error.code, 'INVALID_TOKEN');
  });
});

describe('spaces', () => {
  test('pagination', async () => {
    const res = await api().get('/api/spaces?limit=5&page=2');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 5);
    assert.deepEqual(res.body.pagination, { page: 2, limit: 5, total: 12, totalPages: 3 });
  });

  test('search by name and by type, filter by type + capacity', async () => {
    const byName = await api().get('/api/spaces?q=board');
    assert.deepEqual(byName.body.data.map((s) => s.name), ['Board Room']);
    const byType = await api().get('/api/spaces?q=meeting');
    assert.equal(byType.body.pagination.total, 4);
    const filtered = await api().get('/api/spaces?type=meeting_room&minCapacity=10');
    assert.deepEqual(filtered.body.data.map((s) => s.name).sort(), ['Board Room', 'Conference Hall']);
  });

  test('bad filter -> 400', async () => {
    const res = await api().get('/api/spaces?type=castle');
    assert.equal(res.status, 400);
  });

  test('admin CRUD; members cannot create', async () => {
    const body = { name: 'Phone Booth', type: 'desk', capacity: 1, amenities: ['WiFi', 'WiFi'] };
    const denied = await api().post('/api/spaces').set('Authorization', `Bearer ${memberToken}`).send(body);
    assert.equal(denied.status, 403);

    const created = await api().post('/api/spaces').set('Authorization', `Bearer ${adminToken}`).send(body);
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.data.amenities, ['WiFi']);
    const id = created.body.data.id;

    const dup = await api().post('/api/spaces').set('Authorization', `Bearer ${adminToken}`).send(body);
    assert.equal(dup.status, 409);

    const updated = await api()
      .put(`/api/spaces/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ capacity: 2 });
    assert.equal(updated.body.data.capacity, 2);

    const del = await api().delete(`/api/spaces/${id}`).set('Authorization', `Bearer ${adminToken}`);
    assert.equal(del.status, 200);
    assert.equal((await api().get(`/api/spaces/${id}`)).status, 404);
  });
});

describe('bookings', () => {
  test('rejects past, out-of-hours, misaligned and reversed slots', async () => {
    const past = await book(memberToken, { date: PAST, startTime: '10:00', endTime: '11:00' });
    assert.equal(past.status, 400);
    assert.equal(past.body.error.code, 'PAST_BOOKING');

    for (const slot of [
      { startTime: '06:00', endTime: '07:00' },
      { startTime: '10:10', endTime: '11:00' },
      { startTime: '11:00', endTime: '10:00' },
    ]) {
      const res = await book(memberToken, slot);
      assert.equal(res.status, 400, JSON.stringify(slot));
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    }
  });

  test('CONCURRENCY: 15 members booking the same slot at once -> exactly one succeeds', async () => {
    const tokens = await Promise.all(Array.from({ length: 15 }, (_, i) => registerMember(i)));
    const results = await Promise.all(tokens.map((t) => book(t, { startTime: '09:00', endTime: '10:00' })));
    const statuses = results.map((r) => r.status);
    assert.equal(statuses.filter((s) => s === 201).length, 1, `statuses: ${statuses}`);
    assert.equal(statuses.filter((s) => s === 409).length, 14, `statuses: ${statuses}`);
    for (const r of results.filter((x) => x.status === 409)) assert.equal(r.body.error.code, 'BOOKING_CONFLICT');
  });

  test('the DB constraint itself rejects overlapping active rows (no app code involved)', async () => {
    const { rows } = await pool.query("SELECT id FROM users WHERE email = 'member@cowork.test'");
    const insert = (start, end) =>
      pool.query(
        `INSERT INTO bookings (space_id, user_id, start_at, end_at) VALUES ($1, $2, $3, $4)`,
        [spaceId, rows[0].id, `${FUTURE} ${start}+05:30`, `${FUTURE} ${end}+05:30`],
      );
    await assert.rejects(insert('09:30', '10:30'), (e) => e.code === '23P01');
  });

  test('partial overlap -> 409, back-to-back slot -> 201', async () => {
    const overlap = await book(memberToken, { startTime: '09:30', endTime: '10:30' });
    assert.equal(overlap.status, 409);
    const adjacent = await book(memberToken, { startTime: '10:00', endTime: '11:00', purpose: 'Sync' });
    assert.equal(adjacent.status, 201);
    assert.equal(adjacent.body.data.status, 'pending');
    assert.equal(adjacent.body.data.startTime, '10:00');
  });

  test('approve -> approved + notification; second approve -> 409', async () => {
    const created = await book(memberToken, { startTime: '12:00', endTime: '13:00' });
    const id = created.body.data.id;
    const sentBefore = sentNotifications.length;
    const approved = await api()
      .patch(`/api/admin/bookings/${id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(approved.status, 200);
    assert.equal(approved.body.data.booking.status, 'approved');
    assert.equal(sentNotifications.length, sentBefore + 1);
    assert.equal(sentNotifications.at(-1).subject, 'Booking approved');

    const again = await api().patch(`/api/admin/bookings/${id}/approve`).set('Authorization', `Bearer ${adminToken}`);
    assert.equal(again.status, 409);
  });

  test('auto-rejects overlapping pending bookings when one is approved', async () => {
    // The exclusion constraint normally prevents overlapping pending rows, so drop it briefly
    // to simulate the scenario and prove the approval logic handles it.
    const { rows } = await pool.query("SELECT id FROM users WHERE email = 'member@cowork.test'");
    await pool.query('ALTER TABLE bookings DROP CONSTRAINT bookings_no_overlap');
    try {
      const ins = await pool.query(
        `INSERT INTO bookings (space_id, user_id, start_at, end_at) VALUES
           ($1, $2, $3, $4), ($1, $2, $5, $6) RETURNING id`,
        [spaceId, rows[0].id, `${FUTURE} 15:00+05:30`, `${FUTURE} 16:00+05:30`, `${FUTURE} 15:30+05:30`, `${FUTURE} 16:30+05:30`],
      );
      const [a, b] = ins.rows.map((r) => r.id);
      const res = await api().patch(`/api/admin/bookings/${a}/approve`).set('Authorization', `Bearer ${adminToken}`);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.data.autoRejected.map((x) => x.id), [b]);
      assert.equal(res.body.data.autoRejected[0].status, 'rejected');
    } finally {
      await pool.query("DELETE FROM bookings WHERE start_at >= $1::timestamptz AND end_at <= $2::timestamptz AND space_id = $3",
        [`${FUTURE} 15:00+05:30`, `${FUTURE} 16:30+05:30`, spaceId]);
      await pool.query(`ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
        space_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&) WHERE (status IN ('pending', 'approved'))`);
    }
  });

  test('member sees own bookings, can cancel own, cannot cancel others', async () => {
    const mine = await api().get('/api/bookings/me').set('Authorization', `Bearer ${memberToken}`);
    assert.equal(mine.status, 200);
    assert.ok(mine.body.data.length >= 2);
    const target = mine.body.data.find((b) => b.status === 'pending');

    const otherToken = await registerMember('other');
    const forbidden = await api()
      .patch(`/api/bookings/${target.id}/cancel`)
      .set('Authorization', `Bearer ${otherToken}`);
    assert.equal(forbidden.status, 404);

    const cancelled = await api()
      .patch(`/api/bookings/${target.id}/cancel`)
      .set('Authorization', `Bearer ${memberToken}`);
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.data.status, 'cancelled');

    const twice = await api().patch(`/api/bookings/${target.id}/cancel`).set('Authorization', `Bearer ${memberToken}`);
    assert.equal(twice.status, 409);

    // The freed slot can be booked again.
    const rebook = await book(memberToken, { startTime: target.startTime, endTime: target.endTime });
    assert.equal(rebook.status, 201);
  });

  test('admin list filters by status / date / space', async () => {
    const res = await api()
      .get(`/api/admin/bookings?status=approved&date=${FUTURE}&spaceId=${spaceId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length >= 1);
    assert.ok(res.body.data.every((b) => b.status === 'approved' && b.date === FUTURE && b.spaceId === spaceId));
  });
});

describe('maintenance & availability', () => {
  test('maintenance: 409 over approved booking unless forced; pending ones auto-rejected', async () => {
    const pending = await book(memberToken, { startTime: '17:00', endTime: '18:00' });
    assert.equal(pending.status, 201);

    // 12:00-13:00 is approved (from an earlier test) -> conflict
    const conflict = await api()
      .post('/api/admin/maintenance')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ spaceId, start: `${FUTURE}T12:00`, end: `${FUTURE}T18:00`, reason: 'Painting' });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.code, 'MAINTENANCE_CONFLICT');
    assert.equal(conflict.body.error.details.length, 1);

    const forced = await api()
      .post('/api/admin/maintenance')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ spaceId, start: `${FUTURE}T12:00`, end: `${FUTURE}T18:00`, reason: 'Painting', force: true });
    assert.equal(forced.status, 201);
    const statuses = forced.body.data.affectedBookings.map((b) => b.status).sort();
    assert.deepEqual(statuses, ['cancelled', 'rejected']);

    const blocked = await book(memberToken, { startTime: '14:00', endTime: '15:00' });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.code, 'MAINTENANCE_CONFLICT');
  });

  test('availability marks slots and filters spaces by free time', async () => {
    const res = await api().get(`/api/spaces/${spaceId}/availability?date=${FUTURE}`);
    assert.equal(res.status, 200);
    const at = (t) => res.body.data.slots.find((s) => s.start === t).status;
    assert.equal(res.body.data.slots.length, 24); // 08:00-20:00 in 30-min slots
    assert.equal(at('08:00'), 'free');
    assert.equal(at('09:00'), 'pending');
    assert.equal(at('12:30'), 'maintenance');

    const free = await api().get(`/api/spaces?date=${FUTURE}&startTime=09:00&endTime=10:00&q=huddle`);
    assert.equal(free.body.pagination.total, 0);
    const freeLater = await api().get(`/api/spaces?date=${FUTURE}&startTime=18:00&endTime=19:00&q=huddle`);
    assert.equal(freeLater.body.pagination.total, 1);
  });
});

describe('rate limiting', () => {
  test('login is rate limited -> 429 RATE_LIMITED', async () => {
    let last;
    for (let i = 0; i < 70; i++) {
      last = await api().post('/api/auth/login').send({ email: 'x@y.dev', password: 'nope' });
      if (last.status === 429) break;
    }
    assert.equal(last.status, 429);
    assert.equal(last.body.error.code, 'RATE_LIMITED');
  });
});
