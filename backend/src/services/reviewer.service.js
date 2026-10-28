import prisma from '../lib/prisma.js';
import { resourceToDb, statusToDb, requestInclude, requestView, eventInclude, eventView, overlapView } from '../utils/db-mapping.js';
import { provisioningConfig } from '../config/provisioning.js';
import { assertManualActivationAllowed, buildCreateJob, buildRevokeJob, isAutomated, jobsFor } from './provisioning.service.js';

export async function getAllRequests(filters = {}) {
  const where = {};
  if (filters.status) {
    if (!statusToDb[filters.status]) throw Object.assign(new Error('Invalid status filter'), { statusCode: 400 });
    where.status = statusToDb[filters.status];
  }
  if (filters.resource_type) {
    if (!resourceToDb[filters.resource_type]) throw Object.assign(new Error('Invalid resource filter'), { statusCode: 400 });
    where.resource_type = resourceToDb[filters.resource_type];
  }
  if (filters.student_id) where.user_request_student_uidTouser = { s_id: filters.student_id };
  return (await prisma.request.findMany({ where, include: requestInclude, orderBy: { created_at: 'desc' } })).map(requestView);
}

// D28: the same student's other live requests for the same resource type whose dates intersect.
// A warning for the reviewer only; the student is never blocked.
export async function findOverlaps(client, row) {
  const rows = await client.request.findMany({
    where: { student_uid: row.student_uid, resource_type: row.resource_type, rid: { not: row.rid },
      status: { in: ['Pending', 'Approved', 'On_Use'] }, start_date: { lte: row.end_date }, end_date: { gte: row.start_date } },
    orderBy: { start_date: 'asc' },
  });
  return rows.map(overlapView);
}

export async function getRequestForReview(request_id) {
  const row = await prisma.request.findUnique({ where: { rid: request_id }, include: requestInclude });
  if (!row) return null;
  const [overlaps, events, jobs] = await Promise.all([
    findOverlaps(prisma, row),
    prisma.request_event.findMany({ where: { rid: request_id }, include: eventInclude, orderBy: { eid: 'asc' } }),
    jobsFor(prisma, request_id),
  ]);
  return { ...requestView(row), overlaps, events: events.map(e => eventView(e, { names: true })),
    provisioning: { automated: isAutomated(row), gpu_node: row.extra_details?.gpu_node ?? null, jobs } };
}

// Every decision changes the status and appends its event in one transaction (FR-5.5, FR-9.1).
// With provisioning on, approving a GPU request also picks its node and queues the CREATE job, and
// completing it queues the REVOKE job, in the same transaction (outbox, plan §2.1).
async function transition(request_id, reviewer_account_id, from, to, action, review_comment, { confirm_overlap = false } = {}) {
  return prisma.$transaction(async tx => {
    const reviewer = await tx.user.findUnique({ where: { uid: reviewer_account_id } });
    if (reviewer?.role !== 'Approver') throw Object.assign(new Error('Reviewer access required'), { statusCode: 403 });
    const row = await tx.request.findUnique({ where: { rid: request_id } });
    if (!row) throw Object.assign(new Error('Request not found'), { statusCode: 404 });
    if (row.status !== from) throw Object.assign(new Error('Invalid state transition'), { statusCode: 400 });
    const overlaps = to === 'Approved' ? await findOverlaps(tx, row) : [];
    if (overlaps.length && !confirm_overlap) {
      throw Object.assign(new Error('This student has overlapping requests for the same resource'), { statusCode: 409, overlaps });
    }
    const config = provisioningConfig();
    const automated = isAutomated(row, config);
    let job = null, gpu_node;
    if (automated && to === 'Approved') ({ job, gpu_node } = await buildCreateJob(tx, row, config));
    if (automated && to === 'On_Use') await assertManualActivationAllowed(tx, row);
    if (config && to === 'Completed') job = await buildRevokeJob(tx, row);
    const extra_details = { ...(row.extra_details ?? {}), ...(review_comment !== undefined && { review_comment }), ...(gpu_node && { gpu_node }) };
    const result = await tx.request.updateMany({ where: { rid: request_id, status: from }, data: {
      status: to, approver_uid: reviewer_account_id, reviewed_at: new Date(),
      ...((review_comment !== undefined || gpu_node) && { extra_details }),
    } });
    if (!result.count) throw Object.assign(new Error('Invalid state transition'), { statusCode: 400 });
    if (job) await tx.provision_job.create({ data: job });
    const details = {
      ...(overlaps.length && { confirmed_overlaps: overlaps.map(o => o.id) }),
      ...(job && { job_id: job.job_id, job_action: job.action }), ...(gpu_node && { gpu_node }),
    };
    await tx.request_event.create({ data: {
      rid: request_id, action, from_status: from, to_status: to, actor_uid: reviewer_account_id, comment: review_comment ?? null,
      ...(Object.keys(details).length && { details }),
    } });
    return requestView(await tx.request.findUnique({ where: { rid: request_id } }));
  });
}
export const approveRequest = (id, reviewer, comment, options) => transition(id, reviewer, 'Pending', 'Approved', 'APPROVED', comment, options);
export const rejectRequest = (id, reviewer, comment) => transition(id, reviewer, 'Pending', 'Rejected', 'REJECTED', comment);
export const activateRequest = (id, reviewer, comment) => transition(id, reviewer, 'Approved', 'On_Use', 'ACTIVATED', comment);
export const completeRequest = (id, reviewer, comment) => transition(id, reviewer, 'On_Use', 'Completed', 'COMPLETED', comment);
