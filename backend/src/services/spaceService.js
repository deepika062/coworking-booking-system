import { config } from '../config.js';
import { query, withTransaction } from '../db/pool.js';
import { AppError } from '../utils/AppError.js';
import { notifyBookingStatusChanged } from './notifier.js';
import { findBookingsByIds } from './bookingService.js';

const { timezone, openingHour, closingHour, slotMinutes } = config.business;
const hh = (h) => `${String(h).padStart(2, '0')}:00`;

const SPACE_COLUMNS = `s.id, s.name, s.type, s.capacity, s.amenities, s.description, s.location,
  s.created_at AS "createdAt", s.updated_at AS "updatedAt"`;

const SORTS = {
  name: 'lower(s.name) ASC',  
  capacity: 's.capacity ASC, lower(s.name) ASC',
  '-capacity': 's.capacity DESC, lower(s.name) ASC',
  newest: 's.created_at DESC',
};

// Escape LIKE wildcards so a search for "50%" matches literally.
const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listSpaces(filters) {
  const { q, type, minCapacity, maxCapacity, date, startTime, endTime, sort, page, limit } = filters;
  const params = [];
  const p = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  const where = ['s.deleted_at IS NULL'];

  if (q) {
    const term = p(`%${escapeLike(q)}%`);
    // Search by name OR by type ("meeting" matches meeting_room).
    where.push(`(s.name ILIKE ${term} OR replace(s.type, '_', ' ') ILIKE ${term})`);
  }
  if (type) where.push(`s.type = ${p(type)}`);
  if (minCapacity) where.push(`s.capacity >= ${p(minCapacity)}`);
  if (maxCapacity) where.push(`s.capacity <= ${p(maxCapacity)}`);

  if (date) {
    // Space must be free (no active booking, no maintenance) for the requested range.
    // With only a date, the range is the whole business day.
    const tz = p(timezone);
    const d = p(date);
    const range = `tstzrange((${d}::date + ${p(startTime || hh(openingHour))}::time) AT TIME ZONE ${tz},
                             (${d}::date + ${p(endTime || hh(closingHour))}::time) AT TIME ZONE ${tz}, '[)')`;
    where.push(`NOT EXISTS (SELECT 1 FROM bookings b
                 WHERE b.space_id = s.id AND b.status IN ('pending', 'approved')
                   AND tstzrange(b.start_at, b.end_at, '[)') && ${range})`);
    where.push(`NOT EXISTS (SELECT 1 FROM maintenance_windows m
                 WHERE m.space_id = s.id AND tstzrange(m.start_at, m.end_at, '[)') && ${range})`);
  }

  const whereSql = where.join(' AND ');
  const countRes = await query(`SELECT COUNT(*) AS total FROM spaces s WHERE ${whereSql}`, params);
  const total = countRes.rows[0].total;

  const offset = (page - 1) * limit;
  const dataRes = await query(
    `SELECT ${SPACE_COLUMNS} FROM spaces s WHERE ${whereSql}
      ORDER BY ${SORTS[sort] || SORTS.name}
      LIMIT ${p(limit)} OFFSET ${p(offset)}`,
    params,
  );

  return {
    data: dataRes.rows,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export async function getSpace(id) {
  const { rows } = await query(`SELECT ${SPACE_COLUMNS} FROM spaces s WHERE s.id = $1 AND s.deleted_at IS NULL`, [id]);
  if (!rows[0]) throw AppError.notFound('Space not found');
  return rows[0];
}

/**
 * Day view for one space: the business day split into fixed slots, each marked
 * free / pending / booked / maintenance / past, plus the raw busy blocks.
 * All slot math happens in PostgreSQL in the business timezone.
 */
export async function getAvailability(id, date) {
  const space = await getSpace(id);
  const slotsRes = await query(
    `WITH bounds AS (
       SELECT ($2::date + make_time($3, 0, 0)) AT TIME ZONE $5 AS open_at,
              ($2::date + make_time($4, 0, 0)) AT TIME ZONE $5 AS close_at
     ), slots AS (
       SELECT gs AS slot_start, gs + make_interval(mins => $6) AS slot_end
         FROM bounds,
              generate_series(open_at, close_at - make_interval(mins => $6), make_interval(mins => $6)) AS gs
     )
     SELECT to_char(sl.slot_start AT TIME ZONE $5, 'HH24:MI') AS "start",
            to_char(sl.slot_end AT TIME ZONE $5, 'HH24:MI') AS "end",
            CASE
              WHEN EXISTS (SELECT 1 FROM maintenance_windows m WHERE m.space_id = $1
                             AND tstzrange(m.start_at, m.end_at, '[)') && tstzrange(sl.slot_start, sl.slot_end, '[)'))
                THEN 'maintenance'
              WHEN EXISTS (SELECT 1 FROM bookings b WHERE b.space_id = $1 AND b.status = 'approved'
                             AND tstzrange(b.start_at, b.end_at, '[)') && tstzrange(sl.slot_start, sl.slot_end, '[)'))
                THEN 'booked'
              WHEN EXISTS (SELECT 1 FROM bookings b WHERE b.space_id = $1 AND b.status = 'pending'
                             AND tstzrange(b.start_at, b.end_at, '[)') && tstzrange(sl.slot_start, sl.slot_end, '[)'))
                THEN 'pending'
              WHEN sl.slot_start < now() THEN 'past'
              ELSE 'free'
            END AS status
       FROM slots sl
      ORDER BY sl.slot_start`,
    [id, date, openingHour, closingHour, timezone, slotMinutes],
  );

  // Busy blocks overlapping the day (no member identities - this endpoint is public).
  const blocksRes = await query(
    `WITH day AS (SELECT tstzrange($2::date::timestamp AT TIME ZONE $3,
                                   ($2::date + 1)::timestamp AT TIME ZONE $3, '[)') AS r)
     SELECT 'booking' AS kind, b.status, '' AS reason, b.start_at AS "startAt", b.end_at AS "endAt",
            to_char(b.start_at AT TIME ZONE $3, 'YYYY-MM-DD HH24:MI') AS "startLocal",
            to_char(b.end_at AT TIME ZONE $3, 'YYYY-MM-DD HH24:MI') AS "endLocal"
       FROM bookings b, day
      WHERE b.space_id = $1 AND b.status IN ('pending', 'approved')
        AND tstzrange(b.start_at, b.end_at, '[)') && day.r
     UNION ALL
     SELECT 'maintenance', NULL, m.reason, m.start_at, m.end_at,
            to_char(m.start_at AT TIME ZONE $3, 'YYYY-MM-DD HH24:MI'),
            to_char(m.end_at AT TIME ZONE $3, 'YYYY-MM-DD HH24:MI')
       FROM maintenance_windows m, day
      WHERE m.space_id = $1 AND tstzrange(m.start_at, m.end_at, '[)') && day.r
      ORDER BY "startAt"`,
    [id, date, timezone],
  );

  return {
    space,
    date,
    timezone,
    openingTime: hh(openingHour),
    closingTime: hh(closingHour),
    slotMinutes,
    slots: slotsRes.rows,
    blocks: blocksRes.rows,
  };
}

function rethrowDuplicateName(err) {
  if (err.code === '23505') throw AppError.conflict('A space with this name already exists', 'DUPLICATE_NAME');
  throw err;
}

export async function createSpace(input) {
  try {
    const { rows } = await query(
      `INSERT INTO spaces (name, type, capacity, amenities, description, location)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [input.name, input.type, input.capacity, input.amenities, input.description, input.location],
    );
    return getSpace(rows[0].id);
  } catch (err) {
    return rethrowDuplicateName(err);
  }
}

const UPDATABLE = ['name', 'type', 'capacity', 'amenities', 'description', 'location'];

export async function updateSpace(id, changes) {
  const params = [id];
  const sets = [];
  for (const key of UPDATABLE) {
    if (changes[key] !== undefined) {
      params.push(changes[key]);
      sets.push(`${key} = $${params.length}`);
    }
  }
  try {
    const { rowCount } = await query(
      `UPDATE spaces SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 AND deleted_at IS NULL`,
      params,
    );
    if (!rowCount) throw AppError.notFound('Space not found');
    return getSpace(id);
  } catch (err) {
    return rethrowDuplicateName(err);
  }
}

/**
 * Soft-deletes a space (history is kept) and cancels its future active bookings,
 * notifying the affected members.
 */
export async function deleteSpace(id) {
  const cancelledIds = await withTransaction(async (client) => {
    // FOR UPDATE blocks concurrent booking creation for this space until we're done.
    const { rows } = await client.query('SELECT id FROM spaces WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id]);
    if (!rows[0]) throw AppError.notFound('Space not found');
    await client.query('UPDATE spaces SET deleted_at = now(), updated_at = now() WHERE id = $1', [id]);
    const cancelled = await client.query(
      `UPDATE bookings
          SET status = 'cancelled', cancelled_at = now(), updated_at = now(),
              status_reason = 'The space has been removed'
        WHERE space_id = $1 AND status IN ('pending', 'approved') AND end_at > now()
        RETURNING id`,
      [id],
    );
    return cancelled.rows.map((r) => r.id);
  });

  const affected = await findBookingsByIds(cancelledIds);
  affected.forEach(notifyBookingStatusChanged);
  return { cancelledBookings: cancelledIds.length };
}
