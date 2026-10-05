import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../api/client.js';
import { bookingsApi } from '../api/endpoints.js';
import Pagination from '../components/Pagination.jsx';
import Spinner from '../components/Spinner.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { useApp } from '../context/AppContext.jsx';
import { prettyDate, typeLabel } from '../utils/format.js';

const TABS = [
  ['upcoming', 'Upcoming'],
  ['past', 'Past'],
  ['', 'All'],
];

export default function MyBookingsPage() {
  const { toast } = useApp();
  const [when, setWhen] = useState('upcoming');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ data: [], pagination: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    return bookingsApi
      .mine({ when, status, page, limit: 10 })
      .then(setResult)
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [when, status, page]);

  useEffect(() => {
    load();
  }, [load]);

  const cancel = async (b) => {
    if (!window.confirm(`Cancel your booking for ${b.spaceName} on ${prettyDate(b.date)} ${b.startTime}–${b.endTime}?`)) return;
    setBusyId(b.id);
    try {
      await bookingsApi.cancel(b.id);
      toast('Booking cancelled');
      await load();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="container page">
      <div className="page-head">
        <h1>My bookings</h1>
        <Link to="/" className="btn btn-primary">
          + New booking
        </Link>
      </div>

      <div className="toolbar">
        <div className="tabs" role="tablist">
          {TABS.map(([value, label]) => (
            <button
              key={label}
              role="tab"
              aria-selected={when === value}
              className={`tab ${when === value ? 'active' : ''}`}
              onClick={() => {
                setWhen(value);
                setPage(1);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          value={status}
          aria-label="Filter by status"
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Any status</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading ? (
        <Spinner />
      ) : result.data.length === 0 ? (
        <div className="empty">
          <h3>No bookings here</h3>
          <p className="muted">
            <Link to="/">Browse spaces</Link> to make one.
          </p>
        </div>
      ) : (
        <>
          <div className="booking-list">
            {result.data.map((b) => {
              const cancellable = b.isUpcoming && ['pending', 'approved'].includes(b.status);
              return (
                <article key={b.id} className="card booking-item">
                  <div className="booking-when">
                    <strong>{prettyDate(b.date)}</strong>
                    <span>
                      {b.startTime} – {b.endTime}
                    </span>
                  </div>
                  <div className="booking-what">
                    <Link to={`/spaces/${b.spaceId}?date=${b.date}`}>
                      <strong>{b.spaceName}</strong>
                    </Link>
                    <span className="muted small">{typeLabel(b.spaceType)}</span>
                    {b.purpose && <span className="small">“{b.purpose}”</span>}
                    {b.statusReason && ['rejected', 'cancelled'].includes(b.status) && (
                      <span className="muted small">{b.statusReason}</span>
                    )}
                  </div>
                  <div className="booking-actions">
                    <StatusBadge status={b.status} />
                    {cancellable && (
                      <button className="btn btn-danger-outline btn-sm" disabled={busyId === b.id} onClick={() => cancel(b)}>
                        {busyId === b.id ? 'Cancelling…' : 'Cancel'}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          <Pagination pagination={result.pagination} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
