import prisma from '../lib/prisma.js';
import { resourceToDb, requestInclude, requestView } from '../utils/db-mapping.js';
import { UpdateRequestSchema } from '../utils/validation.js';

function requestData(data, existing = null) {
  const resource_type = resourceToDb[data.resource_type];
  const extra_details = { ...(existing?.extra_details ?? {}), ...(data.extra_details ?? {}) };
  for (const key of ['project_description', 'impact_score', 'supervisor_confirmation']) {
    if (data[key] !== undefined) extra_details[key] = data[key];
  }
  // Student-provided JSON must never overwrite reviewer-owned metadata.
  if (existing?.extra_details?.review_comment !== undefined) extra_details.review_comment = existing.extra_details.review_comment;
  else delete extra_details.review_comment;
  return { por: data.purpose, proj_name: data.project_name || data.project_description.slice(0, 255),
    spv_name: data.project_supervisor_name, spv_email: data.project_supervisor_email ?? existing?.spv_email ?? '',
    justify: data.justification, resource_type, start_date: new Date(data.estimated_start_date), end_date: new Date(data.estimated_end_date),
    process_type: ['GPU_SERVER', 'BIG_DATA'].includes(resource_type) ? 'Automate' : 'Manual', extra_details };
}
export async function createRequest(user_id, data) {
  return prisma.$transaction(async tx => {
    const request = await tx.request.create({ data: { student_uid: user_id, ...requestData(data), status: 'Pending' } });
    await tx.draft.deleteMany({ where: { student_uid: user_id } });
    return requestView(request);
  });
}
export async function getRequestById(request_id, user_id = null) {
  return requestView(await prisma.request.findFirst({ where: { rid: request_id, ...(user_id !== null && { student_uid: user_id }) }, include: requestInclude }));
}
export async function getUserRequests(user_id) {
  return (await prisma.request.findMany({ where: { student_uid: user_id }, include: requestInclude, orderBy: { created_at: 'desc' } })).map(requestView);
}
export async function updateRequest(request_id, user_id, data) {
  return prisma.$transaction(async tx => {
    const row = await tx.request.findFirst({ where: { rid: request_id, student_uid: user_id } });
    if (!row) throw Object.assign(new Error('Request not found or unauthorized'), { statusCode: 404 });
    if (row.status !== 'Pending') throw Object.assign(new Error('Can only update pending requests'), { statusCode: 400 });
    // The type decides Manual vs automated provisioning, so it is fixed once submitted.
    if (data.resource_type !== undefined && resourceToDb[data.resource_type] !== row.resource_type) {
      throw Object.assign(new Error('The resource type can’t be changed after submission'), { statusCode: 400 });
    }
    const current = requestView(row);
    if (current.impact_score === null) delete current.impact_score;
    const merged = UpdateRequestSchema.parse({ ...current,
      estimated_start_date: row.start_date.toISOString(), estimated_end_date: row.end_date.toISOString(), ...data });
    const updated = await tx.request.updateMany({ where: { rid: request_id, student_uid: user_id, status: 'Pending' }, data: requestData(merged, row) });
    if (!updated.count) throw Object.assign(new Error('Can only update pending requests'), { statusCode: 400 });
    return requestView(await tx.request.findUnique({ where: { rid: request_id } }));
  });
}
