import app from './app.js';
import env, { checkEnv } from './config/env.js';
import { loadIdentityRules } from './config/identity.js';
import { provisioningConfig } from './config/provisioning.js';
import { loadMailConfig } from './config/mail.js';
import { loadSchedulerConfig } from './config/scheduler.js';
import prisma from './lib/prisma.js';
import { startProvisioning } from './messaging/index.js';
import { startScheduler } from './services/scheduler.service.js';
import { notifyRequestEvent } from './services/notify.service.js';
import { startAuditShipper } from './services/audit-log.service.js';
import { log } from './lib/log.js';

// Fail at start, not at the first request, when settings are missing or wrong.
checkEnv();
loadIdentityRules();
const provisioning = provisioningConfig();
const schedulerConfig = loadSchedulerConfig();
if (!loadMailConfig()) log('mail.off', { reason: 'no SMTP_HOST: status emails are only logged' });

const port = env.port;
const SHUTDOWN_TIMEOUT_MS = 10_000;

const server = app.listen(port, () => {
  log('server.started', { port, node_env: env.node_env });
});
const provisioner = provisioning ? await startProvisioning(provisioning, { log }) : null;
if (!provisioning) log('provision.off', { reason: 'no MESSAGE_TRANSPORT: GPU and Big Data requests are activated by hand' });
const scheduler = startScheduler(schedulerConfig, { provisioning, transport: provisioner?.transport, log, notify: notifyRequestEvent });
// The audit trail as log lines too, so on AWS it reaches S3 and outlives the database.
const auditShipper = startAuditShipper({ log });

// ECS sends SIGTERM on every deploy and scale-in: stop taking connections, let the requests in
// flight finish, then close the database pool. Exit anyway if that takes too long.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    log('server.stopping', { signal });
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
    server.close(async () => {
      await scheduler.stop();
      await auditShipper.stop();
      await provisioner?.stop();
      await prisma.$disconnect();
      process.exit(0);
    });
  });
}
