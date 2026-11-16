// One-off scheduler check on AWS (infra/scripts/smoke-test.sh), in a request service task:
//   run-task.sh node scripts/check-scheduler.js <marker>
// For the dead letter it logs check.dead_letter_ready; the smoke test then puts that job's message
// into the request dead-letter queue, as the queue's redrive would.
// It uses the accounts check-identity.js added for the marker; check-grants.js in the provisioning
// service has already seen its scheduler take the lease. That scheduler must act; this task only
// sets things up and waits:
// - an automated GPU request whose end date has passed gets its REVOKE (the result, from
//   infra/scripts/fake-site.mjs, completes it);
// - a VM request set up by hand gets its end-date reminder, then the approvers' notice once it ended;
// - a job put into the request dead-letter queue fails, as the approvers would be told.
// Run it with a short SCHEDULER_INTERVAL_SEC (the smoke test deploys 30). Its rows stay behind
// (the audit log can't be deleted), so run it only on a throwaway database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../src/lib/prisma.js';
import { loadSchedulerConfig } from '../src/config/scheduler.js';
import { createRequest } from '../src/services/request.service.js';
import { activateRequest, approveRequest } from '../src/services/reviewer.service.js';
import { siteToday } from '../src/services/scheduler.service.js';

// The check's approver isn't on the task's APPROVER_EMAILS: these checks test the database flow
// with the role column (as without the list; check-identity tests the list).
delete process.env.APPROVER_EMAILS;

const TIMEOUT_MS = 4 * 60_000;
// The smoke test finds the ready line through CloudWatch Logs Insights, which takes a few minutes.
const DEAD_LETTER_TIMEOUT_MS = 12 * 60_000;
const waitFor = async (label, fn, timeoutMs = TIMEOUT_MS) => {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await new Promise(r => setTimeout(r, 2000));
  }
};
const config = loadSchedulerConfig();
const today = siteToday(config.timeZone);
const dayOffset = (n) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000);
const events = async (rid) => (await prisma.request_event.findMany({ where: { rid }, orderBy: { eid: 'asc' } })).map(e => e.action);
const status = async (rid) => (await prisma.request.findUnique({ where: { rid } })).status;
const marker = process.argv[2];
// The accounts check-identity.js added, found by the marker in their name.
const account = (name) => prisma.user.findFirstOrThrow({ where: { fullname: `Check ${name} ${marker}` } });

try {
  if (!marker) {
    throw new Error('Usage: node scripts/check-scheduler.js <marker> (after check-identity.js <marker>)');
  }
  console.log(`site day ${today} (${config.timeZone}); the provisioning service's scheduler must act`);
  // Its student ID starts with zeros, which SIIT doesn't issue.
  const student = await account('scheduler');
  const approver = await account('approver');
  const form = { purpose: 'Scheduler check', project_description: 'check', project_supervisor_name: 'Check', resource_type: 'HPC_GPU',
    justification: 'check', estimated_start_date: '2026-11-10', estimated_end_date: '2026-11-30', impact_score: 5, supervisor_confirmation: 'CONFIRMED' };

  // An automated request whose end date has passed.
  const gpu = await createRequest(student.uid, form);
  await approveRequest(gpu.id, approver.uid, 'check', { confirm_overlap: true });
  await waitFor('the GPU request On Use', async () => (await status(gpu.id)) === 'On_Use');
  await prisma.request.update({ where: { rid: gpu.id }, data: { end_date: dayOffset(-1) } });
  console.log(`request ${gpu.id} ended yesterday; waiting for the scheduler's REVOKE and its result`);
  await waitFor('Completed', async () => (await status(gpu.id)) === 'Completed');
  assert.deepEqual(await events(gpu.id), ['CREATED', 'APPROVED', 'PROVISIONED', 'EXPIRED', 'REVOKED']);

  // FR-8.2, then the approvers are asked to turn off a request set up by hand.
  const vm = await createRequest(student.uid, { ...form, resource_type: 'VM' });
  await approveRequest(vm.id, approver.uid, 'check', { confirm_overlap: true });
  await activateRequest(vm.id, approver.uid);
  await prisma.request.update({ where: { rid: vm.id }, data: { end_date: dayOffset(1) } });
  await waitFor('the reminder', async () => (await events(vm.id)).includes('REMINDED'));
  await prisma.request.update({ where: { rid: vm.id }, data: { end_date: dayOffset(-1) } });
  await waitFor('the approvers notice', async () => (await events(vm.id)).includes('EXPIRED'));
  const notice = await prisma.request_event.findFirst({ where: { rid: vm.id, action: 'EXPIRED' } });
  assert.equal(notice.details.by_hand, true);
  assert.equal(await status(vm.id), 'On_Use', 'set up by hand: an approver completes it');
  console.log(`request ${vm.id}: reminder, then the approvers asked to turn it off`);

  // FR-6.7: a job the site gave up on, as the request queue's redrive would leave it in the DLQ.
  const waiting = await createRequest(student.uid, { ...form, estimated_start_date: '2026-12-01', estimated_end_date: '2026-12-10' });
  await prisma.request.update({ where: { rid: waiting.id }, data: { status: 'Approved', gpu_node: 'check' } });
  const job_id = randomUUID();
  await prisma.provision_job.create({ data: { job_id, rid: waiting.id, action: 'CREATE', status: 'Sent', sent_at: new Date(), attempts: 1,
    payload: { action: 'CREATE', gpuNode: 'check' } } });
  // The smoke test (admin credentials) puts its message into the request dead-letter queue when it
  // sees this line: the service roles can't write to a dead-letter queue.
  console.log(JSON.stringify({ event: 'check.dead_letter_ready', job_id, rid: waiting.id }));
  console.log('waiting for the job in the request dead-letter queue, then for the scheduler to fail it');
  const failed = await waitFor('the dead-lettered job Failed', () => prisma.provision_job.findFirst({ where: { job_id, status: 'Failed' } }),
    DEAD_LETTER_TIMEOUT_MS);
  assert.match(failed.last_error, /refused the job/);
  assert.deepEqual(await events(waiting.id), ['CREATED', 'PROVISION_FAILED']);
  assert.equal(await status(waiting.id), 'Approved');

  console.log('Scheduler check passed: expiry REVOKE, reminder, notice by hand, dead letter');
} catch (err) {
  console.error(`Scheduler check failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
