// The provisioning service (D34, SERVICE_ROLE=worker): the background work without HTTP. It sends
// the jobs to the site and applies the results, runs the scheduler and copies the audit trail. The
// API service only queues jobs in the outbox, so the site key and queues stay here.

import { checkEnv, serviceRole } from './config/env.js';
import { loadIdentityRules } from './config/identity.js';
import { provisioningConfig } from './config/provisioning.js';
import { loadMailConfig } from './config/mail.js';
import { loadSchedulerConfig } from './config/scheduler.js';
import prisma from './lib/prisma.js';
import { startBackground } from './background.js';
import { log } from './lib/log.js';

checkEnv();
if (serviceRole() !== 'worker') throw new Error('src/worker.js needs SERVICE_ROLE=worker');
loadIdentityRules();
provisioningConfig();
loadSchedulerConfig();
if (process.env.EVENT_BUS_NAME) log('mail.via_events', { bus: process.env.EVENT_BUS_NAME });
else if (!loadMailConfig()) log('mail.off', { reason: 'no SMTP_HOST: status emails are only logged' });

const SHUTDOWN_TIMEOUT_MS = 10_000;
const background = await startBackground({ log });
log('worker.started', {});

// ECS sends SIGTERM on every deploy: finish the work in hand, then close the database pool.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, async () => {
    log('worker.stopping', { signal });
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
    await background.stop();
    await prisma.$disconnect();
    process.exit(0);
  });
}
