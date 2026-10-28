// Preserve the API consumed by the existing frontend while using the new schema.
export const resourceToDb = { HPC_GPU: 'GPU_SERVER', BIG_DATA: 'BIG_DATA', VM: 'VM', LAB_EQUIPMENT: 'LAB_EQUIPMENT', AWS_SKILL_BUILDER: 'AWS_SKILL', AWS_LEARNER_LAB: 'AWS_LAB' };
export const statusToDb = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', ACTIVE: 'On_Use', COMPLETED: 'Completed' };
export const degreeToDb = { UNDERGRADUATE: 'Undergraduate', MASTER: 'Master', DOCTORAL: 'PhD' };
const reverse = (mapping, value) => Object.keys(mapping).find(key => mapping[key] === value) ?? value;
export function accountView(row) {
  return row && { ...row, id: row.uid, primary_email: row.siitemail, full_name: row.fullname };
}
export function profileComplete(row) {
  return row && row.role === 'Student' && Boolean(row.s_id && row.study_degree && row.s_program && row.phone_number);
}
export function userView(row) {
  return row && { ...row, id: row.uid, student_id: row.s_id, degree: reverse(degreeToDb, row.study_degree), program: row.s_program,
    advisor_name: row.advisor_name ?? '', account: accountView(row) };
}
export const requestInclude = { user_request_student_uidTouser: true, user_request_approver_uidTouser: true };
export function requestView(row) {
  if (!row) return null;
  const extra = row.extra_details ?? {};
  return { ...row, id: row.rid, user_id: row.student_uid, purpose: row.por,
    project_name: row.proj_name, project_description: extra.project_description ?? row.proj_name, project_supervisor_name: row.spv_name,
    project_supervisor_email: row.spv_email, resource_type: reverse(resourceToDb, row.resource_type),
    justification: row.justify, estimated_start_date: row.start_date, estimated_end_date: row.end_date,
    impact_score: extra.impact_score ?? null, supervisor_confirmation: extra.supervisor_confirmation ?? 'NOT_CONFIRMED',
    review_comment: extra.review_comment ?? null, status: reverse(statusToDb, row.status),
    user: userView(row.user_request_student_uidTouser), reviewed_by: accountView(row.user_request_approver_uidTouser) };
}
// Status history (FR-4.2). Students see who acted only by role, and not the site's technical
// error on a failed setup; approvers see both.
export const eventInclude = { user: { select: { fullname: true, role: true } } };
export function eventView(row, { names = false } = {}) {
  const systemError = row.actor_uid === null && row.action.endsWith('_FAILED');
  return {
    id: Number(row.eid), action: row.action,
    from: row.from_status ? reverse(statusToDb, row.from_status) : null, to: reverse(statusToDb, row.to_status),
    actor: row.actor_uid === null ? { role: 'System' } : { role: row.user?.role ?? null, ...(names && { name: row.user?.fullname ?? null }) },
    comment: systemError && !names ? null : row.comment ?? null, details: row.details ?? null, at: row.created_at,
  };
}
export const overlapView = row => ({ id: row.rid, status: reverse(statusToDb, row.status), start: row.start_date, end: row.end_date });

export function parseId(value) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 4294967295) {
    throw Object.assign(new Error('Invalid ID'), { statusCode: 400 });
  }
  return Number(value);
}

export function requestResponse(request) {
  return Object.fromEntries([
    'id', 'purpose', 'project_name', 'project_description', 'project_supervisor_name', 'project_supervisor_email',
    'resource_type', 'justification', 'estimated_start_date', 'estimated_end_date', 'impact_score',
    'supervisor_confirmation', 'status', 'review_comment', 'reviewed_at', 'created_at', 'updated_at', 'events',
  ].map(key => [key, request[key]]));
}
