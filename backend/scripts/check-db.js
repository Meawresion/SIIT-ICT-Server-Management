// Integration check: every test record is rolled back, including on failure.
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import prisma from '../src/lib/prisma.js';
import { loadIdentityRules } from '../src/config/identity.js';
import { setUserRoleByEmail } from '../src/services/role.service.js';
import { findOrCreateAccount } from '../src/services/auth.service.js';
import { createUserProfile, getUserByAccountId } from '../src/services/user.service.js';
import { createRequest, updateRequest, getUserRequests, getRequestById } from '../src/services/request.service.js';
import { approveRequest, activateRequest, completeRequest, getAllRequests, getRequestForReview } from '../src/services/reviewer.service.js';

const marker = randomUUID();
// Sign-in only accepts student and staff addresses (D25), so the check uses a student address
// built from those settings. Its ID starts with zeros, which SIIT doesn't issue.
const rules = loadIdentityRules();
const prefixes = JSON.parse(process.env.DEGREE_EMAIL_PREFIXES);
const prefix = prefixes.UNDERGRADUATE ?? Object.values(prefixes)[0];
const email = `${prefix}${String(randomInt(10 ** 6)).padStart(rules.digits, '0')}@${rules.studentDomain}`;
const rollback = new Error('Intentional test rollback');
const originalTransaction = prisma.$transaction.bind(prisma);
const restores = [];
try {
  await originalTransaction(async tx => {
    // Run the real services against one isolated, rollback-only transaction.
    for (const [model, methods] of Object.entries({ user: ['upsert', 'findUnique', 'update'], request: ['findFirst', 'findUnique', 'findMany'], request_event: ['findMany'] })) {
      for (const method of methods) {
        const original = prisma[model][method];
        restores.push(() => { prisma[model][method] = original; });
        prisma[model][method] = (...args) => tx[model][method](...args);
      }
    }
    const original = prisma.$transaction;
    restores.push(() => { prisma.$transaction = original; });
    prisma.$transaction = callback => callback(tx);
    const account = await findOrCreateAccount({ email, hd: rules.studentDomain, name: 'Integration check' });
    assert.equal(await getUserByAccountId(account.id), null);
    await createUserProfile(account.id, { student_id: 'TEST123', degree: 'DOCTORAL', program: 'ICT', phone_number: '0000000000' });
    assert.equal((await getUserByAccountId(account.id)).degree, 'DOCTORAL');
    await setUserRoleByEmail(email, 'Approver', tx);
    assert.equal((await tx.user.findUnique({ where: { uid: account.id } })).role, 'Approver');
    await setUserRoleByEmail(email, 'Student', tx);
    assert.equal((await tx.user.findUnique({ where: { uid: account.id } })).role, 'Student');
    await tx.draft.create({ data: { student_uid: account.id, por: 'Draft' } });
    // A VM is set up by hand, so this follows the manual path; check-provisioning.js covers the
    // automated GPU path (it needs a numeric student ID, and Mark as Active only follows a failed setup).
    const request = await createRequest(account.id, { purpose: 'Integration check', project_description: 'Test project', project_supervisor_name: 'Test supervisor', resource_type: 'VM', justification: 'Database verification', estimated_start_date: '2026-10-16', estimated_end_date: '2026-10-17', impact_score: 5, supervisor_confirmation: 'NOT_CONFIRMED' });
    assert.equal(request.status, 'PENDING');
    assert.equal(await tx.draft.findUnique({ where: { student_uid: account.id } }), null);
    assert.equal((await getUserRequests(account.id)).length, 1);
    assert.equal(await getRequestById(request.id, account.id + 1), null);
    assert.equal((await updateRequest(request.id, account.id, { purpose: 'Edited purpose', impact_score: 8 })).impact_score, 8);
    const reviewer = await tx.user.create({ data: { role: 'Approver', fullname: 'Test approver', siitemail: `approver-${marker}@example.invalid`, phone_number: '' } });
    // D28: a second request for the same resource and dates is flagged, and approving needs a confirmation.
    const second = await createRequest(account.id, { purpose: 'Overlap check', project_description: 'Test project', project_supervisor_name: 'Test supervisor', resource_type: 'VM', justification: 'Database verification', estimated_start_date: '2026-10-17', estimated_end_date: '2026-10-20', impact_score: 5, supervisor_confirmation: 'CONFIRMED' });
    assert.deepEqual((await getRequestForReview(request.id)).overlaps.map(o => o.id), [second.id]);
    await assert.rejects(approveRequest(request.id, reviewer.uid, 'Verified'), err => err.statusCode === 409 && err.overlaps[0].id === second.id);
    assert.equal((await approveRequest(request.id, reviewer.uid, 'Verified', { confirm_overlap: true })).status, 'APPROVED');
    assert.equal((await activateRequest(request.id, reviewer.uid)).status, 'ACTIVE');
    assert.equal((await getAllRequests({ status: 'ACTIVE', student_id: 'TEST123' })).some(r => r.id === request.id), true);
    assert.equal((await completeRequest(request.id, reviewer.uid)).status, 'COMPLETED');
    const saved = await getRequestById(request.id, account.id);
    assert.equal(saved.review_comment, 'Verified');
    assert.equal(saved.impact_score, 8);
    assert.ok(saved.updated_at instanceof Date);
    assert.doesNotThrow(() => JSON.stringify(saved));
    // FR-4.2, FR-5.5: the whole history, with the approver on every decision.
    assert.deepEqual(saved.events.map(e => [e.action, e.from, e.to]), [
      ['CREATED', null, 'PENDING'], ['EDITED', 'PENDING', 'PENDING'], ['APPROVED', 'PENDING', 'APPROVED'],
      ['ACTIVATED', 'APPROVED', 'ACTIVE'], ['COMPLETED', 'ACTIVE', 'COMPLETED']]);
    assert.deepEqual(saved.events[1].details.fields.sort(), ['impact_score', 'purpose']);
    assert.deepEqual(saved.events[2].details.confirmed_overlaps, [second.id]);
    const review = await getRequestForReview(request.id);
    assert.ok(review.events.slice(2).every(e => e.actor.name === 'Test approver' && e.actor.role === 'Approver'));
    assert.equal(saved.events[2].actor.name, undefined);
    throw rollback;
  }, { timeout: 30000 });
} catch (err) {
  if (err !== rollback) { console.error(err.message); process.exitCode = 1; }
} finally {
  for (const restore of restores.reverse()) restore();
  // FR-9.1: the app user (DB_USER) can't change or remove the log; MySQL checks the privilege before
  // it looks for rows, so this touches nothing.
  for (const statement of ['UPDATE request_event SET comment = comment WHERE eid = 0', 'DELETE FROM request_event WHERE eid = 0']) {
    try {
      await prisma.$executeRawUnsafe(statement);
      console.error(`The app database user may run: ${statement}`);
      process.exitCode = 1;
    } catch (err) {
      if (!/denied/i.test(err.message)) { console.error(err.message); process.exitCode = 1; }
    }
  }
  if (!process.exitCode) {
    assert.equal(await prisma.user.findUnique({ where: { siitemail: email } }), null);
    console.log('Database integration passed: sign-in, profile, draft cleanup, request create/read/edit, review lifecycle, overlap warning, status history, filters, JSON serialization; the app user may not update or delete the audit log; all test records rolled back.');
  }
  await prisma.$disconnect();
}
