/**
 * Notification stub. In production this would enqueue an email (SES / SendGrid / etc.).
 * Here it logs a would-be email so reviewers can see status-change notifications in the
 * backend logs, and keeps the last few in memory for tests.
 *
 * It is always called AFTER the transaction commits, so we never "email" about a change
 * that was rolled back.
 */
const MAX_KEPT = 100;
export const sentNotifications = [];

function send({ to, subject, text }) {
  const message = { to, subject, text, sentAt: new Date().toISOString() };
  sentNotifications.push(message);
  if (sentNotifications.length > MAX_KEPT) sentNotifications.shift();
  if (process.env.NODE_ENV !== 'test') {
    console.log(`[email-stub] to=${to} subject="${subject}" | ${text}`);
  }
}

const describe = (b) => `${b.spaceName} on ${b.date} ${b.startTime}-${b.endTime}`;

export function notifyBookingCreated(booking) {
  send({
    to: booking.userEmail,
    subject: 'Booking request received',
    text: `Your request for ${describe(booking)} is pending admin approval.`,
  });
}

export function notifyBookingStatusChanged(booking) {
  const reason = booking.statusReason ? ` Reason: ${booking.statusReason}` : '';
  send({
    to: booking.userEmail,
    subject: `Booking ${booking.status}`,
    text: `Your booking for ${describe(booking)} is now ${booking.status.toUpperCase()}.${reason}`,
  });
}
