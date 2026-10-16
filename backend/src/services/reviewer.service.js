import prisma from '../lib/prisma.js';
import { resourceToDb, statusToDb, requestInclude, requestView } from '../utils/db-mapping.js';

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
export async function getRequestForReview(request_id) {
  return requestView(await prisma.request.findUnique({ where: { rid: request_id }, include: requestInclude }));
}
async function transition(request_id, reviewer_account_id, from, to, review_comment) {
  return prisma.$transaction(async tx => {
    const reviewer = await tx.user.findUnique({ where: { uid: reviewer_account_id } });
    if (reviewer?.role !== 'Approver') throw Object.assign(new Error('Reviewer access required'), { statusCode: 403 });
    const row = await tx.request.findUnique({ where: { rid: request_id } });
    if (!row) throw Object.assign(new Error('Request not found'), { statusCode: 404 });
    if (row.status !== from) throw Object.assign(new Error('Invalid state transition'), { statusCode: 400 });
    const result = await tx.request.updateMany({ where: { rid: request_id, status: from }, data: {
      status: to, approver_uid: reviewer_account_id, reviewed_at: new Date(),
      ...(review_comment !== undefined && { extra_details: { ...(row.extra_details ?? {}), review_comment } }),
    } });
    if (!result.count) throw Object.assign(new Error('Invalid state transition'), { statusCode: 400 });
    return requestView(await tx.request.findUnique({ where: { rid: request_id } }));
  });
}
export const approveRequest = (id, reviewer, comment) => transition(id, reviewer, 'Pending', 'Approved', comment);
export const rejectRequest = (id, reviewer, comment) => transition(id, reviewer, 'Pending', 'Rejected', comment);
export const activateRequest = (id, reviewer, comment) => transition(id, reviewer, 'Approved', 'On_Use', comment);
export const completeRequest = (id, reviewer, comment) => transition(id, reviewer, 'On_Use', 'Completed', comment);
