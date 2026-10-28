import { formatDateTime } from '../utils/format.js';

const JOB_LABEL = {
  CREATE: { Queued: 'Waiting to be sent to the SIIT site', Sent: 'Being set up at the SIIT site', Succeeded: 'Set up; the student was emailed', Failed: 'Setup failed' },
  REVOKE: { Queued: 'Removal waiting to be sent', Sent: 'Access being removed', Succeeded: 'Access removed', Failed: 'Removal failed' },
};
const VPN_LABEL = { created: 'new VPN account', reactivated: 'VPN account re-enabled', kept: 'existing VPN kept', disabled: 'VPN disabled', skipped: 'VPN step off' };

/** Automatic setup through acc-prov-vm, for approvers (plan §4.3): node, job state, error. */
export default function ProvisioningPanel({ provisioning }) {
  const jobs = provisioning?.jobs ?? [];
  if (!provisioning?.automated && !jobs.length) return null;
  const last = jobs.at(-1);
  return (
    <section className="provisioning" aria-label="Automatic setup">
      <h3>Automatic setup</h3>
      {!last ? (
        <p className="muted">Starts when the request is approved{provisioning.gpu_node ? '' : '; the GPU node is chosen then'}.</p>
      ) : (
        <>
          <p className={`provisioning-state is-${last.status.toLowerCase()}`} role="status">
            <strong>{JOB_LABEL[last.action][last.status]}</strong>
            {provisioning.gpu_node && <span className="muted"> · node <span className="mono">{provisioning.gpu_node}</span></span>}
            {last.vpn && <span className="muted"> · {VPN_LABEL[last.vpn] ?? last.vpn}</span>}
          </p>
          {last.error && <p className="provisioning-error">{last.error}</p>}
          {jobs.length > 1 && (
            <details>
              <summary>Earlier attempts ({jobs.length - 1})</summary>
              <ul className="provisioning-jobs">
                {jobs.slice(0, -1).map((j) => (
                  <li key={j.id}>
                    {JOB_LABEL[j.action][j.status]} · {formatDateTime(j.completed_at ?? j.created_at)}
                    {j.error && <> · <span className="provisioning-error">{j.error}</span></>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
