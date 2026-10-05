import { z } from 'zod';
import { config } from './config.js';

const { openingHour, closingHour, slotMinutes } = config.business;

export const SPACE_TYPES = ['desk', 'meeting_room', 'private_office'];
export const BOOKING_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];

// Query-string params arrive as strings; treat "" as "not provided" so `?type=` doesn't fail.
const blankToUndefined = (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const opt = (schema) => z.preprocess(blankToUndefined, schema.optional());

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, 'Not a real calendar date');

export const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be a time in HH:mm (24h) format');

// "YYYY-MM-DDTHH:mm" - exactly what an <input type="datetime-local"> produces.
const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, 'Must be a local date-time in YYYY-MM-DDTHH:mm format')
  .refine((s) => dateString.safeParse(s.slice(0, 10)).success, 'Not a real calendar date');

const page = z.coerce.number().int().min(1).default(1);
const limit = (def, max) => z.coerce.number().int().min(1).max(max).default(def);

export const idParam = z.object({ id: z.string().uuid('Invalid id') });

// ---------- auth ----------
export const registerBody = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  email: z.string().trim().toLowerCase().email('Invalid email address').max(254),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be at most 72 characters') // bcrypt only uses the first 72 bytes
    .regex(/[A-Za-z]/, 'Password must contain a letter')
    .regex(/\d/, 'Password must contain a number'),
});

export const loginBody = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

// ---------- spaces ----------
const amenities = z
  .array(z.string().trim().min(1).max(40))
  .max(20)
  .transform((list) => [...new Set(list)]);

export const createSpaceBody = z.object({
  name: z.string().trim().min(2).max(80),
  type: z.enum(SPACE_TYPES),
  capacity: z.number().int().min(1).max(500),
  amenities: amenities.default([]),
  description: z.string().trim().max(1000).default(''),
  location: z.string().trim().max(120).default(''),
});

export const updateSpaceBody = z
  .object({
    name: z.string().trim().min(2).max(80),
    type: z.enum(SPACE_TYPES),
    capacity: z.number().int().min(1).max(500),
    amenities,
    description: z.string().trim().max(1000),
    location: z.string().trim().max(120),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'Provide at least one field to update');

export const listSpacesQuery = z
  .object({
    q: opt(z.string().trim().max(100)),
    type: opt(z.enum(SPACE_TYPES)),
    minCapacity: opt(z.coerce.number().int().min(1)),
    maxCapacity: opt(z.coerce.number().int().min(1)),
    // Availability filter: only return spaces free for this date (+ optional time range).
    date: opt(dateString),
    startTime: opt(timeString),
    endTime: opt(timeString),
    sort: opt(z.enum(['name', 'capacity', '-capacity', 'newest'])).default('name'),
    page,
    limit: limit(9, 50),
  })
  .superRefine((q, ctx) => {
    if ((q.startTime || q.endTime) && !q.date) {
      ctx.addIssue({ code: 'custom', path: ['date'], message: 'date is required when filtering by time' });
    }
    if ((q.startTime && !q.endTime) || (!q.startTime && q.endTime)) {
      ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'Provide both startTime and endTime' });
    }
    if (q.startTime && q.endTime && q.startTime >= q.endTime) {
      ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'endTime must be after startTime' });
    }
    if (q.minCapacity && q.maxCapacity && q.minCapacity > q.maxCapacity) {
      ctx.addIssue({ code: 'custom', path: ['maxCapacity'], message: 'maxCapacity must be >= minCapacity' });
    }
  });

export const availabilityQuery = z.object({ date: dateString });

// ---------- bookings ----------
export const createBookingBody = z
  .object({
    spaceId: z.string().uuid('Invalid spaceId'),
    date: dateString,
    startTime: timeString,
    endTime: timeString,
    purpose: z.string().trim().max(500).default(''),
  })
  .superRefine((b, ctx) => {
    const start = toMinutes(b.startTime);
    const end = toMinutes(b.endTime);
    if (end <= start) {
      ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'endTime must be after startTime' });
    }
    if (start < openingHour * 60 || end > closingHour * 60) {
      ctx.addIssue({
        code: 'custom',
        path: ['startTime'],
        message: `Bookings must be within opening hours (${String(openingHour).padStart(2, '0')}:00-${String(closingHour).padStart(2, '0')}:00)`,
      });
    }
    if (start % slotMinutes !== 0 || end % slotMinutes !== 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['startTime'],
        message: `Times must align to ${slotMinutes}-minute slots`,
      });
    }
  });

export const myBookingsQuery = z.object({
  status: opt(z.enum(BOOKING_STATUSES)),
  when: opt(z.enum(['upcoming', 'past'])),
  page,
  limit: limit(10, 50),
});

export const adminBookingsQuery = z.object({
  status: opt(z.enum(BOOKING_STATUSES)),
  spaceId: opt(z.string().uuid('Invalid spaceId')),
  date: opt(dateString),
  q: opt(z.string().trim().max(100)), // member name / email
  page,
  limit: limit(10, 100),
});

export const decisionBody = z.object({
  reason: z.string().trim().max(300).optional(),
});

// ---------- maintenance ----------
export const createMaintenanceBody = z
  .object({
    spaceId: z.string().uuid('Invalid spaceId'),
    start: localDateTime,
    end: localDateTime,
    reason: z.string().trim().max(300).default(''),
    // Approved bookings in the window block creation unless the admin explicitly forces it.
    force: z.boolean().default(false),
  })
  .refine((m) => m.end > m.start, { path: ['end'], message: 'end must be after start' });

export const listMaintenanceQuery = z.object({
  spaceId: opt(z.string().uuid('Invalid spaceId')),
  includePast: opt(z.enum(['true', 'false'])).transform((v) => v === 'true'),
});
