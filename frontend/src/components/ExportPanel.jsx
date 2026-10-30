import { useState } from 'react';
import { exportCsv } from '../api/reviewer.js';
import { STATUS_LABEL } from '../constants.js';

const pad = (n) => String(n).padStart(2, '0');
const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Approvers' CSV export (FR-9.3): requests submitted in a date range, or their status history. */
export default function ExportPanel({ status }) {
  const today = new Date();
  const [from, setFrom] = useState(`${today.getFullYear()}-01-01`);
  const [to, setTo] = useState(dayOf(today));
  const [type, setType] = useState('requests');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const download = async () => {
    if (!from || !to || to < from) {
      setError('Pick a start date and an end date on or after it.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { blob, name } = await exportCsv({ type, from, to, status });
      const url = URL.createObjectURL(blob);
      const link = Object.assign(document.createElement('a'), { href: url, download: name });
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="export-panel">
      <summary>Export CSV</summary>
      <div className="export-body">
        <label>
          <span className="field-label">Contents</span>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="requests">Requests</option>
            <option value="events">Status history of those requests</option>
          </select>
        </label>
        <label>
          <span className="field-label">Submitted from</span>
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          <span className="field-label">to</span>
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary" onClick={download} disabled={busy}>
          {busy ? 'Preparing…' : 'Download'}
        </button>
      </div>
      <p className="hint">{status ? `Only ${STATUS_LABEL[status]} requests (the tab above).` : 'Every status (pick a tab above to narrow it).'} Up to two years at a time.</p>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
    </details>
  );
}
