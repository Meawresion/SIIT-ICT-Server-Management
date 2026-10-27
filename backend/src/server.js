import app from './app.js';
import env, { checkEnv } from './config/env.js';
import { loadIdentityRules } from './config/identity.js';
import prisma from './lib/prisma.js';

// Fail at start, not at the first request, when settings are missing or wrong.
checkEnv();
loadIdentityRules();

const port = env.port;
const SHUTDOWN_TIMEOUT_MS = 10_000;

const server = app.listen(port, () => {
  console.log(`Server running on port ${port} (${env.node_env})`);
});

// ECS sends SIGTERM on every deploy and scale-in: stop taking connections, let the requests in
// flight finish, then close the database pool. Exit anyway if that takes too long.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    console.log(`${signal} received, shutting down`);
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  });
}
