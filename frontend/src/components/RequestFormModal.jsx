import { useEffect, useRef, useState } from 'react';
import Modal from './Modal.jsx';
import StatusBadge from './StatusBadge.jsx';
import { useAuth } from '../auth/context.js';
import { createRequest, getRequest, updateRequest } from '../api/requests.js';
import {
  activateRequest,
  approveRequest,
  completeRequest,
  getRequest as getReviewRequest,
  rejectRequest,
} from '../api/reviewer.js';
import { saveDraft } from '../api/drafts.js';
import { RESOURCE_TYPES, STATUS_HELP, degreeLabel } from '../constants.js';
import { formatDateTime, formatId, toInputDate } from '../utils/format.js';
import { notifyRequestsChanged } from '../utils/requestEvents.js';

const EMPTY = {
  purpose: '',
  project_description: '',
  project_supervisor_name: '',
  resource_type: '',
  justification: '',
  estimated_start_date: '',
  estimated_end_date: '',
  impact_score: 5,
  supervisor_confirmation: 'NOT_CONFIRMED',
};

function fromRequest(r) {
  return {
    purpose: r.purpose ?? '',
    project_description: r.project_description ?? '',
    project_supervisor_name: r.project_supervisor_name ?? '',
    resource_type: r.resource_type ?? '',
    justification: r.justification ?? '',
    estimated_start_date: toInputDate(r.estimated_start_date),
    estimated_end_date: toInputDate(r.estimated_end_date),
    impact_score: r.impact_score ?? 5,
    supervisor_confirmation: r.supervisor_confirmation ?? 'NOT_CONFIRMED',
  };
}

function toPayload(f) {
  return {
    ...f,
    purpose: f.purpose.trim(),
    project_description: f.project_description.trim(),
    project_supervisor_name: f.project_supervisor_name.trim() || null,
    justification: f.justification.trim(),
    impact_score: Number(f.impact_score),
  };
}

function validate(f) {
  const e = {};
  if (!f.purpose.trim()) e.purpose = 'Give the project a title.';
  if (!f.project_description.trim()) e.project_description = 'Describe the project or task.';
  if (!f.resource_type) e.resource_type = 'Choose a resource type.';
  if (!f.justification.trim()) e.justification = 'Explain why this resource is needed.';
  if (!f.estimated_start_date) e.estimated_start_date = 'Pick a start date.';
  if (!f.estimated_end_date) e.estimated_end_date = 'Pick an end date.';
  if (f.estimated_start_date && f.estimated_end_date && f.estimated_end_date < f.estimated_start_date) {
    e.estimated_end_date = 'End date must be on or after the start date.';
  }
  if (f.supervisor_confirmation !== 'CONFIRMED') e.supervisor_confirmation = 'Confirm that your supervisor supports this request.';
  return e;
}

/**
 * One form for every request screen.
 *  mode="new"    – blank or loaded draft; Submit / Save Draft
 *  mode="edit"   – student's own PENDING request; Save Changes
 *  mode="view"   – student, read only, shows the reviewer's decision
 *  mode="review" – approver; Approve / Reject, or move Approved → Active → Completed
 */
export default function RequestFormModal({ mode, requestId, draft, onClose, onDone }) {
  const auth = useAuth();
  const [form, setForm] = useState(draft ? { ...EMPTY, ...draft.data } : EMPTY);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(Boolean(requestId));
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState('');
  const [busy, setBusy] = useState('');
  const [comment, setComment] = useState('');
  const [draftId, setDraftId] = useState(draft?.id ?? null);
  const [draftSavedAt, setDraftSavedAt] = useState(null);
  const commentRef = useRef(null);

  useEffect(() => {
    if (!requestId) return undefined;
    let cancelled = false;
    const fetcher = mode === 'review' ? getReviewRequest : getRequest;
    fetcher(requestId)
      .then((r) => {
        if (cancelled) return;
        setDetail(r);
        setForm(fromRequest(r));
      })
      .catch((err) => !cancelled && setApiError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [requestId, mode]);

  const readOnly = mode === 'view' || mode === 'review';
  const set = (name) => (e) => {
    const value = e.target.type === 'checkbox' ? (e.target.checked ? 'CONFIRMED' : 'NOT_CONFIRMED') : e.target.value;
    setForm((f) => ({ ...f, [name]: value }));
    setErrors((er) => ({ ...er, [name]: undefined }));
  };

  // ---- student actions
  const submit = async () => {
    const e = validate(form);
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy('submit');
    setApiError('');
    try {
      if (mode === 'edit') {
        const res = await updateRequest(requestId, toPayload(form));
        notifyRequestsChanged();
        onDone({ type: 'updated', request: res });
      } else {
        const res = await createRequest(toPayload(form));
        notifyRequestsChanged();
        onDone({ type: 'submitted', request: res, draftId });
      }
    } catch (err) {
      setApiError(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleSaveDraft = () => {
    const saved = saveDraft(auth.accountId, form, draftId);
    setDraftId(saved.id);
    setDraftSavedAt(saved.updated_at);
    setErrors({});
    onDone({ type: 'draft', draft: saved, keepOpen: true });
  };

  // ---- reviewer actions
  const review = async (action) => {
    if ((action === 'approve' || action === 'reject') && !comment.trim()) {
      setErrors({ comment: action === 'reject' ? 'Give the student a reason for rejecting.' : 'Add a short note for the student.' });
      commentRef.current?.focus();
      return;
    }
    setBusy(action);
    setApiError('');
    try {
      const fn = { approve: approveRequest, reject: rejectRequest, activate: activateRequest, complete: completeRequest }[action];
      const res = await fn(requestId, comment.trim());
      notifyRequestsChanged();
      onDone({ type: 'reviewed', request: res });
    } catch (err) {
      setApiError(err.message);
    } finally {
      setBusy('');
    }
  };

  // ---- student info block
  const student = mode === 'review'
    ? detail?.student && {
        name: detail.student.name,
        student_id: detail.student.student_id,
        email: detail.student.email,
        degree: detail.student.degree,
        program: detail.student.program,
        phone: null,
        advisor: detail.student.advisor_name,
      }
    : auth.profile && {
        name: auth.profile.full_name,
        student_id: auth.profile.student_id,
        email: auth.profile.primary_email,
        degree: auth.profile.degree,
        program: auth.profile.program,
        phone: auth.profile.phone_number,
        advisor: auth.profile.advisor_name,
      };

  const title = mode === 'new' ? 'Resource Request Form' : `Request ${formatId(requestId)}`;
  const status = detail?.status;

  let footer;
  if (mode === 'new') {
    footer = (
      <>
        {draftSavedAt && <span className="footer-note">Draft saved {formatDateTime(draftSavedAt)}</span>}
        <button type="button" className="btn btn-secondary" onClick={handleSaveDraft} disabled={Boolean(busy)}>Save Draft</button>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={Boolean(busy)}>
          {busy === 'submit' ? 'Submitting…' : 'Submit Request'}
        </button>
      </>
    );
  } else if (mode === 'edit') {
    footer = (
      <>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={Boolean(busy) || loading}>
          {busy === 'submit' ? 'Saving…' : 'Save Changes'}
        </button>
      </>
    );
  } else if (mode === 'review' && status === 'PENDING') {
    footer = (
      <>
        <button type="button" className="btn btn-danger-outline" onClick={() => review('reject')} disabled={Boolean(busy)}>
          {busy === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => review('approve')} disabled={Boolean(busy)}>
          {busy === 'approve' ? 'Approving…' : 'Approve'}
        </button>
      </>
    );
  } else if (mode === 'review' && status === 'APPROVED') {
    footer = (
      <button type="button" className="btn btn-primary" onClick={() => review('activate')} disabled={Boolean(busy)}>
        {busy === 'activate' ? 'Updating…' : 'Mark as Active'}
      </button>
    );
  } else if (mode === 'review' && status === 'ACTIVE') {
    footer = (
      <button type="button" className="btn btn-primary" onClick={() => review('complete')} disabled={Boolean(busy)}>
        {busy === 'complete' ? 'Updating…' : 'Mark as Completed'}
      </button>
    );
  } else {
    footer = <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>;
  }

  return (
    <Modal title={title} onClose={onClose} size="lg" footer={footer} headerExtra={status && <StatusBadge status={status} />}>
      {loading ? (
        <p className="muted">Loading request…</p>
      ) : (
        <form className="request-form" onSubmit={(e) => e.preventDefault()} noValidate>
          {apiError && <div className="alert alert-error" role="alert">{apiError}</div>}

          {status && (
            <div className="status-strip">
              <span>{STATUS_HELP[status]}</span>
              {detail.created_at && <span className="muted">Submitted {formatDateTime(detail.created_at)}</span>}
            </div>
          )}

          {detail?.review_comment && (mode === 'view' || mode === 'edit' || status !== 'PENDING') && (
            <div className={`review-note ${status === 'REJECTED' ? 'is-rejected' : ''}`}>
              <strong>Approver’s comment</strong>
              <p>{detail.review_comment}</p>
              {detail.reviewed_at && <small>{formatDateTime(detail.reviewed_at)}</small>}
            </div>
          )}

          <fieldset>
            <legend>Student Information</legend>
            {student ? (
              <dl className="info-grid">
                <div><dt>Full Name</dt><dd>{student.name}</dd></div>
                <div><dt>Student ID</dt><dd>{student.student_id}</dd></div>
                <div><dt>E-mail Address</dt><dd>{student.email}</dd></div>
                <div><dt>Degree Level</dt><dd>{degreeLabel(student.degree)}</dd></div>
                <div><dt>Program/Department</dt><dd>{student.program}</dd></div>
                {student.phone && <div><dt>Contact Phone Number</dt><dd>{student.phone}</dd></div>}
                <div><dt>Primary Advisor</dt><dd>{student.advisor}</dd></div>
              </dl>
            ) : (
              <p className="muted">Student details unavailable.</p>
            )}
            {!readOnly && <p className="hint">These come from your profile. Change them on the Account page.</p>}
          </fieldset>

          <fieldset>
            <legend>Purpose &amp; Accountability</legend>

            <Field label="Project Title" error={errors.purpose} required={!readOnly}>
              <input value={form.purpose} onChange={set('purpose')} readOnly={readOnly} maxLength={255} placeholder="e.g. RNV Segmentation" />
            </Field>

            <Field label="Brief Project/Task Description for which the resource is needed" error={errors.project_description} required={!readOnly}>
              <textarea rows={3} value={form.project_description} onChange={set('project_description')} readOnly={readOnly} placeholder="Brief description…" />
            </Field>

            <Field label="Project/Task Supervisor or Course Instructor Name" error={errors.project_supervisor_name}>
              <input value={form.project_supervisor_name} onChange={set('project_supervisor_name')} readOnly={readOnly} maxLength={255} placeholder="e.g. Dr. Pakinee" />
            </Field>

            <Field label="Resource Type" error={errors.resource_type} required={!readOnly} hint={mode === 'edit' ? 'Resource type can’t be changed after submission.' : undefined}>
              <select value={form.resource_type} onChange={set('resource_type')} disabled={readOnly || mode === 'edit'}>
                <option value="">Select a resource…</option>
                {RESOURCE_TYPES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </Field>

            <Field label="Justification for Resource Request" error={errors.justification} required={!readOnly}>
              <textarea rows={4} value={form.justification} onChange={set('justification')} readOnly={readOnly} placeholder="Briefly explain why this specific resource is essential for your project/research…" />
            </Field>

            <div className="field">
              <span className="field-label">Estimated Resource Usage Period {!readOnly && <span className="req">*</span>}</span>
              <div className="date-range">
                <label>
                  <span className="sr-only">Start date</span>
                  <input type="date" value={form.estimated_start_date} onChange={set('estimated_start_date')} readOnly={readOnly} aria-invalid={Boolean(errors.estimated_start_date)} />
                </label>
                <span aria-hidden="true">–</span>
                <label>
                  <span className="sr-only">End date</span>
                  <input type="date" value={form.estimated_end_date} min={form.estimated_start_date || undefined} onChange={set('estimated_end_date')} readOnly={readOnly} aria-invalid={Boolean(errors.estimated_end_date)} />
                </label>
              </div>
              {(errors.estimated_start_date || errors.estimated_end_date) && (
                <span className="field-error">{errors.estimated_start_date || errors.estimated_end_date}</span>
              )}
            </div>

            <div className="field">
              <span className="field-label" id="crit-label">Criticality of this resource to the success of your project</span>
              <div className="slider-row">
                <span className="slider-end">Low criticality</span>
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="1"
                  value={form.impact_score}
                  onChange={set('impact_score')}
                  disabled={readOnly}
                  aria-labelledby="crit-label"
                  style={{ '--fill': `${((form.impact_score - 1) / 9) * 100}%` }}
                />
                <span className="slider-end">Absolutely essential</span>
                <output className="slider-value">{form.impact_score}/10</output>
              </div>
            </div>

            <div className="field">
              <span className="field-label">Please confirm that you have discussed this resource requirement with your supervisor</span>
              <label className="checkbox">
                <input type="checkbox" checked={form.supervisor_confirmation === 'CONFIRMED'} onChange={set('supervisor_confirmation')} disabled={readOnly} />
                Yes, my supervisor is aware and supports this request.
              </label>
              {errors.supervisor_confirmation && <span className="field-error">{errors.supervisor_confirmation}</span>}
            </div>
          </fieldset>

          {mode === 'review' && status === 'PENDING' && (
            <fieldset>
              <legend>Decision</legend>
              <Field label="Comment to the student" error={errors.comment} required hint="Required for both approve and reject. The student sees this.">
                <textarea ref={commentRef} rows={3} value={comment} onChange={(e) => { setComment(e.target.value); setErrors({}); }} placeholder="e.g. Approved for one semester on the shared A40." />
              </Field>
            </fieldset>
          )}
        </form>
      )}
    </Modal>
  );
}

function Field({ label, error, required, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">
        {label} {required && <span className="req">*</span>}
      </span>
      {children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}
