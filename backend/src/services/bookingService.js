import { config } from '../config.js';
import { query, withTransaction } from '../db/pool.js';
import { AppError } from '../utils/AppError.js';
import { notifyBookingCreated, notifyBookingStatusChanged } from './notifier.js';

const { timezone, maxAdvanceDays } = config.business;

/**
 * Shared projection for bookings. $1 is always the business timezone so we can return the
 * wall-clock date/time the member actually picked, alongside the absolute UTC instants.
 */
const BOOKING_SELECT = `
  SELECT b.id, b.space_id AS "spaceId", s.name AS "spaceName", s.type AS "spaceType",
         b.user_id AS "userId", u.name AS "userName", u.email AS "userEmail",
         b.start_at AS "startAt", b.end_at AS "endAt",
         to_char(b.start_at AT TIME ZONE $1, 'YYYY-MM-DD') AS "date",
         to_char(b.start_at AT TIME ZONE $1, 'HH24:MI') AS "startTime",
         to_char(b.end_at AT TIME ZONE $1, 'HH24:MI') AS "endTime",
         b.status, b.purpose, b.status_reason AS "statusReason",
         b.decided_at AS "decidedAt", b.cancelled_at AS "cancelledAt", b.created_at AS "createdAt",
         (b.start_at > now()) AS "isUpcoming"
    FROM bookings b
    JOIN spaces s ON s.id = b.space_id
    JOIN users u ON u.id = b.user_id`;

export async function findBookingsByIds(ids, db = { query }) {
  if (!ids.length) return [];
  const { rows } = await db.query(`${BOOKING_SELECT} WHERE b.id = ANY($2::uuid[]) ORDER BY b.start_at`, [
    timezone,
    ids,
  ]);
  return rows;
}

async function findBooking(id, db) {
  const [booking] = await findBookingsByIds([id], db);
  return booking;
}

const OVERLAP_ACTIVE = `
  space_id = $1 AND status IN ('pending', 'approved')
  AND tstzrange(start_at, end_at, '[)') && tstzrange($2, $3, '[)')`;

/**
 * Create a booking request (status = pending).
 *
 * Concurrency safety, in layers:
 *  1. The `bookings_no_overlap` EXCLUDE constraint makes PostgreSQL itself reject a second
 *     pending/approved booking whose range overlaps, even if both INSERTs run at the same
 *     instant. The loser gets SQLSTATE 23P01, mapped to HTTP 409 BOOKING_CONFLICT.
 *  2. Maintenance windows live in another table, which a constraint can't cover, so we take
 *     a FOR SHARE lock on the space row. Maintenance creation takes FOR UPDATE on the same
 *     row, so "check maintenance -> insert booking" can't interleave with a new window.
 *     (FOR SHARE locks don't block each other, so bookings for one space still run in parallel.)
 */
export async function createBooking(user, input) {
  const bookingId = await withTransaction(async (client) => {
    const space = await client.query('SELECT id FROM spaces WHERE id = $1 AND deleted_at IS NULL FOR SHARE', [
      input.spaceId,
    ]);
    if (!space.rows[0]) throw AppError.notFound('Space not found');

    // Convert the member's wall-clock choice into absolute instants in the business timezone.
    const { rows: [slot] } = await client.query(
      `SELECT ($1::date + $2::time) AT TIME ZONE $4 AS start_at,
              ($1::date + $3::time) AT TIME ZONE $4 AS end_at,
              (($1::date + $2::time) AT TIME ZONE $4) <= now() AS in_past,
              $1::date > (now() AT TIME ZONE $4)::date + $5::int AS too_far`,
      [input.date, input.startTime, input.endTime, timezone, maxAdvanceDays],
    );
    if (slot.in_past) throw new AppError(400, 'PAST_BOOKING', 'Cannot book a time slot in the past');
    if (slot.too_far) {
      throw new AppError(400, 'TOO_FAR_AHEAD', `Bookings can be made at most ${maxAdvanceDays} days in advance`);
    }

    const maintenance = await client.query(
      `SELECT 1 FROM maintenance_windows
        WHERE space_id = $1 AND tstzrange(start_at, end_at, '[)') && tstzrange($2, $3, '[)') LIMIT 1`,
      [input.spaceId, slot.start_at, slot.end_at],
    );
    if (maintenance.rows[0]) {
      throw AppError.conflict('The space is under maintenance during this time', 'MAINTENANCE_CONFLICT');
    }

    // Friendly pre-check. NOT what guarantees correctness (two requests can both pass it);
    // the EXCLUDE constraint on the INSERT below is.
    const existing = await client.query(`SELECT 1 FROM bookings WHERE ${OVERLAP_ACTIVE} LIMIT 1`, [
      input.spaceId,
      slot.start_at,
      slot.end_at,
    ]);
    if (existing.rows[0]) {
      throw AppError.conflict('This time slot overlaps an existing booking for this space', 'BOOKING_CONFLICT');
    }

    const inserted = await client.query(
      `INSERT INTO bookings (space_id, user_id, start_at, end_at, purpose)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [input.spaceId, user.id, slot.start_at, slot.end_at, input.purpose],
    );
    return inserted.rows[0].id;
  });

  const booking = await findBooking(bookingId);
  notifyBookingCreated(booking);
  return booking;
}

function paginate(rows, total, page, limit) {
  return { data: rows, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

export async function listMyBookings(userId, { status, when, page, limit }) {
  const params = [timezone, userId];
  const where = ['b.user_id = $2'];
  if (status) {
    params.push(status);
    where.push(`b.status = $${params.length}`);
  }
  if (when === 'upcoming') where.push('b.end_at > now()');
  if (when === 'past') where.push('b.end_at <= now()');
  const whereSql = where.join(' AND ');

  const count = await query(`SELECT COUNT(*) AS total FROM (${BOOKING_SELECT} WHERE ${whereSql}) x`, params);
  // Upcoming first (soonest at the top), then past (most recent first).
  const { rows } = await query(
    `${BOOKING_SELECT} WHERE ${whereSql}
      ORDER BY (b.end_at > now()) DESC,
               CASE WHEN b.end_at > now() THEN b.start_at END ASC,
               b.start_at DESC
      LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    params,
  );
  return paginate(rows, count.rows[0].total, page, limit);
}

export async function listAllBookings({ status, spaceId, date, q, page, limit }) {
  const params = [timezone];
  const p = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  const where = ['TRUE'];
  if (status) where.push(`b.status = ${p(status)}`);
  if (spaceId) where.push(`b.space_id = ${p(spaceId)}`);
  if (date) {
    // Any booking that overlaps the given calendar day (in the business timezone).
    const d = p(date);
    where.push(`b.start_at < (${d}::date + 1)::timestamp AT TIME ZONE $1
            AND b.end_at > ${d}::date::timestamp AT TIME ZONE $1`);
  }
  if (q) {
    const term = p(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`(u.name ILIKE ${term} OR u.email ILIKE ${term})`);
  }
  const whereSql = where.join(' AND ');

  const count = await query(`SELECT COUNT(*) AS total FROM (${BOOKING_SELECT} WHERE ${whereSql}) x`, params);
  // Pending requests are shown oldest-request-first (a fair approval queue); others by date.
  const order = status === 'pending' ? 'b.created_at ASC' : 'b.start_at DESC';
  const { rows } = await query(
    `${BOOKING_SELECT} WHERE ${whereSql} ORDER BY ${order} LIMIT ${p(limit)} OFFSET ${p((page - 1) * limit)}`,
    params,
  );
  return paginate(rows, count.rows[0].total, page, limit);
}

/** Member cancels their own pending/approved booking that hasn't started yet. */
export async function cancelBooking(user, bookingId) {
  // A single conditional UPDATE is atomic: it can't race with an approve/reject because
  // the row lock taken by UPDATE serialises them, and the WHERE re-checks the status.
  const { rowCount } = await query(
    `UPDATE bookings
        SET status = 'cancelled', cancelled_at = now(), updated_at = now(), status_reason = 'Cancelled by member'
      WHERE id = $1 AND user_id = $2 AND status IN ('pending', 'approved') AND start_at > now()`,
    [bookingId, user.id],
  );

  const booking = await findBooking(bookingId);
  // Treat other members' bookings as "not found" so we don't leak their existence.
  if (!booking || booking.userId !== user.id) throw AppError.notFound('Booking not found');
  if (!rowCount) {
    if (!['pending', 'approved'].includes(booking.status)) {
      throw AppError.conflict(`A ${booking.status} booking cannot be cancelled`, 'INVALID_STATUS');
    }
    throw AppError.conflict('Only future bookings can be cancelled', 'BOOKING_STARTED');
  }
  notifyBookingStatusChanged(booking);
  return booking;
}

/**
 * Admin approves a pending booking. Any OTHER pending booking for the same space that
 * overlaps is auto-rejected in the same transaction.
 *
 * Note: the EXCLUDE constraint already prevents two overlapping *active* bookings from
 * coexisting, so in practice that set is empty. The auto-reject step is kept as an explicit,
 * self-documenting business rule (and protects us if the constraint is ever relaxed, e.g. to
 * let several pending requests compete for one slot).
 */
export async function approveBooking(admin, bookingId) {
  const { autoRejectedIds } = await withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT id, space_id, start_at, end_at, status FROM bookings WHERE id = $1 FOR UPDATE',
      [bookingId],
    );
    const b = rows[0];
    if (!b) throw AppError.notFound('Booking not found');
    if (b.status !== 'pending') throw AppError.conflict(`Booking is already ${b.status}`, 'INVALID_STATUS');
    if (b.start_at <= new Date()) {
      throw AppError.conflict('Cannot approve a booking whose start time has passed', 'BOOKING_STARTED');
    }

    await client.query(
      `UPDATE bookings SET status = 'approved', decided_by = $2, decided_at = now(), updated_at = now(),
              status_reason = NULL
        WHERE id = $1`,
      [bookingId, admin.id],
    );
    const rejected = await client.query(
      `UPDATE bookings
          SET status = 'rejected', decided_by = $4, decided_at = now(), updated_at = now(),
              status_reason = 'Auto-rejected: overlaps an approved booking'
        WHERE space_id = $1 AND status = 'pending' AND id <> $5
          AND tstzrange(start_at, end_at, '[)') && tstzrange($2, $3, '[)')
        RETURNING id`,
      [b.space_id, b.start_at, b.end_at, admin.id, bookingId],
    );
    return { autoRejectedIds: rejected.rows.map((r) => r.id) };
  });

  const byId = new Map((await findBookingsByIds([bookingId, ...autoRejectedIds])).map((x) => [x.id, x]));
  const booking = byId.get(bookingId);
  const autoRejected = autoRejectedIds.map((id) => byId.get(id));
  notifyBookingStatusChanged(booking);
  autoRejected.forEach(notifyBookingStatusChanged);
  return { booking, autoRejected };
}

export async function rejectBooking(admin, bookingId, reason) {
  const { rowCount } = await query(
    `UPDATE bookings SET status = 'rejected', decided_by = $2, decided_at = now(), updated_at = now(),
            status_reason = $3
      WHERE id = $1 AND status = 'pending'`,
    [bookingId, admin.id, reason || 'Rejected by admin'],
  );
  const booking = await findBooking(bookingId);
  if (!booking) throw AppError.notFound('Booking not found');
  if (!rowCount) throw AppError.conflict(`Booking is already ${booking.status}`, 'INVALID_STATUS');
  notifyBookingStatusChanged(booking);
  return booking;
}
