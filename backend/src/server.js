import app from './app.js';
import env, { checkEnv } from './config/env.js';
import { loadIdentityRules } from './config/identity.js';
import { provisioningConfig } from './config/provisioning.js';
import { loadMailConfig } from './config/mail.js';
import prisma from './lib/prisma.js';
import { startProvisioning } from './messaging/index.js';

// Fail at start, not at the first request, when settings are missing or wrong.
checkEnv();
loadIdentityRules();
const provisioning = provisioningConfig();
if (!loadMailConfig()) console.log('Status emails are off (no SMTP_HOST): they are only logged');

// JSON lines, like acc-prov-vm; never message plaintext or secrets.
const log = (event, fields = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));

const port = env.port;
const SHUTDOWN_TIMEOUT_MS = 10_000;

const server = app.listen(port, () => {
  console.log(`Server running on port ${port} (${env.node_env})`);
});
const provisioner = provisioning ? await startProvisioning(provisioning, { log }) : null;
if (!provisioning) console.log('Automatic provisioning is off (no MESSAGE_TRANSPORT): GPU requests are activated by hand');

// ECS sends SIGTERM on every deploy and scale-in: stop taking connections, let the requests in
// flight finish, then close the database pool. Exit anyway if that takes too long.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    console.log(`${signal} received, shutting down`);
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
    server.close(async () => {
      await provisioner?.stop();
      await prisma.$disconnect();
      process.exit(0);
    });
  });
}
