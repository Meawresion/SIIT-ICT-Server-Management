import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/context.js';

// A staff account that signed in but has no Approver role yet. The role is granted by SIIT ICT
// on the server (role by function), so there is nothing to fill in here.
export default function NoAccessPage() {
  const auth = useAuth();
  const navigate = useNavigate();

  return (
    <div className="setup">
      <div className="setup-card">
        <p className="eyebrow">Staff account</p>
        <h1>No access yet</h1>
        <p className="muted">
          Signed in as <strong className="signed-in-email">{auth.account?.email}</strong>. Staff accounts can review requests
          once SIIT ICT grants approver access. Contact SIIT ICT if you need it.
        </p>
        <button type="button" className="link-button setup-signout" onClick={() => auth.logout().then(() => navigate('/'))}>
          Sign out
        </button>
      </div>
    </div>
  );
}
