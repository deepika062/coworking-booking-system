import { config } from '../config.js';
import { query, withTransaction } from '../db/pool.js';
import { AppError } from '../utils/AppError.js';
import { findBookingsByIds } from './bookingService.js';
import { notifyBookingStatusChanged } from './notifier.js';

const { timezone } = config.business;

const MAINTENANCE_SELECT = `
  SELECT m.id, m.space_id AS "spaceId", s.name AS "spaceName", m.reason,
         m.start_at AS "startAt", m.end_at AS "endAt",
         to_char(m.start_at AT TIME ZONE $1, 'YYYY-MM-DD"T"HH24:MI') AS "start",
         to_char(m.end_at AT TIME ZONE $1, 'YYYY-MM-DD"T"HH24:MI') AS "end",
         m.created_at AS "createdAt"
    FROM maintenance_windows m
    JOIN spaces s ON s.id = m.space_id`;

export async function listMaintenance({ spaceId, includePast }) {
  const params = [timezone];
  const where = ['s.deleted_at IS NULL'];
  if (spaceId) {
    params.push(spaceId);
    where.push(`m.space_id = $${params.length}`);
  }
  if (!includePast) where.push('m.end_at > now()');
  const { rows } = await query(`${MAINTENANCE_SELECT} WHERE ${where.join(' AND ')} ORDER BY m.start_at`, params);
  return rows;
}

/**
 * Block a space for a time range. In one transaction:
 *  - lock the space row FOR UPDATE (waits for in-flight booking inserts, which hold FOR SHARE,
 *    and blocks new ones until we commit - so no booking can sneak into the window);
 *  - refuse if approved bookings overlap, unless `force` (then they are cancelled);
 *  - auto-reject overlapping pending requests.
 */
export async function createMaintenance(admin, { spaceId, start, end, reason, force }) {
  const result = await withTransaction(async (client) => {
    const space = await client.query('SELECT id FROM spaces WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [
      spaceId,
    ]);
    if (!space.rows[0]) throw AppError.notFound('Space not found');

    const { rows: [range] } = await client.query(
      `SELECT $1::timestamp AT TIME ZONE $3 AS start_at, $2::timestamp AT TIME ZONE $3 AS end_at,
              ($2::timestamp AT TIME ZONE $3) <= now() AS in_past`,
      [start, end, timezone],
    );
    if (range.in_past) throw new AppError(400, 'PAST_WINDOW', 'Maintenance window must end in the future');

    const approved = await client.query(
      `SELECT id FROM bookings
        WHERE space_id = $1 AND status = 'approved' AND end_at > now()
          AND tstzrange(start_at, end_at, '[)') && tstzrange($2, $3, '[)')`,
      [spaceId, range.start_at, range.end_at],
    );
    if (approved.rows.length && !force) {
      const conflicts = await findBookingsByIds(
        approved.rows.map((r) => r.id),
        client,
      );
      throw AppError.conflict(
        `${conflicts.length} approved booking(s) overlap this window. Resend with "force": true to cancel them.`,
        'MAINTENANCE_CONFLICT',
        conflicts.map((b) => ({ id: b.id, userName: b.userName, date: b.date, startTime: b.startTime, endTime: b.endTime })),
      );
    }

    const inserted = await client.query(
      `INSERT INTO maintenance_windows (space_id, start_at, end_at, reason, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [spaceId, range.start_at, range.end_at, reason, admin.id],
    );

    const affected = await client.query(
      `UPDATE bookings
          SET status = CASE WHEN status = 'pending' THEN 'rejected' ELSE 'cancelled' END,
              cancelled_at = CASE WHEN status = 'approved' THEN now() ELSE cancelled_at END,
              decided_by = $4, decided_at = now(), updated_at = now(),
              status_reason = 'Space unavailable due to maintenance'
        WHERE space_id = $1 AND status IN ('pending', 'approved') AND end_at > now()
          AND tstzrange(start_at, end_at, '[)') && tstzrange($2, $3, '[)')
        RETURNING id`,
      [spaceId, range.start_at, range.end_at, admin.id],
    );
    return { id: inserted.rows[0].id, affectedIds: affected.rows.map((r) => r.id) };
  });

  const affected = await findBookingsByIds(result.affectedIds);
  affected.forEach(notifyBookingStatusChanged);
  const { rows } = await query(`${MAINTENANCE_SELECT} WHERE m.id = $2`, [timezone, result.id]);
  return { maintenance: rows[0], affectedBookings: affected };
}

export async function deleteMaintenance(id) {
  const { rowCount } = await query('DELETE FROM maintenance_windows WHERE id = $1', [id]);
  if (!rowCount) throw AppError.notFound('Maintenance window not found');
}
