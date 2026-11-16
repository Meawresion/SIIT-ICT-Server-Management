import app from './app.js';
import env, { checkEnv, serviceRole, servesRequests } from './config/env.js';
import { loadIdentityRules } from './config/identity.js';
import { provisioningConfig } from './config/provisioning.js';
import { loadMailConfig } from './config/mail.js';
import { loadSchedulerConfig } from './config/scheduler.js';
import prisma from './lib/prisma.js';
import { startBackground } from './background.js';
import { log } from './lib/log.js';

// Fail at start, not at the first request, when settings are missing or wrong.
checkEnv();
const role = serviceRole();
if (role === 'worker') throw new Error('SERVICE_ROLE=worker runs src/worker.js, not the API');
loadIdentityRules();
if (servesRequests(role)) {
  provisioningConfig();
  loadSchedulerConfig();
}
if (process.env.EVENT_BUS_NAME) log('mail.via_events', { bus: process.env.EVENT_BUS_NAME });
else if (!loadMailConfig()) log('mail.off', { reason: 'no SMTP_HOST: status emails are only logged' });

const port = env.port;
const SHUTDOWN_TIMEOUT_MS = 10_000;

const server = app.listen(port, () => {
  log('server.started', { port, node_env: env.node_env, role });
});
// On AWS (api, identity, requests) the provisioning service does the background work.
const background = role === 'all' ? await startBackground({ log }) : null;

// ECS sends SIGTERM on every deploy and scale-in: stop taking connections, let the requests in
// flight finish, then close the database pool. Exit anyway if that takes too long.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    log('server.stopping', { signal });
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
    server.close(async () => {
      await background?.stop();
      await prisma.$disconnect();
      process.exit(0);
    });
  });
}
