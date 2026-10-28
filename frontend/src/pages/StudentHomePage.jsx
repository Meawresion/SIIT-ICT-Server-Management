import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/context.js';
import { getMyRequests } from '../api/requests.js';
import { deleteDraft, listDrafts } from '../api/drafts.js';
import { resourceShort } from '../constants.js';
import { formatDateTime, formatId, formatLocalDate, formatPeriod } from '../utils/format.js';
import AppLayout from '../components/AppLayout.jsx';
import DataTable from '../components/DataTable.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import RequestFormModal from '../components/RequestFormModal.jsx';
import LoadDraftModal from '../components/LoadDraftModal.jsx';
import SubmittedModal from '../components/SubmittedModal.jsx';
import { FolderIcon, PlusIcon } from '../components/Icons.jsx';

// Borrow period is only meaningful once access is live.
const borrowPeriod = (r) => (r.status === 'ACTIVE' ? formatPeriod(r.estimated_start_date, r.estimated_end_date) : 'N/A');

export default function StudentHomePage() {
  const auth = useAuth();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState(() => listDrafts(auth.accountId));
  const [form, setForm] = useState(null); // { mode, requestId?, draft? }
  const [showLoad, setShowLoad] = useState(false);
  const [submitted, setSubmitted] = useState(null);

  const loadRequests = useCallback(() => {
    return getMyRequests()
      .then((rows) => {
        setRequests(rows);
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const refreshDrafts = () => setDrafts(listDrafts(auth.accountId));

  const handleDone = (result) => {
    if (result.type === 'draft') {
      refreshDrafts();
      return;
    }
    setForm(null);
    if (result.type === 'submitted') {
      if (result.draftId) deleteDraft(auth.accountId, result.draftId);
      refreshDrafts();
      setSubmitted(result.request);
    }
    loadRequests();
  };

  const removeDraft = (d) => {
    if (!window.confirm(`Delete the draft “${d.data.purpose || 'Untitled request'}”?`)) return;
    deleteDraft(auth.accountId, d.id);
    refreshDrafts();
  };

  const requestColumns = [
    { key: 'id', label: 'ID', render: (r) => <span className="mono">{formatId(r.id)}</span> },
    { key: 'created_at', label: 'Request Date', render: (r) => formatLocalDate(r.created_at) },
    { key: 'purpose', label: 'Project', className: 'col-wide' },
    { key: 'resource_type', label: 'Resource Type', render: (r) => resourceShort(r.resource_type) },
    { key: 'period', label: 'Borrow Period', render: borrowPeriod },
    { key: 'status', label: 'Request Status', render: (r) => <StatusBadge status={r.status} extensionAsked={r.extension_asked} /> },
    {
      key: 'action',
      label: '',
      className: 'col-action',
      render: (r) =>
        r.status === 'PENDING' ? (
          <button type="button" className="table-link" onClick={() => setForm({ mode: 'edit', requestId: r.id })}>Edit</button>
        ) : (
          <button type="button" className="table-link" onClick={() => setForm({ mode: 'view', requestId: r.id })}>View</button>
        ),
    },
  ];

  const draftColumns = [
    { key: 'id', label: 'ID', render: (d) => <span className="mono">{d.id}</span> },
    { key: 'updated_at', label: 'Modified Date', render: (d) => formatDateTime(d.updated_at) },
    { key: 'purpose', label: 'Project', className: 'col-wide', render: (d) => d.data.purpose || <span className="muted">Untitled request</span> },
    { key: 'resource_type', label: 'Resource Type', render: (d) => (d.data.resource_type ? resourceShort(d.data.resource_type) : '—') },
    {
      key: 'period',
      label: 'Borrow Period',
      render: (d) => (d.data.estimated_start_date ? formatPeriod(d.data.estimated_start_date, d.data.estimated_end_date) : '—'),
    },
    { key: 'status', label: 'Request Status', render: () => <span className="badge badge-draft">Draft</span> },
    {
      key: 'action',
      label: '',
      className: 'col-action',
      render: (d) => (
        <span className="action-pair">
          <button type="button" className="table-link" onClick={() => setForm({ mode: 'new', draft: d })}>Edit</button>
          <button type="button" className="table-link danger" onClick={() => removeDraft(d)}>Delete</button>
        </span>
      ),
    },
  ];

  return (
    <AppLayout>
      <section className="section">
        <div className="section-head">
          <h1>Your Requests</h1>
          <div className="section-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setShowLoad(true)}>
              <FolderIcon width={18} height={18} /> Load Draft
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setForm({ mode: 'new' })}>
              <PlusIcon width={18} height={18} /> New Request
            </button>
          </div>
        </div>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <DataTable
          columns={requestColumns}
          rows={requests}
          loading={loading}
          empty="No requests yet. Press “New Request” to ask for a resource."
        />
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Drafts</h2>
          <span className="muted small">Saved in this browser only</span>
        </div>
        <DataTable columns={draftColumns} rows={drafts} empty="No drafts saved." />
      </section>

      {form && (
        <RequestFormModal
          key={form.draft?.id ?? form.requestId ?? 'new'}
          mode={form.mode}
          requestId={form.requestId}
          draft={form.draft}
          onClose={() => setForm(null)}
          onDone={handleDone}
        />
      )}
      {showLoad && (
        <LoadDraftModal
          drafts={drafts}
          onClose={() => setShowLoad(false)}
          onLoad={(d) => {
            setShowLoad(false);
            setForm({ mode: 'new', draft: d });
          }}
        />
      )}
      {submitted && <SubmittedModal request={submitted} onClose={() => setSubmitted(null)} />}
    </AppLayout>
  );
}
