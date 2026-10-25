import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/context.js';
import { getMyRequests } from '../api/requests.js';
import { getRequests } from '../api/reviewer.js';
import { RESOURCE_TYPES, STATUSES, STATUS_LABEL, resourceShort } from '../constants.js';
import { formatId, formatLocalDate, formatPeriod } from '../utils/format.js';
import AppLayout from '../components/AppLayout.jsx';
import DataTable from '../components/DataTable.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import RequestFormModal from '../components/RequestFormModal.jsx';

export default function HistoryPage() {
  const auth = useAuth();
  const isReviewer = auth.role === 'reviewer';
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fetcher = isReviewer ? getRequests() : getMyRequests();
    fetcher
      .then((data) => {
        if (cancelled) return;
        setRows(data);
        setError('');
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [isReviewer, reloadKey]);

  const counts = useMemo(() => {
    const c = { '': rows.length };
    for (const s of STATUSES) c[s] = rows.filter((r) => r.status === s).length;
    return c;
  }, [rows]);

  const q = search.trim().toLowerCase();
  const visible = rows
    .filter((r) => !status || r.status === status)
    .filter((r) => !type || r.resource_type === type)
    .filter((r) => !q || [r.purpose, r.student_name, r.student_id, formatId(r.id)].some((v) => v && String(v).toLowerCase().includes(q)));

  const columns = [
    { key: 'id', label: 'ID', render: (r) => <span className="mono">{formatId(r.id)}</span> },
    { key: 'created_at', label: 'Request Date', render: (r) => formatLocalDate(r.created_at) },
    ...(isReviewer
      ? [{ key: 'student', label: 'Student', render: (r) => (<span className="stack"><span>{r.student_name}</span><small className="muted">{r.student_id}</small></span>) }]
      : []),
    { key: 'purpose', label: 'Project', className: 'col-wide' },
    { key: 'resource_type', label: 'Resource Type', render: (r) => resourceShort(r.resource_type) },
    ...(isReviewer
      ? [{ key: 'reviewed_at', label: 'Decided', render: (r) => formatLocalDate(r.reviewed_at) }]
      : [{ key: 'period', label: 'Requested Period', render: (r) => formatPeriod(r.estimated_start_date, r.estimated_end_date) }]),
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'action',
      label: '',
      className: 'col-action',
      render: (r) => (
        <button type="button" className="table-link" onClick={() => setOpen(r.id)}>
          {isReviewer ? (r.status === 'PENDING' ? 'Review' : 'Inspect') : 'View'}
        </button>
      ),
    },
  ];

  return (
    <AppLayout>
      <section className="section">
        <div className="section-head">
          <h1>Request History</h1>
          <span className="muted small">{isReviewer ? 'Every request in the system' : 'Everything you have submitted'}</span>
        </div>

        <div className="filter-bar">
          <div className="tabs" role="tablist" aria-label="Filter by status">
            {['', ...STATUSES].map((s) => (
              <button key={s || 'all'} type="button" role="tab" aria-selected={status === s} className={status === s ? 'is-active' : ''} onClick={() => setStatus(s)}>
                {s ? STATUS_LABEL[s] : 'All'} <span className="tab-count">{counts[s] ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="filter-inputs">
            <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by resource type">
              <option value="">All resources</option>
              {RESOURCE_TYPES.map((r) => <option key={r.value} value={r.value}>{r.short}</option>)}
            </select>
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={isReviewer ? 'Search project, student, ID…' : 'Search project or ID…'} aria-label="Search" />
          </div>
        </div>

        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <DataTable columns={columns} rows={visible} loading={loading} empty="No requests match these filters." />
      </section>

      {open && (
        <RequestFormModal
          key={open}
          mode={isReviewer ? 'review' : 'view'}
          requestId={open}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </AppLayout>
  );
}
