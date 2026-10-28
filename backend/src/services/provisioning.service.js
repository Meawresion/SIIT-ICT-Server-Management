// Automatic provisioning through acc-prov-vm (plan §2). Jobs go into the provision_job outbox in
// the same transaction as the decision that causes them; dispatchQueued() publishes them, and
// handleResult() applies acc-prov-vm's answers. Every change appends a request_event; results
// are logged with actor_uid NULL (the system).
//
// Job payloads follow acc-prov-vm/src/jobs.js and never contain a password:
//   CREATE { action, resource, student: { username, fullName, email }, gpuNode, period: { start, end },
//            links: { ovpnProfileUrl, manualUrl } }
//   REVOKE { action, resource, student: { username, fullName }, gpuNode, revokeVpn }

import { randomUUID } from 'node:crypto';
import prisma from '../lib/prisma.js';
import { provisioningConfig } from '../config/provisioning.js';
import { EnvelopeError, open, seal } from '../messaging/envelope.js';
import { PoisonMessageError } from '../messaging/errors.js';

// Resource types acc-prov-vm can set up today. BIG_DATA waits for the Hadoop flows, so it is
// still activated by hand.
export const AUTOMATED_RESOURCES = ['GPU_SERVER'];
// D20: the same username on pfSense, Linux and JupyterHub.
const USERNAME_PREFIX = { Undergraduate: 'st', Master: 'stm', PhD: 'std' };
const ACTIVE_JOB = ['Queued', 'Sent'];
const RESULT_EVENT = { CREATE: ['PROVISIONED', 'PROVISION_FAILED'], REVOKE: ['REVOKED', 'REVOKE_FAILED'] };
// The only result fields kept: all non-secret (acc-prov-vm never sends a password).
const RESULT_FIELDS = ['ok', 'action', 'resource', 'username', 'gpuNode', 'vpn', 'linuxCreated', 'emailed', 'gpu', 'error', 'permanent'];
const MAX_ERROR_LENGTH = 2000;
const DISPATCH_BATCH = 5;

const httpError = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const day = (date) => date.toISOString().slice(0, 10);

export function isAutomated(row, config = provisioningConfig()) {
  return Boolean(config) && AUTOMATED_RESOURCES.includes(row.resource_type);
}

export function usernameFor(student) {
  const prefix = USERNAME_PREFIX[student?.study_degree];
  if (!prefix || !/^\d{1,12}$/.test(student?.s_id ?? '')) {
    throw httpError('The student’s profile needs a numeric student ID and a degree before this request can be set up', 400);
  }
  return `${prefix}${student.s_id}`;
}

// D12: the node with the fewest GPU requests that are Approved (setup in progress) or On Use on
// the new request's start date; a tie goes to the first node in GPU_NODES. The locking read sees
// the latest committed rows and holds them, so two approvals at the same moment are counted one
// after the other instead of both picking the same empty node.
export async function pickGpuNode(tx, row, nodes) {
  const rows = await tx.$queryRaw`
    SELECT rid, status, start_date, end_date, JSON_UNQUOTE(JSON_EXTRACT(extra_details, '$.gpu_node')) AS gpu_node
    FROM request WHERE resource_type = 'GPU_SERVER' FOR UPDATE`;
  const load = new Map(nodes.map(n => [n, 0]));
  const start = row.start_date.getTime();
  for (const r of rows) {
    if (Number(r.rid) === row.rid || !load.has(r.gpu_node) || !['Approved', 'On Use'].includes(r.status)) continue;
    if (new Date(r.start_date).getTime() <= start && start <= new Date(r.end_date).getTime()) load.set(r.gpu_node, load.get(r.gpu_node) + 1);
  }
  return nodes.reduce((best, n) => (load.get(n) < load.get(best) ? n : best), nodes[0]);
}

// Called inside the approve transaction. -> { gpu_node, job } (the job row data).
export async function buildCreateJob(tx, row, config) {
  const student = await tx.user.findUnique({ where: { uid: row.student_uid } });
  const username = usernameFor(student);
  const gpu_node = await pickGpuNode(tx, row, config.gpuNodes);
  const payload = {
    action: 'CREATE', resource: row.resource_type,
    student: { username, fullName: student.fullname, email: student.siitemail },
    gpuNode: gpu_node,
    period: { start: day(row.start_date), end: day(row.end_date) },
    links: { ovpnProfileUrl: config.links.ovpnProfileUrl, manualUrl: config.links.manualGpuUrl },
  };
  return { gpu_node, job: { job_id: randomUUID(), rid: row.rid, action: 'CREATE', payload } };
}

// The VPN account is shared by all of a student's requests: disable it only when no other request
// of theirs is in use or still being set up (plan §6b REVOKE).
async function keepsVpn(tx, row) {
  const others = await tx.request.count({ where: { student_uid: row.student_uid, rid: { not: row.rid }, OR: [
    { status: 'On_Use' }, { status: 'Approved', resource_type: { in: AUTOMATED_RESOURCES } },
  ] } });
  return others > 0;
}

// Called inside the complete transaction (and by the scheduler later, D7). At most one REVOKE per
// request unless the last one failed. -> the job row data, or null.
export async function buildRevokeJob(tx, row) {
  const gpu_node = row.extra_details?.gpu_node;
  if (!gpu_node) return null;
  const pending = await tx.provision_job.count({ where: { rid: row.rid, action: 'REVOKE', status: { not: 'Failed' } } });
  if (pending) return null;
  const student = await tx.user.findUnique({ where: { uid: row.student_uid } });
  const payload = {
    action: 'REVOKE', resource: row.resource_type,
    student: { username: usernameFor(student), fullName: student.fullname },
    gpuNode: gpu_node, revokeVpn: !(await keepsVpn(tx, row)),
  };
  return { job_id: randomUUID(), rid: row.rid, action: 'REVOKE', payload };
}

// Manual Activate stays for automated requests only as a fallback after a failed setup.
export async function assertManualActivationAllowed(tx, row) {
  const last = await tx.provision_job.findFirst({ where: { rid: row.rid, action: 'CREATE' }, orderBy: { created_at: 'desc' } });
  if (last && last.status !== 'Failed') {
    throw httpError('This request is set up automatically; it becomes active when the setup succeeds', 400);
  }
}

// Reviewer's Retry after a failure (D4): a new job with a new job_id, since acc-prov-vm answers a
// job_id it has seen with its stored result.
export async function retryProvisioning(request_id, reviewer_account_id) {
  const config = provisioningConfig();
  if (!config) throw httpError('Automatic provisioning is off', 400);
  return prisma.$transaction(async tx => {
    const reviewer = await tx.user.findUnique({ where: { uid: reviewer_account_id } });
    if (reviewer?.role !== 'Approver') throw httpError('Reviewer access required', 403);
    const row = await tx.request.findUnique({ where: { rid: request_id } });
    if (!row) throw httpError('Request not found', 404);
    const last = await tx.provision_job.findFirst({ where: { rid: request_id }, orderBy: { created_at: 'desc' } });
    if (last?.status !== 'Failed') throw httpError('Only a failed setup can be retried', 400);
    let payload = last.payload;
    if (last.action === 'CREATE') {
      if (row.status !== 'Approved') throw httpError('Invalid state transition', 400);
      payload = { ...payload, links: { ovpnProfileUrl: config.links.ovpnProfileUrl, manualUrl: config.links.manualGpuUrl } };
    } else {
      payload = { ...payload, revokeVpn: !(await keepsVpn(tx, row)) };
    }
    const job_id = randomUUID();
    await tx.provision_job.create({ data: { job_id, rid: request_id, action: last.action, payload } });
    await tx.request_event.create({ data: {
      rid: request_id, action: 'RETRIED', from_status: row.status, to_status: row.status, actor_uid: reviewer_account_id,
      details: { job_id, retry_of: last.job_id, job_action: last.action },
    } });
    return jobView(await tx.provision_job.findUnique({ where: { job_id } }));
  });
}

export function jobView(job) {
  return job && {
    id: job.job_id, action: job.action, status: job.status, attempts: job.attempts, error: job.last_error ?? null,
    gpu_node: job.payload?.gpuNode ?? null, vpn: job.result?.vpn ?? null,
    created_at: job.created_at, sent_at: job.sent_at, completed_at: job.completed_at,
  };
}

export async function jobsFor(client, request_id) {
  const jobs = await client.provision_job.findMany({ where: { rid: request_id }, orderBy: { created_at: 'asc' } });
  return jobs.map(jobView);
}

const backoffMs = (attempts) => Math.min(5_000 * 2 ** attempts, 5 * 60_000);

// Publishes due Queued jobs. Several backend tasks may run this at once: SKIP LOCKED gives each
// job to one of them. A job is sealed when it is sent, so its lifetime starts then. A send that
// fails is retried with backoff and never marks the job Failed (the broker may just be down).
// -> number of jobs sent.
export async function dispatchQueued({ config, transport, log = () => {}, now = () => new Date() }) {
  return prisma.$transaction(async tx => {
    const due = await tx.$queryRaw`
      SELECT job_id FROM provision_job WHERE status = 'Queued' AND next_attempt_at <= ${now()}
      ORDER BY created_at LIMIT ${DISPATCH_BATCH} FOR UPDATE SKIP LOCKED`;
    let sent = 0;
    for (const { job_id } of due) {
      const job = await tx.provision_job.findUnique({ where: { job_id } });
      try {
        const text = seal({ typ: 'job', jti: job.job_id, rid: job.rid, payload: job.payload, ttlSec: config.jobTtlSec, now: now().getTime() }, { me: config.me, peer: config.peers[0] });
        await transport.send(text);
        await tx.provision_job.update({ where: { job_id }, data: { status: 'Sent', sent_at: now(), attempts: { increment: 1 }, last_error: null } });
        log('provision.sent', { job_id, rid: job.rid, action: job.action });
        sent++;
      } catch (err) {
        await tx.provision_job.update({ where: { job_id }, data: {
          attempts: { increment: 1 }, last_error: `Not sent yet: ${err.message}`.slice(0, MAX_ERROR_LENGTH),
          next_attempt_at: new Date(now().getTime() + backoffMs(job.attempts)),
        } });
        log('provision.send_failed', { job_id, rid: job.rid, attempt: job.attempts + 1, error: err.message });
      }
    }
    return sent;
  }, { timeout: 120_000 });
}

// One result message from acc-prov-vm. Throws PoisonMessageError for anything forged or
// malformed (the transport dead-letters it), and any other error to have it delivered again.
// A result for a job that is already finished, or unknown here, is dropped (it was a redelivery,
// or belongs to another environment that shares the broker).
export async function handleResult(text, { config, log = () => {} }) {
  let msg;
  try {
    msg = open(text, { me: config.me, peers: config.peers, expectedTyp: 'result', maxTtlSec: config.maxTtlSec });
  } catch (err) {
    if (err instanceof EnvelopeError) {
      log('provision.result_rejected', { reason: err.message });
      throw new PoisonMessageError(err.message);
    }
    throw err;
  }
  const result = Object.fromEntries(RESULT_FIELDS.filter(k => msg.payload?.[k] !== undefined).map(k => [k, msg.payload[k]]));
  const ok = result.ok === true;
  const error = ok ? null : String(result.error ?? 'acc-prov-vm reported a failure').slice(0, MAX_ERROR_LENGTH);

  return prisma.$transaction(async tx => {
    const job = await tx.provision_job.findUnique({ where: { job_id: msg.jti } });
    if (!job || job.rid !== msg.rid) {
      log('provision.result_unknown', { job_id: msg.jti, rid: msg.rid });
      return 'unknown';
    }
    const finished = await tx.provision_job.updateMany({ where: { job_id: job.job_id, status: { in: ACTIVE_JOB } }, data: {
      status: ok ? 'Succeeded' : 'Failed', result, last_error: error, completed_at: new Date(),
    } });
    if (!finished.count) {
      log('provision.result_duplicate', { job_id: job.job_id, rid: job.rid });
      return 'duplicate';
    }
    // D10: a successful CREATE makes the request On Use; a successful REVOKE completes it.
    const row = await tx.request.findUnique({ where: { rid: job.rid } });
    let to = row.status;
    if (ok && job.action === 'CREATE' && row.status === 'Approved') to = 'On_Use';
    if (ok && job.action === 'REVOKE' && row.status === 'On_Use') to = 'Completed';
    if (to !== row.status) {
      const moved = await tx.request.updateMany({ where: { rid: row.rid, status: row.status }, data: { status: to } });
      // Changed in the meantime: roll back and let the message come again.
      if (!moved.count) throw new Error(`request ${row.rid} changed while its result was applied`);
    }
    await tx.request_event.create({ data: {
      rid: job.rid, action: RESULT_EVENT[job.action][ok ? 0 : 1], from_status: row.status, to_status: to, actor_uid: null,
      comment: error, details: { job_id: job.job_id, gpu_node: job.payload?.gpuNode ?? null,
        ...(result.vpn !== undefined && { vpn: result.vpn }), ...(!ok && { permanent: result.permanent === true }) },
    } });
    log('provision.result', { job_id: job.job_id, rid: job.rid, action: job.action, ok });
    return ok ? 'succeeded' : 'failed';
  });
}
