// Least privilege check (FR-9.1): the database user of this task (DB_USER) may run exactly the
// statements its service needs on each table, and nothing else. Every statement matches no rows,
// and MySQL checks the privilege before it looks for rows, so this changes nothing.
// Run it in each service (infra/scripts/smoke-test.sh, through run-task.sh):
//   run-task.sh --identity node scripts/check-grants.js
//   run-task.sh node scripts/check-grants.js
//   run-task.sh --provisioning node scripts/check-grants.js
// The service comes from SERVICE_ROLE (all, identity, requests, worker). The provisioning
// service's check also waits for its scheduler to hold the lease, which only it may read.
import prisma from '../src/lib/prisma.js';

// The rights of each service (database/privileges.sh), written out again on purpose: a change to
// one of them must be made to the other too.
const S = 'SELECT', I = 'INSERT', U = 'UPDATE', D = 'DELETE';
const RIGHTS = {
  all: {
    user: [S, I, U, D], request: [S, I, U, D], draft: [S, I, U, D], request_extension: [S, I, U], request_event: [S, I],
    provision_job: [S, I, U], scheduler_lease: [S, U], log_cursor: [S, U],
  },
  identity: { user: [S, I, U] },
  requests: { user: [S], request: [S, I, U], draft: [S, I, U, D], request_extension: [S, I, U], request_event: [S, I], provision_job: [S, I] },
  worker: {
    user: [S], request: [S, U], request_event: [S, I], provision_job: [S, I, U],
    scheduler_lease: [S, U], log_cursor: [S, U],
  },
};
// A column of each table (its primary key) for the INSERT and UPDATE statements.
const KEY = {
  user: 'uid', request: 'rid', draft: 'did', request_extension: 'xid', request_event: 'eid',
  provision_job: 'job_id', scheduler_lease: 'name', log_cursor: 'name',
};
const STATEMENT = {
  [S]: (t) => `SELECT 1 FROM \`${t}\` LIMIT 0`,
  [I]: (t, k) => `INSERT INTO \`${t}\` (\`${k}\`) SELECT NULL FROM DUAL WHERE FALSE`,
  [U]: (t, k) => `UPDATE \`${t}\` SET \`${k}\` = \`${k}\` WHERE FALSE`,
  [D]: (t) => `DELETE FROM \`${t}\` WHERE FALSE`,
};

// -> the problems found for this role ([] when the user has exactly its rights).
export async function checkGrants(db, role) {
  const rights = RIGHTS[role];
  if (!rights) throw new Error(`Unknown SERVICE_ROLE ${role}`);
  const problems = [];
  for (const [table, key] of Object.entries(KEY)) {
    for (const [right, statement] of Object.entries(STATEMENT)) {
      const expected = (rights[table] ?? []).includes(right);
      let allowed;
      try {
        await db.$executeRawUnsafe(statement(table, key));
        allowed = true;
      } catch (err) {
        if (!/denied/i.test(err.message)) throw err;
        allowed = false;
      }
      if (allowed !== expected) problems.push(`${right} on ${table} is ${allowed ? 'allowed' : 'denied'}, expected ${expected ? 'allowed' : 'denied'}`);
    }
  }
  return problems;
}

// Run as a script (not when another check imports checkGrants).
if (process.argv[1]?.endsWith('check-grants.js')) {
  const role = process.env.SERVICE_ROLE ?? 'all';
  try {
    const problems = await checkGrants(prisma, role);
    if (problems.length) throw new Error(problems.join('; '));
    if (role === 'worker') {
      const end = Date.now() + 120_000;
      let lease;
      while (!(lease = await prisma.scheduler_lease.findUnique({ where: { name: 'scheduler' } }))?.owner || lease.lease_until <= new Date()) {
        if (Date.now() > end) throw new Error('the scheduler did not take its lease in 2 minutes');
        await new Promise(r => setTimeout(r, 2000));
      }
      console.log(`the scheduler holds its lease (${lease.owner.split(':')[0]})`);
    }
    console.log(`Grants check passed: ${process.env.DB_USER} (SERVICE_ROLE=${role}) has exactly ${JSON.stringify(RIGHTS[role])}`);
  } catch (err) {
    console.error(`Grants check failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
