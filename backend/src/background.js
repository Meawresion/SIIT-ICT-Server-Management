// The background work (D34: the provisioning service on AWS; inside the API process locally):
// the outbox dispatcher and result consumer, the scheduler and the audit shipper.

import { provisioningConfig } from './config/provisioning.js';
import { loadSchedulerConfig } from './config/scheduler.js';
import { startProvisioning } from './messaging/index.js';
import { startScheduler } from './services/scheduler.service.js';
import { notifyRequestEvent } from './services/notify.service.js';
import { startAuditShipper } from './services/audit-log.service.js';

// -> { stop() }
export async function startBackground({ log }) {
  const provisioning = provisioningConfig();
  const provisioner = provisioning ? await startProvisioning(provisioning, { log }) : null;
  if (!provisioning) log('provision.off', { reason: 'no MESSAGE_TRANSPORT: GPU and Big Data requests are activated by hand' });
  const scheduler = startScheduler(loadSchedulerConfig(), { provisioning, transport: provisioner?.transport, log, notify: notifyRequestEvent });
  // The audit trail copied out of the database (on AWS: the audit log group), so it outlives the database.
  const auditShipper = startAuditShipper({ log });
  return {
    async stop() {
      await scheduler.stop();
      await auditShipper.stop();
      await provisioner?.stop();
    },
  };
}
