import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { spacesApi } from '../api/endpoints.js';
import AllBookings from '../components/admin/AllBookings.jsx';
import ApprovalQueue from '../components/admin/ApprovalQueue.jsx';
import MaintenanceManager from '../components/admin/MaintenanceManager.jsx';
import SpacesManager from '../components/admin/SpacesManager.jsx';

const TABS = [
  ['queue', 'Approval queue'],
  ['bookings', 'All bookings'],
  ['spaces', 'Spaces'],
  ['maintenance', 'Maintenance'],
];

export default function AdminPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'queue';

  // Every space (for dropdowns in filters / maintenance form). Refreshed after space CRUD.
  const [spaces, setSpaces] = useState([]);
  const loadSpaces = useCallback(
    () => spacesApi.list({ limit: 50, sort: 'name' }).then((res) => setSpaces(res.data)).catch(() => {}),
    [],
  );
  useEffect(() => {
    loadSpaces();
  }, [loadSpaces]);

  return (
    <div className="container page">
      <div className="page-head">
        <h1>Admin dashboard</h1>
      </div>
      <div className="tabs tabs-scroll" role="tablist">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={`tab ${tab === key ? 'active' : ''}`}
            onClick={() => setParams({ tab: key })}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'queue' && <ApprovalQueue />}
      {tab === 'bookings' && <AllBookings spaces={spaces} />}
      {tab === 'spaces' && <SpacesManager onChange={loadSpaces} />}
      {tab === 'maintenance' && <MaintenanceManager spaces={spaces} />}
    </div>
  );
}
