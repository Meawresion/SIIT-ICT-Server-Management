import { formatDateTime, formatId } from '../utils/format.js';

const ACTION_LABEL = {
  CREATED: 'Submitted',
  EDITED: 'Edited',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  ACTIVATED: 'Marked as active',
  COMPLETED: 'Completed',
  REOPENED: 'Reopened',
  PROVISIONED: 'Access set up',
  PROVISION_FAILED: 'Setup failed',
  REVOKED: 'Access removed',
  REVOKE_FAILED: 'Access removal failed',
  RETRIED: 'Setup retried',
};
const VPN_NOTE = { created: 'New VPN account.', reactivated: 'VPN account re-enabled.', kept: 'Existing VPN account kept.', disabled: 'VPN account disabled.' };

const FIELD_LABEL = {
  purpose: 'project title',
  project_name: 'project name',
  project_description: 'description',
  project_supervisor_name: 'supervisor',
  project_supervisor_email: 'supervisor email',
  justification: 'justification',
  estimated_start_date: 'start date',
  estimated_end_date: 'end date',
  impact_score: 'criticality',
  supervisor_confirmation: 'supervisor confirmation',
};

// Students get the actor's role only; approvers also get the name (the API decides).
function actorLabel(actor, mine) {
  if (actor.name) return actor.name;
  if (actor.role === 'System') return 'the system';
  if (actor.role === 'Approver') return 'SIIT ICT approver';
  return mine ? 'You' : 'Student';
}

/** Status history of one request (FR-4.2), oldest first, from the append-only request_event log. */
export default function RequestHistory({ events, mine }) {
  if (!events?.length) return null;
  return (
    <section className="history" aria-label="Status history">
      <h3>Status history</h3>
      <ol className="timeline">
        {events.map((e) => {
          const fields = e.details?.fields?.map((f) => FIELD_LABEL[f] ?? f.replaceAll('_', ' '));
          const confirmed = e.details?.confirmed_overlaps;
          return (
            <li key={e.id} className={`timeline-item is-${e.action.toLowerCase()}`}>
              <div className="timeline-head">
                <strong>{ACTION_LABEL[e.action] ?? e.action.toLowerCase()}</strong>
                <span className="muted">by {actorLabel(e.actor, mine)}</span>
                <time className="muted" dateTime={e.at}>{formatDateTime(e.at)}</time>
              </div>
              {fields?.length > 0 && <p className="timeline-note">Changed: {fields.join(', ')}</p>}
              {e.comment && <p className="timeline-note">“{e.comment}”</p>}
              {confirmed?.length > 0 && (
                <p className="timeline-note">Approved despite overlapping {confirmed.length === 1 ? 'request' : 'requests'} {confirmed.map(formatId).join(', ')}</p>
              )}
              {e.action === 'PROVISIONED' && mine && <p className="timeline-note">Your login details were emailed to your SIIT address.</p>}
              {e.details?.gpu_node && !mine && <p className="timeline-note">GPU node <span className="mono">{e.details.gpu_node}</span>{VPN_NOTE[e.details.vpn] ? `. ${VPN_NOTE[e.details.vpn]}` : ''}</p>}
              {e.details?.backfilled && <p className="timeline-note muted">From records made before the history was kept.</p>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
