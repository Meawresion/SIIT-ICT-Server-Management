// One-off scheduler check on AWS (infra/scripts/smoke-test.sh, through run-task.sh). The backend
// service's own scheduler must act; this task only sets things up and waits:
// - an automated GPU request whose end date has passed gets its REVOKE (the result, from
//   infra/scripts/fake-site.mjs, completes it);
// - a VM request set up by hand gets its end-date reminder, then the approvers' notice once it ended;
// - a job put into the request dead-letter queue fails, as the approvers would be told.
// Run it with a short SCHEDULER_INTERVAL_SEC (the smoke test deploys 30). Its rows stay behind
// (the audit log can't be deleted), so run it only on a throwaway database.
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import prisma from '../src/lib/prisma.js';
import { loadSchedulerConfig } from '../src/config/scheduler.js';
import { createRequest } from '../src/services/request.service.js';
import { activateRequest, approveRequest } from '../src/services/reviewer.service.js';
import { siteToday } from '../src/services/scheduler.service.js';

const TIMEOUT_MS = 4 * 60_000;
const waitFor = async (label, fn) => {
  const end = Date.now() + TIMEOUT_MS;
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

try {
  const lease = await waitFor('the service to hold the scheduler lease', async () => {
    const row = await prisma.scheduler_lease.findUnique({ where: { name: 'scheduler' } });
    return row.owner && row.lease_until > new Date() && row;
  });
  console.log(`the backend service runs the scheduler every ${config.intervalSec} s (lease held by ${lease.owner.split(':')[0]})`);

  // A student ID with leading zeros, which SIIT doesn't issue.
  const sid = String(randomInt(10 ** 6)).padStart(10, '0');
  const student = await prisma.user.create({ data: { role: 'Student', fullname: 'Scheduler check', siitemail: `m${sid}@check.invalid`,
    phone_number: '0', s_id: sid, study_degree: 'Master', s_program: 'ICT' } });
  const approver = await prisma.user.create({ data: { role: 'Approver', fullname: 'Scheduler check approver', siitemail: `approver-${sid}@check.invalid`, phone_number: '0' } });
  const form = { purpose: 'Scheduler check', project_description: 'check', project_supervisor_name: 'Check', resource_type: 'HPC_GPU',
    justification: 'check', estimated_start_date: '2026-11-10', estimated_end_date: '2026-11-30', impact_score: 5, supervisor_confirmation: 'CONFIRMED' };

  // D7: an automated request whose end date has passed.
  const gpu = await createRequest(student.uid, form);
  await approveRequest(gpu.id, approver.uid, 'check', { confirm_overlap: true });
  await waitFor('the GPU request On Use', async () => (await status(gpu.id)) === 'On_Use');
  await prisma.request.update({ where: { rid: gpu.id }, data: { end_date: dayOffset(-1) } });
  console.log(`request ${gpu.id} ended yesterday; waiting for the scheduler's REVOKE and its result`);
  await waitFor('Completed', async () => (await status(gpu.id)) === 'Completed');
  assert.deepEqual(await events(gpu.id), ['CREATED', 'APPROVED', 'PROVISIONED', 'EXPIRED', 'REVOKED']);

  // FR-8.2, then D7 by hand (S8).
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
  await prisma.request.update({ where: { rid: waiting.id }, data: { status: 'Approved', extra_details: { gpu_node: 'check' } } });
  const job_id = randomUUID();
  await prisma.provision_job.create({ data: { job_id, rid: waiting.id, action: 'CREATE', status: 'Sent', sent_at: new Date(), attempts: 1,
    payload: { action: 'CREATE', gpuNode: 'check' } } });
  const sqs = new SQSClient({ region: process.env.AWS_REGION });
  await sqs.send(new SendMessageCommand({ QueueUrl: process.env.SQS_REQUEST_DLQ_URL,
    MessageBody: JSON.stringify({ v: 1, typ: 'job', jti: job_id, rid: waiting.id, exp: Math.floor(Date.now() / 1000) + 3600 }) }));
  console.log('put a job into the request dead-letter queue; waiting for the scheduler to fail it');
  const failed = await waitFor('the dead-lettered job Failed', () => prisma.provision_job.findFirst({ where: { job_id, status: 'Failed' } }));
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
