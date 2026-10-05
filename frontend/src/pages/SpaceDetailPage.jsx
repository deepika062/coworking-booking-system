import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { errorMessage } from '../api/client.js';
import { bookingsApi, spacesApi } from '../api/endpoints.js';
import AvailabilityCalendar from '../components/AvailabilityCalendar.jsx';
import Spinner from '../components/Spinner.jsx';
import { useApp } from '../context/AppContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { addDays, prettyDate, todayIn, typeLabel } from '../utils/format.js';

export default function SpaceDetailPage() {
  const { id } = useParams();
  const { meta, toast } = useApp();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const today = todayIn(meta.timezone);
  const date = params.get('date') || today;

  const [availability, setAvailability] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Selected range. First click picks one slot; a second click on a later slot extends it.
  const [sel, setSel] = useState({ start: '', end: '', extending: false });
  const [purpose, setPurpose] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    return spacesApi
      .availability(id, date)
      .then(setAvailability)
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [id, date]);

  useEffect(() => {
    load();
    setSel({ start: '', end: '', extending: false });
    setFormError('');
  }, [load]);

  const setDate = (d) => setParams(d ? { date: d } : {}, { replace: true });

  const slots = availability?.slots || [];
  const allFree = (from, to) => slots.filter((s) => s.start >= from && s.end <= to).every((s) => s.status === 'free');

  const onSlotClick = (slot) => {
    setFormError('');
    if (sel.extending && slot.start >= sel.start && allFree(sel.start, slot.end)) {
      setSel({ start: sel.start, end: slot.end, extending: false });
    } else {
      setSel({ start: slot.start, end: slot.end, extending: true });
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError('');
    try {
      await bookingsApi.create({ spaceId: id, date, startTime: sel.start, endTime: sel.end, purpose });
      toast('Booking requested! It is pending admin approval.');
      setSel({ start: '', end: '', extending: false });
      setPurpose('');
    } catch (err) {
      // 409 BOOKING_CONFLICT here usually means someone else grabbed the slot a moment ago.
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
      load();
    }
  };

  if (loading && !availability) return <Spinner />;
  if (error && !availability) {
    return (
      <div className="container page">
        <div className="alert alert-error">{error}</div>
        <Link to="/">← Back to spaces</Link>
      </div>
    );
  }

  const { space } = availability;
  const maxDate = todayIn(meta.timezone, meta.maxAdvanceDays);

  return (
    <div className="container page">
      <Link to="/" className="muted small">
        ← All spaces
      </Link>
      <div className="page-head">
        <div>
          <h1>{space.name}</h1>
          <p className="muted">
            {typeLabel(space.type)} · up to {space.capacity} {space.capacity === 1 ? 'person' : 'people'}
            {space.location && ` · ${space.location}`}
          </p>
        </div>
      </div>

      <div className="detail-layout">
        <section className="card">
          <div className="calendar-head">
            <h2>Availability</h2>
            <div className="date-nav">
              <button className="btn btn-ghost btn-sm" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
                ‹
              </button>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
              <button className="btn btn-ghost btn-sm" onClick={() => setDate(addDays(date, 1))} aria-label="Next day">
                ›
              </button>
              {date !== today && (
                <button className="btn btn-ghost btn-sm" onClick={() => setDate('')}>
                  Today
                </button>
              )}
            </div>
          </div>
          <p className="muted small">
            {prettyDate(date)} · {availability.openingTime}–{availability.closingTime} ({availability.timezone})
            {loading && ' · refreshing…'}
          </p>
          <AvailabilityCalendar
            slots={slots}
            selStart={sel.start}
            selEnd={sel.end}
            onSlotClick={user ? onSlotClick : undefined}
          />
        </section>

        <aside className="card booking-panel">
          <h2>Book this space</h2>
          {!user ? (
            <p>
              <Link to="/login" state={{ from: `/spaces/${id}?date=${date}` }}>
                Log in
              </Link>{' '}
              or <Link to="/register">create an account</Link> to book.
            </p>
          ) : date > maxDate ? (
            <p className="muted">Bookings open {meta.maxAdvanceDays} days in advance.</p>
          ) : (
            <form onSubmit={submit}>
              {!sel.start ? (
                <p className="muted">Click a free slot to start. Click a later slot to extend the booking.</p>
              ) : (
                <div className="selection">
                  <strong>
                    {sel.start} – {sel.end}
                  </strong>
                  <span className="muted small">{prettyDate(date)}</span>
                  {sel.extending && <span className="muted small">Click a later free slot to extend.</span>}
                </div>
              )}
              <label className="field">
                <span>Purpose (optional)</span>
                <input value={purpose} maxLength={500} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Client call" />
              </label>
              {formError && <div className="alert alert-error">{formError}</div>}
              <button className="btn btn-primary btn-block" disabled={!sel.start || submitting}>
                {submitting ? 'Booking…' : 'Request booking'}
              </button>
              <p className="muted small">Requests are confirmed once an admin approves them.</p>
            </form>
          )}
          <hr />
          <h3>About</h3>
          {space.description && <p>{space.description}</p>}
          <ul className="chips">
            {space.amenities.map((a) => (
              <li key={a} className="chip">
                {a}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
