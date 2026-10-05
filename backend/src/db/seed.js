import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { migrate } from './migrate.js';
import { pool } from './pool.js';

const USERS = [
  { name: 'Admin', email: 'admin@cowork.test', password: 'Admin@123', role: 'admin' },
  { name: 'Asha Member', email: 'member@cowork.test', password: 'Member@123', role: 'member' },
  { name: 'Ravi Member', email: 'member2@cowork.test', password: 'Member@123', role: 'member' },
];

const SPACES = [
  ['Hot Desk A1', 'desk', 1, ['WiFi', 'Power outlet', 'Monitor'], 'Window-side desk in the open area.', 'Floor 1'],
  ['Hot Desk A2', 'desk', 1, ['WiFi', 'Power outlet'], 'Quiet corner desk.', 'Floor 1'],
  ['Hot Desk A3', 'desk', 1, ['WiFi', 'Power outlet', 'Standing desk'], 'Sit/stand desk.', 'Floor 1'],
  ['Hot Desk B1', 'desk', 1, ['WiFi', 'Power outlet', 'Monitor', 'Locker'], 'Near the cafe.', 'Floor 2'],
  ['Hot Desk B2', 'desk', 1, ['WiFi', 'Locker'], 'Near the cafe.', 'Floor 2'],
  ['Focus Pod', 'desk', 1, ['WiFi', 'Soundproof', 'Power outlet'], 'Enclosed single-person pod.', 'Floor 2'],
  ['Huddle Room', 'meeting_room', 4, ['WiFi', 'TV screen', 'Whiteboard'], 'Small room for quick syncs.', 'Floor 1'],
  ['Board Room', 'meeting_room', 12, ['WiFi', 'Projector', 'Video conferencing', 'Whiteboard'], 'Large room for client meetings.', 'Floor 3'],
  ['Brainstorm Room', 'meeting_room', 6, ['WiFi', 'Whiteboard', 'Sticky notes'], 'Walls you can write on.', 'Floor 2'],
  ['Conference Hall', 'meeting_room', 30, ['WiFi', 'Projector', 'Microphone', 'Stage'], 'Events and all-hands.', 'Floor 3'],
  ['Private Office 1', 'private_office', 3, ['WiFi', 'Lockable door', 'Monitor'], 'Small team office.', 'Floor 2'],
  ['Private Office 2', 'private_office', 6, ['WiFi', 'Lockable door', 'Whiteboard', 'TV screen'], 'Team office with a view.', 'Floor 3'],
];

/** Idempotent: safe to run on every start. Existing users/spaces are left untouched. */
export async function seed({ log = console.log } = {}) {
  for (const u of USERS) {
    const hash = await bcrypt.hash(u.password, 10);
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)
       ON CONFLICT ((lower(email))) DO NOTHING`,
      [u.name, u.email, hash, u.role],
    );
  }
  for (const [name, type, capacity, amenities, description, location] of SPACES) {
    await pool.query(
      `INSERT INTO spaces (name, type, capacity, amenities, description, location)
       SELECT $1, $2, $3, $4, $5, $6
        WHERE NOT EXISTS (SELECT 1 FROM spaces WHERE lower(name) = lower($1) AND deleted_at IS NULL)`,
      [name, type, capacity, amenities, description, location],
    );
  }
  log(`[seed] ensured ${USERS.length} users and ${SPACES.length} spaces`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate()
    .then(() => seed())
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
