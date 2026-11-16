import prisma from '../lib/prisma.js';
import { resourceToDb, requestInclude, requestView, eventInclude, eventView } from '../utils/db-mapping.js';
import { UpdateRequestSchema } from '../utils/validation.js';
import { DEFAULT_LIMIT } from '../utils/paging.js';

// The columns a student writes. The approver's and the system's columns (review_comment, gpu_node,
// approver_uid) and the extensions are never set from a student's data.
function requestData(data) {
  const resource_type = resourceToDb[data.resource_type];
  return { por: data.purpose, proj_description: data.project_description, spv_name: data.project_supervisor_name,
    justify: data.justification, tech_requirements: data.technical_requirements ?? '', impact_score: data.impact_score,
    supervisor_confirmed: data.supervisor_confirmation === 'CONFIRMED', resource_type,
    start_date: new Date(data.estimated_start_date), end_date: new Date(data.estimated_end_date),
    process_type: ['GPU_SERVER', 'BIG_DATA'].includes(resource_type) ? 'Automate' : 'Manual' };
}
// Fields a student edit can change, compared as the API shows them, for the EDITED event. Only the
// names are logged.
const editableFields = ['purpose', 'project_description', 'project_supervisor_name', 'justification',
  'estimated_start_date', 'estimated_end_date', 'impact_score', 'supervisor_confirmation', 'technical_requirements'];
function changedFields(row, next) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const before = requestView(row), after = requestView({ ...row, ...next });
  return editableFields.filter(field => !same(before[field], after[field]));
}

// draft_id: the draft this request was submitted from; it is deleted in the same transaction.
export async function createRequest(user_id, data) {
  return prisma.$transaction(async tx => {
    const request = await tx.request.create({ data: { student_uid: user_id, ...requestData(data), status: 'Pending' } });
    await tx.request_event.create({ data: { rid: request.rid, action: 'CREATED', from_status: null, to_status: 'Pending', actor_uid: user_id } });
    if (data.draft_id) await tx.draft.deleteMany({ where: { did: data.draft_id, student_uid: user_id } });
    return requestView(request);
  });
}
export async function getRequestById(request_id, user_id = null) {
  const row = await prisma.request.findFirst({ where: { rid: request_id, ...(user_id !== null && { student_uid: user_id }) }, include: requestInclude });
  if (!row) return null;
  const events = await prisma.request_event.findMany({ where: { rid: request_id }, include: eventInclude, orderBy: { eid: 'asc' } });
  return { ...requestView(row), events: events.map(e => eventView(e)) };
}
export async function getUserRequests(user_id, page = { take: DEFAULT_LIMIT, skip: 0 }) {
  const where = { student_uid: user_id };
  const [rows, total] = await Promise.all([
    prisma.request.findMany({ where, include: requestInclude, orderBy: [{ created_at: 'desc' }, { rid: 'desc' }], ...page }),
    prisma.request.count({ where }),
  ]);
  return { rows: rows.map(requestView), total };
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
    const next = requestData(merged);
    const updated = await tx.request.updateMany({ where: { rid: request_id, student_uid: user_id, status: 'Pending' }, data: next });
    if (!updated.count) throw Object.assign(new Error('Can only update pending requests'), { statusCode: 400 });
    const fields = changedFields(row, next);
    if (fields.length) {
      await tx.request_event.create({ data: { rid: request_id, action: 'EDITED', from_status: 'Pending', to_status: 'Pending', actor_uid: user_id, details: { fields } } });
    }
    return requestView(await tx.request.findUnique({ where: { rid: request_id } }));
  });
}
