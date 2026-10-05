import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '../../api/client.js';
import { adminApi } from '../../api/endpoints.js';
import { useApp } from '../../context/AppContext.jsx';
import Spinner from '../Spinner.jsx';

const fmt = (local) => local.replace('T', ' ');

export default function MaintenanceManager({ spaces }) {
  const { meta, toast } = useApp();
  const [form, setForm] = useState({ spaceId: '', start: '', end: '', reason: '' });
  const [conflicts, setConflicts] = useState(null); // approved bookings that block the window
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [filterSpace, setFilterSpace] = useState('');
  const [windows, setWindows] = useState([]);
  const [loading, setLoading] = useState(true);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setConflicts(null);
  };

  const load = useCallback(() => {
    setLoading(true);
    return adminApi
      .maintenance({ spaceId: filterSpace })
      .then(setWindows)
      .catch((err) => toast(errorMessage(err), 'error'))
      .finally(() => setLoading(false));
  }, [filterSpace, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (e, force = false) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { affectedBookings } = await adminApi.createMaintenance({ ...form, force });
      toast(
        affectedBookings.length
          ? `Maintenance window added · ${affectedBookings.length} booking(s) rejected/cancelled`
          : 'Maintenance window added',
      );
      setForm((f) => ({ ...f, start: '', end: '', reason: '' }));
      setConflicts(null);
      load();
    } catch (err) {
      const apiErr = err.response?.data?.error;
      if (apiErr?.code === 'MAINTENANCE_CONFLICT' && apiErr.details) setConflicts(apiErr.details);
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (w) => {
    if (!window.confirm(`Remove maintenance on ${w.spaceName} (${fmt(w.start)} → ${fmt(w.end)})?`)) return;
    try {
      await adminApi.deleteMaintenance(w.id);
      toast('Maintenance window removed');
      load();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <section className="maintenance-layout">
      <form className="card" onSubmit={submit}>
        <h2>Block out a space</h2>
        <p className="muted small">
          Times are in {meta.timezone}. Pending requests in the window are auto-rejected.
        </p>
        <label className="field">
          <span>Space</span>
          <select value={form.spaceId} onChange={set('spaceId')} required>
            <option value="">Select a space…</option>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Start</span>
          <input type="datetime-local" value={form.start} onChange={set('start')} required />
        </label>
        <label className="field">
          <span>End</span>
          <input type="datetime-local" value={form.end} min={form.start} onChange={set('end')} required />
        </label>
        <label className="field">
          <span>Reason</span>
          <input value={form.reason} onChange={set('reason')} maxLength={300} placeholder="e.g. AC repair" />
        </label>
        {error && <div className="alert alert-error">{error}</div>}
        {conflicts ? (
          <div className="alert alert-warn">
            <strong>{conflicts.length} approved booking(s) overlap this window:</strong>
            <ul>
              {conflicts.map((c) => (
                <li key={c.id}>
                  {c.userName} · {c.date} {c.startTime}–{c.endTime}
                </li>
              ))}
            </ul>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConflicts(null)}>
                Keep bookings
              </button>
              <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => submit(null, true)}>
                Cancel them &amp; block
              </button>
            </div>
          </div>
        ) : (
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Saving…' : 'Add maintenance window'}
          </button>
        )}
      </form>

      <div>
        <div className="toolbar">
          <h2>Upcoming windows</h2>
          <select value={filterSpace} onChange={(e) => setFilterSpace(e.target.value)} aria-label="Filter by space">
            <option value="">All spaces</option>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        {loading ? (
          <Spinner />
        ) : windows.length === 0 ? (
          <div className="empty">
            <p className="muted">No upcoming maintenance.</p>
          </div>
        ) : (
          <ul className="window-list">
            {windows.map((w) => (
              <li key={w.id} className="card window-item">
                <div>
                  <strong>{w.spaceName}</strong>
                  <div className="small">
                    {fmt(w.start)} → {fmt(w.end)}
                  </div>
                  {w.reason && <div className="muted small">{w.reason}</div>}
                </div>
                <button className="btn btn-danger-outline btn-sm" onClick={() => remove(w)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
