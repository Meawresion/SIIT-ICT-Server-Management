import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import AuthProvider from './auth/AuthProvider.jsx';
import { useAuth } from './auth/context.js';
import RequireAuth from './components/RequireAuth.jsx';
import LandingPage from './pages/LandingPage.jsx';
import ProfileSetupPage from './pages/ProfileSetupPage.jsx';
import StudentHomePage from './pages/StudentHomePage.jsx';
import AdminHomePage from './pages/AdminHomePage.jsx';
import HistoryPage from './pages/HistoryPage.jsx';
import AccountPage from './pages/AccountPage.jsx';
import ContactPage from './pages/ContactPage.jsx';
import PrivacyPage from './pages/PrivacyPage.jsx';
import NotFoundPage from './pages/ErrorPage.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

// The backend's OAuth callback redirects to /dashboard (profile exists) or /profile (first login),
// so both paths must stay. /dashboard forwards to the right home for the role.
function DashboardRedirect() {
  const auth = useAuth();
  return <Navigate to={auth.role === 'reviewer' ? '/admin' : '/home'} replace />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Router>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="/profile" element={<ProfileSetupPage />} />
            <Route path="/dashboard" element={<RequireAuth><DashboardRedirect /></RequireAuth>} />
            <Route path="/home" element={<RequireAuth role="student"><StudentHomePage /></RequireAuth>} />
            <Route path="/admin" element={<RequireAuth role="reviewer"><AdminHomePage /></RequireAuth>} />
            <Route path="/history" element={<RequireAuth><HistoryPage /></RequireAuth>} />
            <Route path="/account" element={<RequireAuth><AccountPage /></RequireAuth>} />
            <Route path="/contact" element={<RequireAuth><ContactPage /></RequireAuth>} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Router>
      </AuthProvider>
    </ErrorBoundary>
  );
}
