// TLS check (D31): this task's connection to MySQL is encrypted, and with DB_TLS=verify (RDS) the
// server certificate and host name were checked (Prisma refuses the connection otherwise).
// Run it in a service task (infra/scripts/smoke-test.sh): run-task.sh node scripts/check-db-tls.js
// Pass the expected mode to check that too: check-db-tls.js verify | encrypt
import prisma from '../src/lib/prisma.js';

const want = process.argv[2];
const mode = process.env.DB_TLS || 'none';
try {
  const [row] = await prisma.$queryRaw`SHOW SESSION STATUS LIKE 'Ssl_cipher'`;
  const cipher = row?.Value ?? '';
  console.log(`DB_TLS=${mode}, cipher: ${cipher || 'none (not encrypted)'}`);
  if (!cipher) throw new Error('the connection is not encrypted');
  if (want && mode !== want) throw new Error(`DB_TLS is ${mode}, expected ${want}`);
  console.log('check-db-tls: OK');
} catch (err) {
  console.error(`check-db-tls: FAIL: ${err.message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
