import { Link, Route, Routes } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AdminPage from './pages/AdminPage.jsx';
import { LoginPage, RegisterPage } from './pages/AuthPages.jsx';
import MyBookingsPage from './pages/MyBookingsPage.jsx';
import SpaceDetailPage from './pages/SpaceDetailPage.jsx';
import SpacesPage from './pages/SpacesPage.jsx';

export default function App() {
  return (
    <>
      <Navbar />
      <main>
        <Routes>
          <Route path="/" element={<SpacesPage />} />
          <Route path="/spaces/:id" element={<SpaceDetailPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/my-bookings"
            element={
              <ProtectedRoute>
                <MyBookingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute role="admin">
                <AdminPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="*"
            element={
              <div className="container page empty">
                <h2>Page not found</h2>
                <Link to="/">Back to spaces</Link>
              </div>
            }
          />
        </Routes>
      </main>
    </>
  );
}
