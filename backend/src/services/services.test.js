import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../lib/prisma.js';
import { findOrCreateAccount } from './auth.service.js';
import { createUserProfile } from './user.service.js';
import { createRequest, updateRequest, getRequestById } from './request.service.js';
import { approveRequest, activateRequest, completeRequest, rejectRequest, getAllRequests } from './reviewer.service.js';
import { CreateRequestSchema, UpdateRequestSchema, UserProfileSchema } from '../utils/validation.js';
import { parseId, requestView } from '../utils/db-mapping.js';
import { setUserRoleByEmail } from './role.service.js';
import { requireReviewer } from '../middleware/auth.middleware.js';
import env from '../config/env.js';
import { signToken } from '../auth/token.js';

after(() => prisma.$disconnect());
// A request carrying a valid sign-in token for the account (the token holds only the id).
function signedIn(account_id) {
  env.jwt_secret ||= 'unit-test-secret-not-used-anywhere-else';
  const now = Math.floor(Date.now() / 1000);
  const token = signToken({ sub: String(account_id), iat: now, exp: now + 600, auth_time: now }, env.jwt_secret);
  return { headers: { cookie: `auth=${token}` }, get: () => undefined };
}
function mockMethod(t, object, key, implementation) {
  const original = object[key];
  object[key] = implementation;
  t.after(() => { object[key] = original; });
}

const data = { purpose: 'Thesis', project_description: 'Training a model', project_supervisor_name: 'Dr. Example', resource_type: 'HPC_GPU', justification: 'Research', estimated_start_date: '2026-10-01', estimated_end_date: '2026-12-31', impact_score: 7, supervisor_confirmation: 'CONFIRMED' };
const row = { rid: 10, student_uid: 1, por: data.purpose, proj_name: data.project_description, spv_name: data.project_supervisor_name, spv_email: '', resource_type: 'GPU_SERVER', justify: data.justification, start_date: new Date(data.estimated_start_date), end_date: new Date(data.estimated_end_date), status: 'Pending', extra_details: { impact_score: 7, supervisor_confirmation: 'CONFIRMED' } };

test('Google sign-in uses verified email and preserves existing approver role', async t => {
  mockMethod(t, prisma.user, 'upsert', async args => {
    assert.deepEqual(args.where, { siitemail: 'reviewer@siit.tu.ac.th' });
    assert.deepEqual(args.update, {});
    assert.equal(args.create.role, 'Student');
    return { uid: 2, role: 'Approver', siitemail: args.where.siitemail, fullname: 'Reviewer' };
  });
  Object.assign(process.env, { STUDENT_EMAIL_DOMAIN: 'g.siit.tu.ac.th', STUDENT_ID_DIGITS: '10', DEGREE_EMAIL_PREFIXES: '{"UNDERGRADUATE":"","MASTER":"m","DOCTORAL":"d"}', STAFF_EMAIL_DOMAINS: 'siit.tu.ac.th' });
  const account = await findOrCreateAccount({ email: 'Reviewer@siit.tu.ac.th', name: 'Reviewer', hd: 'siit.tu.ac.th' });
  assert.equal(account.id, 2);
  assert.equal(account.role, 'Approver');
  assert.doesNotThrow(() => JSON.stringify(account));
});

test('profile completion updates the Google-created user in the new schema', async t => {
  mockMethod(t, prisma.user, 'update', async args => {
    assert.deepEqual(args.where, { uid: 1, role: 'Student' });
    assert.deepEqual(args.data, { fullname: 'Edited Name', s_id: '6622770001', study_degree: 'PhD', s_program: 'ICT', advisor_name: 'Dr. Advisor', phone_number: '0812345678' });
    return { uid: 1, ...args.data };
  });
  const result = await createUserProfile(1, { full_name: 'Edited Name', student_id: '6622770001', degree: 'DOCTORAL', program: 'ICT', advisor_name: 'Dr. Advisor', phone_number: '0812345678' });
  assert.equal(result.degree, 'DOCTORAL');
  assert.equal(result.advisor_name, 'Dr. Advisor');
});

test('all six frontend resources save in Request and clear the student draft atomically', async t => {
  const resources = { HPC_GPU: 'GPU_SERVER', BIG_DATA: 'BIG_DATA', VM: 'VM', LAB_EQUIPMENT: 'LAB_EQUIPMENT', AWS_SKILL_BUILDER: 'AWS_SKILL', AWS_LEARNER_LAB: 'AWS_LAB' };
  for (const [apiType, dbType] of Object.entries(resources)) {
    const events = [];
    mockMethod(t, prisma, '$transaction', async callback => callback({
      request: { create: async args => {
        events.push('create');
        assert.equal(args.data.resource_type, dbType);
        assert.equal(args.data.process_type, ['GPU_SERVER', 'BIG_DATA'].includes(dbType) ? 'Automate' : 'Manual');
        assert.equal(args.data.extra_details.impact_score, 7);
        assert.equal(args.data.spv_email, '');
        assert.ok(args.data.start_date instanceof Date);
        return { rid: 10, ...args.data };
      } }, draft: { deleteMany: async args => { events.push('draft'); assert.deepEqual(args.where, { student_uid: 1 }); } },
      request_event: { create: async args => {
        events.push('event');
        assert.deepEqual(args.data, { rid: 10, action: 'CREATED', from_status: null, to_status: 'Pending', actor_uid: 1 });
      } },
    }));
    const result = await createRequest(1, { ...data, resource_type: apiType });
    assert.equal(result.resource_type, apiType);
    assert.equal(result.status, 'PENDING');
    assert.deepEqual(events, ['create', 'event', 'draft']);
  }
});

test('student detail lookup restricts ownership in the database query', async t => {
  mockMethod(t, prisma.request, 'findFirst', async args => { assert.deepEqual(args.where, { rid: 10, student_uid: 8 }); return null; });
  assert.equal(await getRequestById(10, 8), null);
});

test('partial edits retain dates, metadata and reviewer-owned fields', async t => {
  const logged = [];
  mockMethod(t, prisma, '$transaction', async cb => cb({ request_event: { create: async args => logged.push(args.data) }, request: {
    findFirst: async () => ({ ...row, extra_details: { ...row.extra_details, custom: 'keep', review_comment: 'private' } }),
    updateMany: async args => {
      assert.equal(args.data.por, 'Updated');
      assert.equal(args.data.extra_details.custom, 'keep');
      assert.equal(args.data.extra_details.review_comment, 'private');
      assert.equal(args.data.start_date.toISOString(), row.start_date.toISOString());
      assert.equal(args.where.status, 'Pending');
      return { count: 1 };
    }, findUnique: async () => ({ ...row, por: 'Updated' }),
  } }));
  assert.equal((await updateRequest(10, 1, { purpose: 'Updated', extra_details: { review_comment: 'forged' } })).purpose, 'Updated');
  // The edit is logged with the changed field names only; the forged reviewer field isn't one.
  assert.deepEqual(logged, [{ rid: 10, action: 'EDITED', from_status: 'Pending', to_status: 'Pending', actor_uid: 1, details: { fields: ['purpose'] } }]);
});

test('partial date edits validate against the existing date range before writing', async t => {
  mockMethod(t, prisma, '$transaction', async cb => cb({ request: { findFirst: async () => row } }));
  await assert.rejects(updateRequest(10, 1, { estimated_end_date: '2026-09-01' }), { name: 'ZodError' });
});

test('review transitions map statuses and keep request metadata', async t => {
  const current = structuredClone(row);
  const logged = [];
  mockMethod(t, prisma, '$transaction', async cb => cb({
    user: { findUnique: async () => ({ uid: 2, role: 'Approver' }) },
    request: {
      findUnique: async () => ({ ...current }),
      findMany: async () => [],
      updateMany: async args => { assert.equal(args.where.status, current.status); Object.assign(current, args.data); return { count: 1 }; },
    },
    request_event: { create: async args => logged.push(args.data) },
  }));
  assert.equal((await approveRequest(10, 2, 'Approved for research')).status, 'APPROVED');
  assert.equal(current.extra_details.impact_score, 7);
  assert.equal((await activateRequest(10, 2)).status, 'ACTIVE');
  assert.equal(current.status, 'On_Use');
  assert.equal((await completeRequest(10, 2)).status, 'COMPLETED');
  assert.equal(current.extra_details.review_comment, 'Approved for research');
  await assert.rejects(rejectRequest(10, 2, 'No'), /Invalid state transition/);
  // FR-5.5: every decision records the approver, its status change and the comment.
  assert.deepEqual(logged.map(e => [e.action, e.from_status, e.to_status, e.actor_uid, e.comment]), [
    ['APPROVED', 'Pending', 'Approved', 2, 'Approved for research'],
    ['ACTIVATED', 'Approved', 'On_Use', 2, null],
    ['COMPLETED', 'On_Use', 'Completed', 2, null]]);
});

test('review service rejects students even if called without middleware', async t => {
  mockMethod(t, prisma, '$transaction', async cb => cb({ user: { findUnique: async () => ({ role: 'Student' }) } }));
  await assert.rejects(approveRequest(10, 1, 'Forged'), { statusCode: 403 });
});

test('review filters use new enums and student relation', async t => {
  mockMethod(t, prisma.request, 'findMany', async args => {
    assert.deepEqual(args.where, { status: 'On_Use', resource_type: 'AWS_LAB', user_request_student_uidTouser: { s_id: '123' } });
    return [];
  });
  await getAllRequests({ status: 'ACTIVE', resource_type: 'AWS_LEARNER_LAB', student_id: '123' });
  await assert.rejects(getAllRequests({ status: 'bad' }), { statusCode: 400 });
});

test('review authorization checks the role in the database on every request', async t => {
  mockMethod(t, prisma.user, 'findUnique', async () => ({ uid: 1, role: 'Student' }));
  const req = signedIn(1);
  const res = { status(code) { assert.equal(code, 403); return this; }, json(body) { assert.match(body.message, /Reviewer/); } };
  await requireReviewer(req, res, () => assert.fail('must deny access'));
  assert.equal(req.auth.role, 'user');
});

test('validation rejects invalid IDs, database field overflow, and invalid dates', () => {
  for (const id of ['abc', '-1', '0', '1.2', '4294967296']) assert.throws(() => parseId(id), { statusCode: 400 });
  assert.equal(parseId('42'), 42);
  assert.equal(CreateRequestSchema.safeParse(data).success, true);
  assert.equal(CreateRequestSchema.safeParse({ ...data, impact_score: 11 }).success, false);
  assert.equal(UpdateRequestSchema.safeParse({ estimated_start_date: 'bad' }).success, false);
  assert.equal(UserProfileSchema.safeParse({ student_id: '1'.repeat(13), degree: 'MASTER', program: 'ICT', advisor_name: 'Dr', phone_number: '123' }).success, false);
  assert.equal(requestView({ ...row, status: 'On_Use' }).status, 'ACTIVE');
});


test('server role assignment normalizes email and grants or revokes access', async () => {
  for (const role of ['Approver', 'Student']) {
    const db = { user: { updateMany: async args => {
      assert.deepEqual(args, { where: { siitemail: 'person@siit.tu.ac.th' }, data: { role } });
      return { count: 1 };
    } } };
    assert.deepEqual(await setUserRoleByEmail(' Person@siit.tu.ac.th ', role, db), { email: 'person@siit.tu.ac.th', role });
  }
});

test('server role assignment rejects invalid roles and emails before writing', async () => {
  const db = { user: { updateMany: () => assert.fail('must not write') } };
  await assert.rejects(setUserRoleByEmail('person@siit.tu.ac.th', 'Admin', db), { name: 'ZodError' });
  await assert.rejects(setUserRoleByEmail('bad email', 'Approver', db), { name: 'ZodError' });
});

test('server role assignment requires a Google-created account', async () => {
  const db = { user: { updateMany: async () => ({ count: 0 }) } };
  await assert.rejects(setUserRoleByEmail('person@siit.tu.ac.th', 'Approver', db), /sign in with Google first/);
});

test('review authorization accepts database approvers without a student profile', async t => {
  mockMethod(t, prisma.user, 'findUnique', async () => ({ uid: 2, role: 'Approver' }));
  const req = signedIn(2);
  let allowed = false;
  const res = { status() { assert.fail('should allow'); } };
  await requireReviewer(req, res, () => { allowed = true; });
  assert.equal(allowed, true);
  assert.equal(req.auth.role, 'reviewer');
  assert.equal(req.auth.user_id, null);
});
