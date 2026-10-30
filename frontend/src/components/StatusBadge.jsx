import { STATUS_LABEL } from '../constants.js';

// extensionAsked: a request in use whose student asked for a later end date (FR-8.3).
export default function StatusBadge({ status, extensionAsked = false }) {
  const badge = <span className={`badge badge-${status.toLowerCase()}`}>{STATUS_LABEL[status] ?? status}</span>;
  if (!extensionAsked) return badge;
  return (
    <span className="badge-group">
      {badge}
      <span className="badge badge-ask">More time asked</span>
    </span>
  );
}
