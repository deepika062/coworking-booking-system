import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '../../api/client.js';
import { adminApi } from '../../api/endpoints.js';
import { useApp } from '../../context/AppContext.jsx';
import { prettyDate, typeLabel } from '../../utils/format.js';
import Modal from '../Modal.jsx';
import Pagination from '../Pagination.jsx';
import Spinner from '../Spinner.jsx';

export default function ApprovalQueue() {
  const { toast } = useApp();
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ data: [], pagination: null });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    return adminApi
      .bookings({ status: 'pending', page, limit: 10 })
      .then(setResult)
      .catch((err) => toast(errorMessage(err), 'error'))
      .finally(() => setLoading(false));
  }, [page, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (b) => {
    setBusyId(b.id);
    try {
      const { autoRejected } = await adminApi.approve(b.id);
      toast(
        autoRejected.length
          ? `Approved. ${autoRejected.length} overlapping request(s) were auto-rejected.`
          : `Approved ${b.userName}'s booking`,
      );
      await load();
    } catch (err) {
      toast(errorMessage(err), 'error');
      load();
    } finally {
      setBusyId(null);
    }
  };

  const confirmReject = async (e) => {
    e.preventDefault();
    const b = rejecting;
    setBusyId(b.id);
    try {
      await adminApi.reject(b.id, reason.trim() || undefined);
      toast('Booking rejected');
      setRejecting(null);
      setReason('');
      await load();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (loading && !result.pagination) return <Spinner />;

  return (
    <section>
      <p className="muted">
        Oldest requests first. Approving a request automatically rejects any other pending request that overlaps it.
      </p>
      {result.data.length === 0 ? (
        <div className="empty">
          <h3>All caught up 🎉</h3>
          <p className="muted">No pending booking requests.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Space</th>
                <th>When</th>
                <th>Purpose</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {result.data.map((b) => (
                <tr key={b.id}>
                  <td data-label="Member">
                    <strong>{b.userName}</strong>
                    <div className="muted small">{b.userEmail}</div>
                  </td>
                  <td data-label="Space">
                    {b.spaceName}
                    <div className="muted small">{typeLabel(b.spaceType)}</div>
                  </td>
                  <td data-label="When">
                    {prettyDate(b.date)}
                    <div className="small">
                      {b.startTime} – {b.endTime}
                    </div>
                  </td>
                  <td data-label="Purpose" className="small">
                    {b.purpose || <span className="muted">—</span>}
                  </td>
                  <td className="actions">
                    <button className="btn btn-success btn-sm" disabled={busyId === b.id} onClick={() => approve(b)}>
                      Approve
                    </button>
                    <button
                      className="btn btn-danger-outline btn-sm"
                      disabled={busyId === b.id}
                      onClick={() => setRejecting(b)}
                    >
                      Reject
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination pagination={result.pagination} onPageChange={setPage} />

      {rejecting && (
        <Modal title="Reject booking" onClose={() => setRejecting(null)}>
          <form onSubmit={confirmReject}>
            <p>
              {rejecting.userName} · {rejecting.spaceName} · {prettyDate(rejecting.date)} {rejecting.startTime}–
              {rejecting.endTime}
            </p>
            <label className="field">
              <span>Reason (sent to the member)</span>
              <textarea rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setRejecting(null)}>
                Back
              </button>
              <button className="btn btn-danger" disabled={busyId === rejecting.id}>
                Reject booking
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
