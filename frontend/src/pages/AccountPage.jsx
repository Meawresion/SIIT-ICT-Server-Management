import { useState } from 'react';
import { useAuth } from '../auth/context.js';
import { updateUserProfile } from '../api/users.js';
import { degreeLabel } from '../constants.js';
import { initials } from '../utils/format.js';
import AppLayout from '../components/AppLayout.jsx';
import ProfileForm from '../components/ProfileForm.jsx';
import { PencilIcon } from '../components/Icons.jsx';

export default function AccountPage() {
  const auth = useAuth();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const p = auth.profile;

  const save = async (data) => {
    await updateUserProfile(data);
    await auth.refresh();
    setEditing(false);
    setSaved(true);
  };

  return (
    <AppLayout>
      <section className="section">
        <div className="profile-card">
          <div className="profile-side">
            <div className="avatar-xl" aria-hidden="true">{initials(auth.name)}</div>
            <p className="profile-name">{auth.name}</p>
            <p className="muted small">{auth.role === 'reviewer' ? 'Resource Approver' : 'Student'}</p>
          </div>

          <div className="profile-main">
            <div className="section-head">
              <h1>{editing ? 'Edit Profile' : 'My Profile'}</h1>
              {p && !editing && (
                <button type="button" className="btn btn-secondary" onClick={() => { setSaved(false); setEditing(true); }}>
                  <PencilIcon width={16} height={16} /> Edit
                </button>
              )}
            </div>

            {saved && <div className="alert alert-success" role="status">Profile updated.</div>}

            {!p ? (
              <p className="muted">
                This account signs in as an approver and has no student profile. Approver access is managed by SIIT ICT.
              </p>
            ) : editing ? (
              <ProfileForm initial={p} email={p.primary_email} onSubmit={save} submitLabel="Save changes" onCancel={() => setEditing(false)} />
            ) : (
              <dl className="info-grid">
                <div><dt>Name</dt><dd>{p.full_name}</dd></div>
                <div><dt>E-mail</dt><dd>{p.primary_email}</dd></div>
                <div><dt>Student ID</dt><dd>{p.student_id}</dd></div>
                <div><dt>Degree Level</dt><dd>{degreeLabel(p.degree)}</dd></div>
                <div><dt>Program/Department</dt><dd>{p.program}</dd></div>
                <div><dt>Primary Advisor</dt><dd>{p.advisor_name}</dd></div>
                <div><dt>Contact Phone</dt><dd>{p.phone_number || '—'}</dd></div>
              </dl>
            )}
          </div>
        </div>
      </section>
    </AppLayout>
  );
}
