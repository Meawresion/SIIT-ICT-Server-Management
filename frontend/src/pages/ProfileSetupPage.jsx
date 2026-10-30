import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/context.js';
import { createUserProfile } from '../api/users.js';
import ProfileForm from '../components/ProfileForm.jsx';

// First login: the backend redirects here (/profile) when no profile exists yet.
export default function ProfileSetupPage() {
  const auth = useAuth();
  const navigate = useNavigate();

  if (auth.status === 'loading') return <div className="page-loading">Loading…</div>;
  if (auth.status === 'anon') return <Navigate to="/" replace />;
  if (!auth.needsProfile) return <Navigate to="/dashboard" replace />;

  const submit = async (data) => {
    await createUserProfile(data);
    await auth.refresh();
    navigate('/home', { replace: true });
  };

  return (
    <div className="setup">
      <div className="setup-card">
        <p className="eyebrow">Step 1 of 1</p>
        <h1>Fill in your profile</h1>
        <p className="muted">
          We only ask once. These details are attached to every request you send, so approvers know who you are and who supervises you.
        </p>
        <p className="muted small">
          SIIT ICT uses them only to handle your requests and accounts; see the <Link to="/privacy">privacy notice</Link>.
        </p>
        <ProfileForm initial={{ full_name: auth.account?.full_name }} email={auth.account?.email} studentId={auth.account?.student_id} degree={auth.account?.degree} onSubmit={submit} submitLabel="Save and continue" />
        <button type="button" className="link-button setup-signout" onClick={() => auth.logout().then(() => navigate('/'))}>
          Not you? Sign out
        </button>
      </div>
    </div>
  );
}
