import { useState } from 'react';
import { degreeLabel } from '../constants.js';

// The fields the student fills in. Student ID and degree come from the SIIT email and are shown only.
const FIELDS = ['full_name', 'program', 'advisor_name', 'phone_number'];

function emptyProfile(p) {
  return {
    full_name: p?.full_name ?? '',
    program: p?.program ?? '',
    advisor_name: p?.advisor_name ?? '',
    phone_number: p?.phone_number ?? '',
  };
}

// `email`, `studentId` and `degree` are shown read-only: they come from the Google account's
// SIIT address and are never sent.
export default function ProfileForm({ initial, email, studentId, degree, onSubmit, submitLabel, onCancel }) {
  const [form, setForm] = useState(() => emptyProfile(initial));
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [k]: undefined }));
  };

  const handle = async (e) => {
    e.preventDefault();
    const er = {};
    for (const k of FIELDS) if (!String(form[k]).trim()) er[k] = 'Required';
    if (form.phone_number && !/^[0-9+\-\s()]{6,30}$/.test(form.phone_number)) er.phone_number = 'Use digits only, e.g. 0812345678';
    setErrors(er);
    if (Object.keys(er).length) return;
    setBusy(true);
    setApiError('');
    try {
      const trimmed = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, String(v).trim()]));
      await onSubmit(trimmed);
    } catch (err) {
      setApiError(err.message);
      setBusy(false);
    }
  };

  const err = (k) => errors[k] && <span className="field-error">{errors[k]}</span>;

  return (
    <form className="profile-form" onSubmit={handle} noValidate>
      {apiError && <div className="alert alert-error" role="alert">{apiError}</div>}
      <div className="form-grid">
        <label className="field">
          <span className="field-label">Full Name <span className="req">*</span></span>
          <input value={form.full_name} onChange={set('full_name')} maxLength={100} autoComplete="name" aria-invalid={Boolean(errors.full_name)} />
          {err('full_name')}
        </label>
        <label className="field">
          <span className="field-label">E-mail</span>
          <input value={email ?? ''} readOnly aria-readonly="true" tabIndex={-1} />
          <span className="hint">From your Google account. It can’t be changed.</span>
        </label>
        <label className="field">
          <span className="field-label">Student ID</span>
          <input value={studentId ?? ''} readOnly aria-readonly="true" tabIndex={-1} />
        </label>
        <label className="field">
          <span className="field-label">Degree Level</span>
          <input value={degree ? degreeLabel(degree) : ''} readOnly aria-readonly="true" tabIndex={-1} />
          <span className="hint">Student ID and degree come from your SIIT e-mail.</span>
        </label>
        <label className="field">
          <span className="field-label">Program/Department <span className="req">*</span></span>
          <input value={form.program} onChange={set('program')} maxLength={255} placeholder="e.g. Digital Engineering" aria-invalid={Boolean(errors.program)} />
          {err('program')}
        </label>
        <label className="field">
          <span className="field-label">Primary Advisor <span className="req">*</span></span>
          <input value={form.advisor_name} onChange={set('advisor_name')} maxLength={100} placeholder="e.g. Dr. Pakinee" aria-invalid={Boolean(errors.advisor_name)} />
          {err('advisor_name')}
        </label>
        <label className="field">
          <span className="field-label">Contact Phone Number <span className="req">*</span></span>
          <input value={form.phone_number} onChange={set('phone_number')} inputMode="tel" maxLength={30} placeholder="e.g. 0812345678" aria-invalid={Boolean(errors.phone_number)} />
          {err('phone_number')}
        </label>
      </div>
      <div className="form-actions">
        {onCancel && <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>}
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
      </div>
    </form>
  );
}
