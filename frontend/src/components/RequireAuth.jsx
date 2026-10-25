import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/context.js';
import NoAccessPage from '../pages/NoAccessPage.jsx';

// Guards a page. `role` limits it to 'student' or 'reviewer'.
export default function RequireAuth({ role, children }) {
  const auth = useAuth();

  if (auth.status === 'loading') return <div className="page-loading">Loading…</div>;
  if (auth.status === 'anon') return <Navigate to="/" replace />;
  if (auth.noAccess) return <NoAccessPage />;
  if (auth.needsProfile) return <Navigate to="/profile" replace />;
  if (role && auth.role !== role) return <Navigate to="/dashboard" replace />;

  return children;
}
