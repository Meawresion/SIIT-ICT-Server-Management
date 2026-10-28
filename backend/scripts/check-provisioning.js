// One-off provisioning check on AWS (infra/scripts/smoke-test.sh, through run-task.sh): approves a
// GPU request so the running backend service sends the CREATE job through SQS, waits until the
// result (from infra/scripts/fake-site.mjs, playing acc-prov-vm) makes the request On Use, then
// completes it and waits for the REVOKE result.
// Its rows stay behind (the audit log can't be deleted), so run it only on a throwaway database.
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import prisma from '../src/lib/prisma.js';
import { createRequest } from '../src/services/request.service.js';
import { approveRequest, completeRequest } from '../src/services/reviewer.service.js';

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

try {
  // A student ID with leading zeros, which SIIT doesn't issue.
  const sid = String(randomInt(10 ** 6)).padStart(10, '0');
  const student = await prisma.user.create({ data: { role: 'Student', fullname: 'Provisioning check', siitemail: `m${sid}@check.invalid`,
    phone_number: '0', s_id: sid, study_degree: 'Master', s_program: 'ICT' } });
  const approver = await prisma.user.create({ data: { role: 'Approver', fullname: 'Provisioning check approver', siitemail: `approver-${sid}@check.invalid`, phone_number: '0' } });
  const request = await createRequest(student.uid, { purpose: 'Provisioning check', project_description: 'check', project_supervisor_name: 'Check',
    resource_type: 'HPC_GPU', justification: 'check', estimated_start_date: '2026-11-10', estimated_end_date: '2026-11-30', impact_score: 5,
    supervisor_confirmation: 'CONFIRMED' });

  await approveRequest(request.id, approver.uid, 'check');
  console.log(`approved request ${request.id} for stm${sid}; waiting for the CREATE result through SQS`);
  await waitFor('On Use', async () => (await prisma.request.findUnique({ where: { rid: request.id } })).status === 'On_Use');
  const create = await prisma.provision_job.findFirst({ where: { rid: request.id, action: 'CREATE' } });
  assert.equal(create.status, 'Succeeded');
  assert.equal(create.payload.student.username, `stm${sid}`);

  await completeRequest(request.id, approver.uid);
  console.log('completed; waiting for the REVOKE result');
  await waitFor('REVOKE result', () => prisma.provision_job.findFirst({ where: { rid: request.id, action: 'REVOKE', status: 'Succeeded' } }));
  const events = (await prisma.request_event.findMany({ where: { rid: request.id }, orderBy: { eid: 'asc' } })).map(e => e.action);
  assert.deepEqual(events, ['CREATED', 'APPROVED', 'PROVISIONED', 'COMPLETED', 'REVOKED']);
  console.log(`Provisioning check passed: ${events.join(' -> ')}`);
} catch (err) {
  console.error(`Provisioning check failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
