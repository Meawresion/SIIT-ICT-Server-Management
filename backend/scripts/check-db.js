// Integration check: every test record is rolled back, including on failure.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../src/lib/prisma.js';
import { setUserRoleByEmail } from '../src/services/role.service.js';
import { findOrCreateAccount } from '../src/services/auth.service.js';
import { createUserProfile, getUserByAccountId } from '../src/services/user.service.js';
import { createRequest, updateRequest, getUserRequests, getRequestById } from '../src/services/request.service.js';
import { approveRequest, activateRequest, completeRequest, getAllRequests } from '../src/services/reviewer.service.js';

const marker = randomUUID();
const email = `integration-${marker}@example.invalid`;
const rollback = new Error('Intentional test rollback');
const originalTransaction = prisma.$transaction.bind(prisma);
const restores = [];
try {
  await originalTransaction(async tx => {
    // Run the real services against one isolated, rollback-only transaction.
    for (const [model, methods] of Object.entries({ user: ['upsert', 'findUnique', 'update'], request: ['findFirst', 'findUnique', 'findMany'] })) {
      for (const method of methods) {
        const original = prisma[model][method];
        restores.push(() => { prisma[model][method] = original; });
        prisma[model][method] = (...args) => tx[model][method](...args);
      }
    }
    const original = prisma.$transaction;
    restores.push(() => { prisma.$transaction = original; });
    prisma.$transaction = callback => callback(tx);
    const account = await findOrCreateAccount({ email, name: 'Integration check' });
    assert.equal(await getUserByAccountId(account.id), null);
    await createUserProfile(account.id, { student_id: 'TEST123', degree: 'DOCTORAL', program: 'ICT', phone_number: '0000000000' });
    assert.equal((await getUserByAccountId(account.id)).degree, 'DOCTORAL');
    await setUserRoleByEmail(email, 'Approver', tx);
    assert.equal((await tx.user.findUnique({ where: { uid: account.id } })).role, 'Approver');
    await setUserRoleByEmail(email, 'Student', tx);
    assert.equal((await tx.user.findUnique({ where: { uid: account.id } })).role, 'Student');
    await tx.draft.create({ data: { student_uid: account.id, por: 'Draft' } });
    const request = await createRequest(account.id, { purpose: 'Integration check', project_description: 'Test project', project_supervisor_name: 'Test supervisor', resource_type: 'HPC_GPU', justification: 'Database verification', estimated_start_date: '2026-10-16', estimated_end_date: '2026-10-17', impact_score: 5, supervisor_confirmation: 'NOT_CONFIRMED' });
    assert.equal(request.status, 'PENDING');
    assert.equal(await tx.draft.findUnique({ where: { student_uid: account.id } }), null);
    assert.equal((await getUserRequests(account.id)).length, 1);
    assert.equal(await getRequestById(request.id, account.id + 1), null);
    assert.equal((await updateRequest(request.id, account.id, { purpose: 'Edited purpose', impact_score: 8 })).impact_score, 8);
    const reviewer = await tx.user.create({ data: { role: 'Approver', fullname: 'Test approver', siitemail: `approver-${marker}@example.invalid`, phone_number: '' } });
    assert.equal((await approveRequest(request.id, reviewer.uid, 'Verified')).status, 'APPROVED');
    assert.equal((await activateRequest(request.id, reviewer.uid)).status, 'ACTIVE');
    assert.equal((await getAllRequests({ status: 'ACTIVE', student_id: 'TEST123' })).some(r => r.id === request.id), true);
    assert.equal((await completeRequest(request.id, reviewer.uid)).status, 'COMPLETED');
    const saved = await getRequestById(request.id, account.id);
    assert.equal(saved.review_comment, 'Verified');
    assert.equal(saved.impact_score, 8);
    assert.ok(saved.updated_at instanceof Date);
    assert.doesNotThrow(() => JSON.stringify(saved));
    throw rollback;
  }, { timeout: 30000 });
} catch (err) {
  if (err !== rollback) { console.error(err.message); process.exitCode = 1; }
} finally {
  for (const restore of restores.reverse()) restore();
  if (!process.exitCode) {
    assert.equal(await prisma.user.findUnique({ where: { siitemail: email } }), null);
    console.log('Database integration passed: sign-in, profile, draft cleanup, request create/read/edit, review lifecycle, filters, JSON serialization; all test records rolled back.');
  }
  await prisma.$disconnect();
}
