// Extension requests (FR-8.3). The student of an On Use request asks for a later end date with a
// reason; an approver approves or rejects it. Approving moves the end date and, for a request set
// up automatically, queues an EXTEND job (acc-prov-vm moves the VPN account's expiration). Only
// while the current end date hasn't passed: after it the access is being turned off (D7), so the
// student submits a new request instead. One ask waits at a time, in
// request.extra_details.extension; every step is a request_event.

import prisma from '../lib/prisma.js';
import { provisioningConfig } from '../config/provisioning.js';
import { loadSchedulerConfig } from '../config/scheduler.js';
import { requestView } from '../utils/db-mapping.js';
import { buildExtendJob } from './provisioning.service.js';
import { siteToday } from './scheduler.service.js';
import { notifyRequestEvent } from './notify.service.js';

const MAX_DAYS_AHEAD = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

const httpError = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const day = (date) => date.toISOString().slice(0, 10);
const midnightUtc = (dayText) => new Date(`${dayText}T00:00:00Z`);
const todayHere = () => siteToday(loadSchedulerConfig().timeZone);

function assertStillRunning(row, today) {
  if (row.status !== 'On_Use') throw httpError('Only a request that is in use can be extended', 400);
  if (day(row.end_date) < today) throw httpError('This request has ended; submit a new request instead', 400);
}

// Holds the row until the transaction ends, so two asks or decisions can't both pass the checks.
async function lockRequest(tx, rid) {
  await tx.$queryRaw`SELECT rid FROM request WHERE rid = ${rid} FOR UPDATE`;
  return tx.request.findUnique({ where: { rid } });
}

// The student's ask. -> the request as the API shows it.
export async function requestExtension(request_id, user_id, { end_date, reason }, { today = todayHere() } = {}) {
  let event;
  const request = await prisma.$transaction(async tx => {
    const row = await lockRequest(tx, request_id);
    if (!row || row.student_uid !== user_id) throw httpError('Request not found', 404);
    assertStillRunning(row, today);
    if (row.extra_details?.extension) throw httpError('An extension is already waiting for an approver', 409);
    const from_end = day(row.end_date);
    if (end_date <= from_end) throw httpError('The new end date must be after the current one', 400);
    if (midnightUtc(end_date) - midnightUtc(today) > MAX_DAYS_AHEAD * DAY_MS) throw httpError('The new end date can be at most a year ahead', 400);
    const extension = { end_date, reason, requested_at: new Date().toISOString() };
    await tx.request.update({ where: { rid: request_id }, data: { extra_details: { ...(row.extra_details ?? {}), extension } } });
    event = { rid: request_id, action: 'EXTENSION_REQUESTED', from: row.status, to: row.status, comment: reason, details: { end_date, from_end } };
    await tx.request_event.create({ data: {
      rid: request_id, action: event.action, from_status: row.status, to_status: row.status, actor_uid: user_id, comment: reason, details: event.details,
    } });
    return requestView(await tx.request.findUnique({ where: { rid: request_id } }));
  });
  notifyRequestEvent(event);
  return request;
}

// An approver's decision. -> the request as the API shows it.
export async function decideExtension(request_id, reviewer_account_id, approve, review_comment, { today = todayHere() } = {}) {
  let event;
  const request = await prisma.$transaction(async tx => {
    const reviewer = await tx.user.findUnique({ where: { uid: reviewer_account_id } });
    if (reviewer?.role !== 'Approver') throw httpError('Reviewer access required', 403);
    const row = await lockRequest(tx, request_id);
    if (!row) throw httpError('Request not found', 404);
    const { extension, ...extra_details } = row.extra_details ?? {};
    if (!extension) throw httpError('No extension is waiting for this request', 400);
    const from_end = day(row.end_date);
    let details = { end_date: extension.end_date, from_end };
    if (approve) {
      assertStillRunning(row, today);
      const next = { ...row, end_date: midnightUtc(extension.end_date), extra_details };
      const job = await buildExtendJob(tx, next, provisioningConfig());
      await tx.request.update({ where: { rid: request_id }, data: { end_date: next.end_date, extra_details } });
      if (job) await tx.provision_job.create({ data: job });
      details = { ...details, ...(job && { job_id: job.job_id, job_action: job.action }) };
    } else {
      await tx.request.update({ where: { rid: request_id }, data: { extra_details } });
    }
    event = { rid: request_id, action: approve ? 'EXTENSION_APPROVED' : 'EXTENSION_REJECTED', from: row.status, to: row.status, comment: review_comment, details };
    await tx.request_event.create({ data: {
      rid: request_id, action: event.action, from_status: row.status, to_status: row.status, actor_uid: reviewer_account_id,
      comment: review_comment, details,
    } });
    return requestView(await tx.request.findUnique({ where: { rid: request_id } }));
  });
  notifyRequestEvent(event);
  return request;
}
