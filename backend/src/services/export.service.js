// CSV export for approvers (FR-9.3): the requests submitted in a date range, or the status history
// of those requests. Excel-friendly (UTF-8 with a BOM, CRLF rows), and a cell that starts like a
// formula is prefixed with ' so a spreadsheet shows it as text (CSV injection).

import prisma from '../lib/prisma.js';
import { requestInclude, requestView, statusToDb } from '../utils/db-mapping.js';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 366 * 2;

const httpError = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const day = (date) => (date ? date.toISOString().slice(0, 10) : '');
const time = (date) => (date ? date.toISOString() : '');

export function csvCell(value) {
  let text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(columns, rows) {
  const lines = [columns.map(c => csvCell(c.header)), ...rows.map(r => columns.map(c => csvCell(c.value(r))))];
  return `﻿${lines.map(cells => cells.join(',')).join('\r\n')}\r\n`;
}

// query: { type, from, to, status } as strings. -> { type, from, to, where } (dates are days, both
// included; a request counts by the day it was submitted, UTC).
export function parseExportQuery({ type = 'requests', from, to, status } = {}) {
  if (!['requests', 'events'].includes(type)) throw httpError('type must be requests or events', 400);
  if (!DAY_RE.test(from ?? '') || !DAY_RE.test(to ?? '') || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    throw httpError('from and to must be dates (YYYY-MM-DD)', 400);
  }
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(new Date(`${to}T00:00:00Z`).getTime() + DAY_MS);
  if (end <= start) throw httpError('to must be on or after from', 400);
  if ((end - start) / DAY_MS > MAX_DAYS) throw httpError(`At most ${MAX_DAYS} days at a time`, 400);
  if (status && !statusToDb[status]) throw httpError('Invalid status filter', 400);
  return { type, from, to, where: { created_at: { gte: start, lt: end }, ...(status && { status: statusToDb[status] }) } };
}

const REQUEST_COLUMNS = [
  ['request_id', r => r.id], ['status', r => r.status], ['resource_type', r => r.resource_type],
  ['submitted_at', r => time(r.created_at)], ['start_date', r => day(r.start_date)], ['end_date', r => day(r.end_date)],
  ['student_name', r => r.user?.account?.full_name], ['student_id', r => r.user?.student_id], ['student_email', r => r.user?.siitemail],
  ['degree', r => r.user?.degree], ['program', r => r.user?.program], ['advisor', r => r.user?.advisor_name],
  ['project_title', r => r.purpose], ['project_description', r => r.project_description],
  ['supervisor', r => r.project_supervisor_name], ['justification', r => r.justification],
  ['technical_requirements', r => r.technical_requirements], ['criticality', r => r.impact_score],
  ['supervisor_confirmed', r => r.supervisor_confirmation === 'CONFIRMED' ? 'yes' : 'no'],
  ['gpu_node', r => r.extra_details?.gpu_node], ['extension_asked_until', r => r.extra_details?.extension?.end_date],
  ['last_reviewer', r => r.reviewed_by?.full_name], ['reviewed_at', r => time(r.reviewed_at)], ['review_comment', r => r.review_comment],
].map(([header, value]) => ({ header, value }));

const EVENT_COLUMNS = [
  ['event_id', e => Number(e.eid)], ['request_id', e => e.rid], ['at', e => time(e.created_at)], ['action', e => e.action],
  ['from_status', e => e.from_status], ['to_status', e => e.to_status],
  ['actor', e => (e.actor_uid === null ? 'system' : e.user?.fullname)], ['actor_role', e => (e.actor_uid === null ? 'System' : e.user?.role)],
  ['comment', e => e.comment], ['details', e => e.details],
].map(([header, value]) => ({ header, value }));

const STATUS_TEXT = { On_Use: 'On Use' };

// -> { filename, csv }
export async function exportCsv(query) {
  const { type, from, to, where } = parseExportQuery(query);
  const filename = `siit-${type}-${from}-to-${to}.csv`;
  if (type === 'requests') {
    const rows = await prisma.request.findMany({ where, include: requestInclude, orderBy: { rid: 'asc' } });
    return { filename, csv: toCsv(REQUEST_COLUMNS, rows.map(requestView)) };
  }
  // The history of the requests submitted in the range, oldest first.
  const events = await prisma.request_event.findMany({
    where: { request: where }, include: { user: { select: { fullname: true, role: true } } }, orderBy: [{ rid: 'asc' }, { eid: 'asc' }],
  });
  const rows = events.map(e => ({ ...e, from_status: STATUS_TEXT[e.from_status] ?? e.from_status, to_status: STATUS_TEXT[e.to_status] ?? e.to_status }));
  return { filename, csv: toCsv(EVENT_COLUMNS, rows) };
}
