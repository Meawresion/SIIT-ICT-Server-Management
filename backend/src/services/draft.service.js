// Drafts (FR-3.2, FR-3.3): unfinished requests a student keeps on the server, so they follow the
// student to another device. Any field may still be empty; submitting a request from a draft
// deletes it (request.service createRequest).

import prisma from '../lib/prisma.js';
import { resourceToDb } from '../utils/db-mapping.js';

export const MAX_DRAFTS = 20;

const httpError = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const reverse = (mapping, value) => Object.keys(mapping).find(key => mapping[key] === value) ?? value;
const toDay = (text) => (text ? new Date(`${text}T00:00:00Z`) : null);
const fromDay = (date) => (date ? date.toISOString().slice(0, 10) : null);
const text = (value) => (value === undefined || value === '' ? null : value);

// The form fields (as the request form names them) -> the draft columns.
function draftData(data) {
  return {
    resource_type: data.resource_type ? resourceToDb[data.resource_type] : null,
    por: text(data.purpose), proj_description: text(data.project_description), spv_name: text(data.project_supervisor_name),
    justify: text(data.justification), tech_requirements: text(data.technical_requirements),
    impact_score: data.impact_score ?? null, supervisor_confirmed: data.supervisor_confirmation === 'CONFIRMED',
    start_date: toDay(data.estimated_start_date), end_date: toDay(data.estimated_end_date),
  };
}

// -> { id, data: the form fields that are filled in, updated_at }
export function draftView(row) {
  const data = {
    purpose: row.por, project_description: row.proj_description, project_supervisor_name: row.spv_name,
    resource_type: row.resource_type ? reverse(resourceToDb, row.resource_type) : null,
    justification: row.justify, technical_requirements: row.tech_requirements, impact_score: row.impact_score,
    supervisor_confirmation: row.supervisor_confirmed ? 'CONFIRMED' : 'NOT_CONFIRMED',
    estimated_start_date: fromDay(row.start_date), estimated_end_date: fromDay(row.end_date),
  };
  return { id: row.did, data: Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null)), updated_at: row.updated_at.toISOString() };
}

export async function listDrafts(student_uid) {
  const rows = await prisma.draft.findMany({ where: { student_uid }, orderBy: [{ updated_at: 'desc' }, { did: 'desc' }] });
  return rows.map(draftView);
}

export async function createDraft(student_uid, data) {
  return prisma.$transaction(async tx => {
    if (await tx.draft.count({ where: { student_uid } }) >= MAX_DRAFTS) {
      throw httpError(`You can keep at most ${MAX_DRAFTS} drafts; delete one first`, 409);
    }
    return draftView(await tx.draft.create({ data: { student_uid, ...draftData(data) } }));
  });
}

export async function updateDraft(student_uid, did, data) {
  return prisma.$transaction(async tx => {
    const { count } = await tx.draft.updateMany({ where: { did, student_uid }, data: draftData(data) });
    if (!count) throw httpError('Draft not found', 404);
    return draftView(await tx.draft.findUnique({ where: { did } }));
  });
}

export async function deleteDraft(student_uid, did) {
  const { count } = await prisma.draft.deleteMany({ where: { did, student_uid } });
  if (!count) throw httpError('Draft not found', 404);
}
