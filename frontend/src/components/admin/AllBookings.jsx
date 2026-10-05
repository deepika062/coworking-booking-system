import { useEffect, useState } from 'react';
import { errorMessage } from '../../api/client.js';
import { adminApi } from '../../api/endpoints.js';
import { prettyDate } from '../../utils/format.js';
import Pagination from '../Pagination.jsx';
import Spinner from '../Spinner.jsx';
import StatusBadge from '../StatusBadge.jsx';

export default function AllBookings({ spaces }) {
  const [filters, setFilters] = useState({ status: '', date: '', spaceId: '', q: '' });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ data: [], pagination: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const set = (key) => (e) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }));
    setPage(1);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    // Small debounce so typing in the member search doesn't spam the API.
    const t = setTimeout(() => {
      adminApi
        .bookings({ ...filters, page, limit: 15 })
        .then((res) => !cancelled && setResult(res))
        .catch((err) => !cancelled && setError(errorMessage(err)))
        .finally(() => !cancelled && setLoading(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [filters, page]);

  return (
    <section>
      <div className="card filters">
        <label className="field">
          <span>Status</span>
          <select value={filters.status} onChange={set('status')}>
            <option value="">Any</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label className="field">
          <span>Date</span>
          <input type="date" value={filters.date} onChange={set('date')} />
        </label>
        <label className="field">
          <span>Space</span>
          <select value={filters.spaceId} onChange={set('spaceId')}>
            <option value="">All spaces</option>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field field-grow">
          <span>Member</span>
          <input type="search" placeholder="Name or email" value={filters.q} onChange={set('q')} />
        </label>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && !result.pagination ? (
        <Spinner />
      ) : result.data.length === 0 ? (
        <div className="empty">
          <h3>No bookings found</h3>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Space</th>
                <th>Member</th>
                <th>Status</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {result.data.map((b) => (
                <tr key={b.id}>
                  <td data-label="When">
                    {prettyDate(b.date)}
                    <div className="small">
                      {b.startTime} – {b.endTime}
                    </div>
                  </td>
                  <td data-label="Space">{b.spaceName}</td>
                  <td data-label="Member">
                    {b.userName}
                    <div className="muted small">{b.userEmail}</div>
                  </td>
                  <td data-label="Status">
                    <StatusBadge status={b.status} />
                  </td>
                  <td data-label="Note" className="small muted">
                    {b.statusReason || b.purpose || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination pagination={result.pagination} onPageChange={setPage} />
    </section>
  );
}
