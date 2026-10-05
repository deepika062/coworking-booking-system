import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '../../api/client.js';
import { spacesApi } from '../../api/endpoints.js';
import { useApp } from '../../context/AppContext.jsx';
import { SPACE_TYPES, typeLabel } from '../../utils/format.js';
import Modal from '../Modal.jsx';
import Pagination from '../Pagination.jsx';
import Spinner from '../Spinner.jsx';

const EMPTY = { name: '', type: 'desk', capacity: 1, amenities: '', location: '', description: '' };

function SpaceForm({ initial, onSaved, onCancel }) {
  const [form, setForm] = useState(
    initial ? { ...initial, amenities: initial.amenities.join(', ') } : EMPTY,
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const body = {
      name: form.name,
      type: form.type,
      capacity: Number(form.capacity),
      amenities: form.amenities.split(',').map((a) => a.trim()).filter(Boolean),
      location: form.location,
      description: form.description,
    };
    try {
      const saved = initial ? await spacesApi.update(initial.id, body) : await spacesApi.create(body);
      onSaved(saved, !initial);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="form-grid">
      <label className="field span-2">
        <span>Name</span>
        <input value={form.name} onChange={set('name')} required minLength={2} maxLength={80} />
      </label>
      <label className="field">
        <span>Type</span>
        <select value={form.type} onChange={set('type')}>
          {SPACE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Capacity</span>
        <input type="number" min="1" max="500" value={form.capacity} onChange={set('capacity')} required />
      </label>
      <label className="field span-2">
        <span>Amenities (comma separated)</span>
        <input value={form.amenities} onChange={set('amenities')} placeholder="WiFi, Whiteboard, TV screen" />
      </label>
      <label className="field span-2">
        <span>Location</span>
        <input value={form.location} onChange={set('location')} maxLength={120} placeholder="Floor 2" />
      </label>
      <label className="field span-2">
        <span>Description</span>
        <textarea rows={3} value={form.description} onChange={set('description')} maxLength={1000} />
      </label>
      {error && <div className="alert alert-error span-2">{error}</div>}
      <div className="modal-actions span-2">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : initial ? 'Save changes' : 'Create space'}
        </button>
      </div>
    </form>
  );
}

export default function SpacesManager({ onChange }) {
  const { toast } = useApp();
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ data: [], pagination: null });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | 'new' | space

  const load = useCallback(() => {
    setLoading(true);
    return spacesApi
      .list({ page, limit: 10, sort: 'name' })
      .then(setResult)
      .catch((err) => toast(errorMessage(err), 'error'))
      .finally(() => setLoading(false));
  }, [page, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const saved = (space, created) => {
    toast(created ? `Created “${space.name}”` : `Saved “${space.name}”`);
    setEditing(null);
    load();
    onChange();
  };

  const remove = async (space) => {
    if (!window.confirm(`Delete “${space.name}”? Its future bookings will be cancelled and members notified.`)) return;
    try {
      const { cancelledBookings } = await spacesApi.remove(space.id);
      toast(`Deleted “${space.name}”${cancelledBookings ? ` · ${cancelledBookings} booking(s) cancelled` : ''}`);
      load();
      onChange();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <section>
      <div className="toolbar">
        <span className="muted">{result.pagination?.total ?? '…'} spaces</span>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          + Add space
        </button>
      </div>

      {loading && !result.pagination ? (
        <Spinner />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Capacity</th>
                <th>Amenities</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {result.data.map((s) => (
                <tr key={s.id}>
                  <td data-label="Name">
                    <strong>{s.name}</strong>
                    <div className="muted small">{s.location}</div>
                  </td>
                  <td data-label="Type">{typeLabel(s.type)}</td>
                  <td data-label="Capacity">{s.capacity}</td>
                  <td data-label="Amenities" className="small">
                    {s.amenities.join(', ') || '—'}
                  </td>
                  <td className="actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditing(s)}>
                      Edit
                    </button>
                    <button className="btn btn-danger-outline btn-sm" onClick={() => remove(s)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination pagination={result.pagination} onPageChange={setPage} />

      {editing && (
        <Modal title={editing === 'new' ? 'Add space' : `Edit ${editing.name}`} onClose={() => setEditing(null)}>
          <SpaceForm initial={editing === 'new' ? null : editing} onSaved={saved} onCancel={() => setEditing(null)} />
        </Modal>
      )}
    </section>
  );
}
