import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Spinner from './Spinner.jsx';

/** Guards a route by login and (optionally) role. The API enforces the same rules server-side. */
export default function ProtectedRoute({ role, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (role && user.role !== role) {
    return (
      <div className="container page">
        <div className="empty">
          <h2>Not allowed</h2>
          <p>This page requires the “{role}” role.</p>
        </div>
      </div>
    );
  }
  return children;
}
