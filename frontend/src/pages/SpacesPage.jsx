import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { errorMessage } from '../api/client.js';
import { spacesApi } from '../api/endpoints.js';
import Pagination from '../components/Pagination.jsx';
import SpaceCard from '../components/SpaceCard.jsx';
import Spinner from '../components/Spinner.jsx';
import { useApp } from '../context/AppContext.jsx';
import { SPACE_TYPES, timeOptions, todayIn } from '../utils/format.js';

const FILTER_KEYS = ['q', 'type', 'minCapacity', 'date', 'startTime', 'endTime', 'sort', 'page'];

/** Public listing. Filters live in the URL, so results are shareable and survive back/forward. */
export default function SpacesPage() {
  const { meta } = useApp();
  const [params, setParams] = useSearchParams();
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) || '']));
  const [search, setSearch] = useState(filters.q);
  const [result, setResult] = useState({ data: [], pagination: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const update = (changes) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in changes)) next.delete('page'); // any filter change -> back to page 1
    setParams(next, { replace: !('page' in changes) });
  };

  // Debounce the free-text search so we don't fire a request per keystroke.
  useEffect(() => {
    if (search === filters.q) return undefined;
    const t = setTimeout(() => update({ q: search.trim() }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const query = params.toString();
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const timeRange = filters.startTime && filters.endTime ? {} : { startTime: '', endTime: '' };
    spacesApi
      .list({ ...filters, ...timeRange, limit: 9 })
      .then((res) => !cancelled && setResult(res))
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const times = timeOptions(meta);
  const hasFilters = FILTER_KEYS.some((k) => k !== 'page' && k !== 'sort' && filters[k]);

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1>Find a space</h1>
          <p className="muted">Desks, meeting rooms and private offices. Times are in {meta.timezone}.</p>
        </div>
      </div>

      <section className="card filters" aria-label="Filters">
        <label className="field field-grow">
          <span>Search</span>
          <input
            type="search"
            placeholder="Name or type, e.g. “board” or “meeting”"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Type</span>
          <select value={filters.type} onChange={(e) => update({ type: e.target.value })}>
            <option value="">All types</option>
            {SPACE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field field-sm">
          <span>Min. capacity</span>
          <input
            type="number"
            min="1"
            placeholder="Any"
            value={filters.minCapacity}
            onChange={(e) => update({ minCapacity: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Available on</span>
          <input
            type="date"
            min={todayIn(meta.timezone)}
            value={filters.date}
            onChange={(e) => update({ date: e.target.value, ...(e.target.value ? {} : { startTime: '', endTime: '' }) })}
          />
        </label>
        <label className="field field-sm">
          <span>From</span>
          <select
            value={filters.startTime}
            disabled={!filters.date}
            onChange={(e) => update({ startTime: e.target.value, endTime: filters.endTime > e.target.value ? filters.endTime : '' })}
          >
            <option value="">Any</option>
            {times.slice(0, -1).map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="field field-sm">
          <span>To</span>
          <select
            value={filters.endTime}
            disabled={!filters.date || !filters.startTime}
            onChange={(e) => update({ endTime: e.target.value })}
          >
            <option value="">—</option>
            {times
              .filter((t) => t > filters.startTime)
              .map((t) => (
                <option key={t}>{t}</option>
              ))}
          </select>
        </label>
        <label className="field">
          <span>Sort</span>
          <select value={filters.sort || 'name'} onChange={(e) => update({ sort: e.target.value })}>
            <option value="name">Name</option>
            <option value="capacity">Capacity ↑</option>
            <option value="-capacity">Capacity ↓</option>
            <option value="newest">Newest</option>
          </select>
        </label>
        {hasFilters && (
          <button
            className="btn btn-ghost filters-reset"
            onClick={() => {
              setSearch('');
              setParams(new URLSearchParams());
            }}
          >
            Clear
          </button>
        )}
      </section>
      {filters.date && filters.startTime && !filters.endTime && (
        <p className="muted small">Pick an end time to filter by a time range.</p>
      )}

      {error && <div className="alert alert-error">{error}</div>}
      {loading ? (
        <Spinner />
      ) : result.data.length === 0 ? (
        <div className="empty">
          <h3>No spaces match</h3>
          <p className="muted">Try a different date, time or fewer filters.</p>
        </div>
      ) : (
        <>
          <div className="space-grid">
            {result.data.map((s) => (
              <SpaceCard key={s.id} space={s} date={filters.date} />
            ))}
          </div>
          <Pagination pagination={result.pagination} onPageChange={(p) => update({ page: String(p) })} />
        </>
      )}
    </div>
  );
}
