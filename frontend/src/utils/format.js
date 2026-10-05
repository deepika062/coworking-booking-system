export const SPACE_TYPES = [
  { value: 'desk', label: 'Desk' },
  { value: 'meeting_room', label: 'Meeting room' },
  { value: 'private_office', label: 'Private office' },
];

export const typeLabel = (type) => SPACE_TYPES.find((t) => t.value === type)?.label || type;

/** Today's date (YYYY-MM-DD) in the business timezone, not the browser's. */
export function todayIn(timezone, offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(d); // en-CA => YYYY-MM-DD
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function prettyDate(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** All HH:mm slot boundaries between opening and closing time. */
export function timeOptions({ openingHour, closingHour, slotMinutes }) {
  const out = [];
  for (let m = openingHour * 60; m <= closingHour * 60; m += slotMinutes) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return out;
}
