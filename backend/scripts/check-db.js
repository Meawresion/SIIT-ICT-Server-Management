// Integration check of the request service's database work. Every record is rolled back,
// including on failure; then the database user must have exactly its rights (check-grants.js).
//   npm run test:db  (docker compose, SERVICE_ROLE=all): adds its two accounts in the transaction.
//   run-task.sh node scripts/check-db.js <marker>  (request service task, D34): uses the accounts
//     check-identity.js added for the marker, since this service's database user may only read them.
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import prisma from '../src/lib/prisma.js';
import { createRequest, updateRequest, getUserRequests, getRequestById } from '../src/services/request.service.js';
import { approveRequest, activateRequest, completeRequest, getAllRequests, getRequestForReview } from '../src/services/reviewer.service.js';
import { checkGrants } from './check-grants.js';

// The check's approver isn't on the task's APPROVER_EMAILS: these checks test the database flow
// with the role column (as without the list; check-identity tests the list).
delete process.env.APPROVER_EMAILS;

const marker = process.argv[2];
// The accounts check-identity.js added, found by the marker in their name.
const account = (name) => prisma.user.findFirstOrThrow({ where: { fullname: `Check ${name} ${marker}` } });
const rollback = new Error('Intentional test rollback');
const originalTransaction = prisma.$transaction.bind(prisma);
const restores = [];
let student;
try {
  await originalTransaction(async tx => {
    let reviewer;
    if (marker) {
      student = await account('db');
      reviewer = await account('approver');
    } else {
      // Its student ID starts with zeros, which SIIT doesn't issue.
      const sid = String(randomInt(10 ** 6)).padStart(10, '0');
      student = await tx.user.create({ data: { role: 'Student', fullname: 'Check db', siitemail: `db-${randomUUID()}@check.invalid`,
        phone_number: '0', s_id: sid, study_degree: 'Master', s_program: 'ICT' } });
      reviewer = await tx.user.create({ data: { role: 'Approver', fullname: 'Check approver', siitemail: `approver-${randomUUID()}@check.invalid`, phone_number: '0' } });
    }
    // Run the real services against one isolated, rollback-only transaction.
    for (const [model, methods] of Object.entries({ user: ['findUnique'], request: ['findFirst', 'findUnique', 'findMany', 'count'], request_event: ['findMany'] })) {
      for (const method of methods) {
        const original = prisma[model][method];
        restores.push(() => { prisma[model][method] = original; });
        prisma[model][method] = (...args) => tx[model][method](...args);
      }
    }
    const original = prisma.$transaction;
    restores.push(() => { prisma.$transaction = original; });
    prisma.$transaction = callback => callback(tx);
    await tx.draft.create({ data: { student_uid: student.uid, por: 'Draft' } });
    // A VM is set up by hand, so this follows the manual path; check-provisioning.js covers the
    // automated GPU path (Mark as Active only follows a failed setup there).
    const request = await createRequest(student.uid, { purpose: 'Integration check', project_description: 'Test project', project_supervisor_name: 'Test supervisor', resource_type: 'VM', justification: 'Database verification', estimated_start_date: '2026-10-16', estimated_end_date: '2026-10-17', impact_score: 5, supervisor_confirmation: 'NOT_CONFIRMED' });
    assert.equal(request.status, 'PENDING');
    assert.equal(await tx.draft.findUnique({ where: { student_uid: student.uid } }), null);
    assert.equal((await getUserRequests(student.uid)).total, 1);
    assert.equal(await getRequestById(request.id, student.uid + 1), null);
    assert.equal((await updateRequest(request.id, student.uid, { purpose: 'Edited purpose', impact_score: 8 })).impact_score, 8);
    // D28: a second request for the same resource and dates is flagged, and approving needs a confirmation.
    const second = await createRequest(student.uid, { purpose: 'Overlap check', project_description: 'Test project', project_supervisor_name: 'Test supervisor', resource_type: 'VM', justification: 'Database verification', estimated_start_date: '2026-10-17', estimated_end_date: '2026-10-20', impact_score: 5, supervisor_confirmation: 'CONFIRMED' });
    assert.deepEqual((await getRequestForReview(request.id)).overlaps.map(o => o.id), [second.id]);
    await assert.rejects(approveRequest(request.id, reviewer.uid, 'Verified'), err => err.statusCode === 409 && err.overlaps[0].id === second.id);
    assert.equal((await approveRequest(request.id, reviewer.uid, 'Verified', { confirm_overlap: true })).status, 'APPROVED');
    assert.equal((await activateRequest(request.id, reviewer.uid)).status, 'ACTIVE');
    assert.equal((await getAllRequests({ status: 'ACTIVE', student_id: student.s_id })).rows.some(r => r.id === request.id), true);
    assert.equal((await completeRequest(request.id, reviewer.uid)).status, 'COMPLETED');
    const saved = await getRequestById(request.id, student.uid);
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
    assert.ok(review.events.slice(2).every(e => e.actor.name === reviewer.fullname && e.actor.role === 'Approver'));
    assert.equal(saved.events[2].actor.name, undefined);
    throw rollback;
  }, { timeout: 30000 });
} catch (err) {
  if (err !== rollback) { console.error(err.message); process.exitCode = 1; }
} finally {
  for (const restore of restores.reverse()) restore();
}
try {
  if (!process.exitCode) {
    assert.equal(await prisma.request.count({ where: { student_uid: student.uid } }), 0);
    if (!marker) assert.equal(await prisma.user.findUnique({ where: { uid: student.uid } }), null);
    // FR-9.1, D34: e.g. no UPDATE or DELETE on the audit log, no change to accounts.
    const problems = await checkGrants(prisma, process.env.SERVICE_ROLE ?? 'all');
    if (problems.length) throw new Error(`Grants: ${problems.join('; ')}`);
    console.log(`Database integration passed: draft cleanup, request create/read/edit, review lifecycle, overlap warning, status history, filters, JSON serialization, all rolled back; its database user (${process.env.DB_USER}) has exactly its rights (the audit log is append-only).`);
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
