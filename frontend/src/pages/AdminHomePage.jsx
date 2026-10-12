import { useCallback, useEffect, useState } from 'react';
import { getRequests } from '../api/reviewer.js';
import { resourceShort } from '../constants.js';
import { formatId, formatLocalDate } from '../utils/format.js';
import AppLayout from '../components/AppLayout.jsx';
import DataTable from '../components/DataTable.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import RequestFormModal from '../components/RequestFormModal.jsx';

export default function AdminHomePage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);
  const [toast, setToast] = useState('');

  const load = useCallback(() => {
    return getRequests()
      .then((data) => {
        setRows(data);
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const pending = rows.filter((r) => r.status === 'PENDING').sort((a, b) => a.created_at.localeCompare(b.created_at));
  const active = rows.filter((r) => r.status === 'APPROVED' || r.status === 'ACTIVE');

  const columns = (actionLabel) => [
    { key: 'id', label: 'ID', render: (r) => <span className="mono">{formatId(r.id)}</span> },
    { key: 'created_at', label: 'Request Date', render: (r) => formatLocalDate(r.created_at) },
    { key: 'student', label: 'Student', render: (r) => (<span className="stack"><span>{r.student_name}</span><small className="muted">{r.student_id}</small></span>) },
    { key: 'purpose', label: 'Project', className: 'col-wide' },
    { key: 'resource_type', label: 'Resource Type', render: (r) => resourceShort(r.resource_type) },
    { key: 'status', label: 'Request Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'action',
      label: '',
      className: 'col-action',
      render: (r) => <button type="button" className="table-link" onClick={() => setOpenId(r.id)}>{actionLabel}</button>,
    },
  ];

  return (
    <AppLayout>
      {toast && <div className="toast" role="status">{toast}</div>}
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <section className="section">
        <div className="section-head">
          <h1>Pending Requests</h1>
          {!loading && <span className="count-pill">{pending.length} waiting</span>}
        </div>
        <DataTable columns={columns('Review')} rows={pending} loading={loading} empty="Nothing waiting for review." />
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Active Requests</h2>
          <span className="muted small">Approved or in use</span>
        </div>
        <DataTable columns={columns('Inspect')} rows={active} loading={loading} empty="No approved or active requests." />
      </section>

      {openId && (
        <RequestFormModal
          key={openId}
          mode="review"
          requestId={openId}
          onClose={() => setOpenId(null)}
          onDone={(res) => {
            setOpenId(null);
            setToast(`${formatId(res.request.id)} is now ${res.request.status.toLowerCase()}.`);
            load();
          }}
        />
      )}
    </AppLayout>
  );
}
