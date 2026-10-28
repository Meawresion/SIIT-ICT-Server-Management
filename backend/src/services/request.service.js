import prisma from '../lib/prisma.js';
import { resourceToDb, requestInclude, requestView, eventInclude, eventView } from '../utils/db-mapping.js';
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
// Fields a student edit can change, compared as the API shows them (old rows keep the
// description in proj_name only), for the EDITED event. Only the names are logged.
const editableFields = ['purpose', 'project_name', 'project_description', 'project_supervisor_name', 'project_supervisor_email',
  'justification', 'estimated_start_date', 'estimated_end_date', 'impact_score', 'supervisor_confirmation'];
const viewedExtras = new Set(['project_description', 'impact_score', 'supervisor_confirmation', 'review_comment']);
function changedFields(row, next) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const before = requestView(row), after = requestView({ ...row, ...next });
  const fields = editableFields.filter(field => !same(before[field], after[field]));
  const extraBefore = row.extra_details ?? {}, extraAfter = next.extra_details ?? {};
  for (const key of new Set([...Object.keys(extraBefore), ...Object.keys(extraAfter)])) {
    if (!viewedExtras.has(key) && !same(extraBefore[key], extraAfter[key])) fields.push(key);
  }
  return fields;
}

export async function createRequest(user_id, data) {
  return prisma.$transaction(async tx => {
    const request = await tx.request.create({ data: { student_uid: user_id, ...requestData(data), status: 'Pending' } });
    await tx.request_event.create({ data: { rid: request.rid, action: 'CREATED', from_status: null, to_status: 'Pending', actor_uid: user_id } });
    await tx.draft.deleteMany({ where: { student_uid: user_id } });
    return requestView(request);
  });
}
export async function getRequestById(request_id, user_id = null) {
  const row = await prisma.request.findFirst({ where: { rid: request_id, ...(user_id !== null && { student_uid: user_id }) }, include: requestInclude });
  if (!row) return null;
  const events = await prisma.request_event.findMany({ where: { rid: request_id }, include: eventInclude, orderBy: { eid: 'asc' } });
  return { ...requestView(row), events: events.map(e => eventView(e)) };
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
    const next = requestData(merged, row);
    const updated = await tx.request.updateMany({ where: { rid: request_id, student_uid: user_id, status: 'Pending' }, data: next });
    if (!updated.count) throw Object.assign(new Error('Can only update pending requests'), { statusCode: 400 });
    const fields = changedFields(row, next);
    if (fields.length) {
      await tx.request_event.create({ data: { rid: request_id, action: 'EDITED', from_status: 'Pending', to_status: 'Pending', actor_uid: user_id, details: { fields } } });
    }
    return requestView(await tx.request.findUnique({ where: { rid: request_id } }));
  });
}
