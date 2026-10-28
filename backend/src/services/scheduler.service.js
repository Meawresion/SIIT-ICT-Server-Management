// The scheduler (step 7, FR-8.4). Every backend task runs the loop; a pass runs only in the task
// that holds the scheduler_lease row. Each pass:
// - reminders (FR-8.2): the student of an On Use request hears EXPIRY_REMINDER_DAYS before its end
//   date, once;
// - expiry (D7, FR-8.5): an On Use request whose end date has passed gets a REVOKE job when it was
//   set up automatically (the result then completes it, D10), or the approvers are asked to remove
//   the access by hand (S8); once;
// - dead letters (FR-6.7, S5): a job or result the broker gave up on fails its job, which alerts
//   the approvers like a failed result;
// - no answer: a Sent job still unanswered after it expired fails the same way.
// Each action appends a request_event (actor NULL = the system) in the same transaction; the
// event is also what keeps it from being done twice.

import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import prisma from '../lib/prisma.js';
import { buildRevokeJob, failJob, isAutomated } from './provisioning.service.js';

const LEASE_NAME = 'scheduler';
// Late answers still count: the site's clock check allows 5 minutes, and a job may be running.
const NO_ANSWER_GRACE_SEC = 15 * 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export const OWNER = `${hostname()}:${process.pid}:${randomBytes(3).toString('hex')}`.slice(0, 100);

// Request dates are stored as midnight UTC of the chosen day, so a date is compared by its day.
const day = (date) => date.toISOString().slice(0, 10);
const midnightUtc = (dayText) => new Date(`${dayText}T00:00:00Z`);
const addDays = (dayText, n) => day(new Date(midnightUtc(dayText).getTime() + n * DAY_MS));

// Today (YYYY-MM-DD) where the requests' dates apply.
export function siteToday(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// Takes or renews the lease for seconds. -> true when this task holds it.
export async function acquireLease({ seconds, owner = OWNER }) {
  const updated = await prisma.$executeRaw`
    UPDATE scheduler_lease SET owner = ${owner}, lease_until = NOW(3) + INTERVAL ${seconds} SECOND
    WHERE name = ${LEASE_NAME} AND (lease_until < NOW(3) OR owner = ${owner})`;
  return updated === 1;
}

// On shutdown, so another task can take over at its next pass.
export async function releaseLease({ owner = OWNER } = {}) {
  await prisma.$executeRaw`UPDATE scheduler_lease SET lease_until = NOW(3) WHERE name = ${LEASE_NAME} AND owner = ${owner}`;
}

// Appends a system event for an On Use request, unless the request moved on or already has one with
// this action. work(tx, row) may add to the same transaction and returns extra details.
// -> the event for notify, or null.
async function systemEvent(rid, action, work = async () => ({})) {
  return prisma.$transaction(async tx => {
    const row = await tx.request.findUnique({ where: { rid } });
    if (row?.status !== 'On_Use' || await tx.request_event.count({ where: { rid, action } })) return null;
    const details = { end_date: day(row.end_date), ...(await work(tx, row)) };
    await tx.request_event.create({ data: { rid, action, from_status: row.status, to_status: row.status, actor_uid: null, details } });
    return { rid, action, from: row.status, to: row.status, comment: null, details };
  });
}

// FR-8.2. -> number of reminders.
export async function remindEndingRequests({ today, reminderDays, log = () => {}, notify = () => {} }) {
  if (!reminderDays) return 0;
  const rows = await prisma.request.findMany({
    where: { status: 'On_Use', end_date: { gte: midnightUtc(today), lte: midnightUtc(addDays(today, reminderDays)) },
      request_event: { none: { action: 'REMINDED' } } },
    select: { rid: true },
  });
  let count = 0;
  for (const { rid } of rows) {
    try {
      const event = await systemEvent(rid, 'REMINDED');
      if (!event) continue;
      notify(event);
      log('scheduler.reminded', { rid, end_date: event.details.end_date });
      count++;
    } catch (err) {
      log('scheduler.remind_failed', { rid, error: err.message });
    }
  }
  return count;
}

// D7. provisioning: the provisioning settings, or null when it is off. -> number of requests.
export async function expireEndedRequests({ today, provisioning, log = () => {}, notify = () => {} }) {
  const rows = await prisma.request.findMany({
    where: { status: 'On_Use', end_date: { lt: midnightUtc(today) }, request_event: { none: { action: 'EXPIRED' } } },
    select: { rid: true },
  });
  let count = 0;
  for (const { rid } of rows) {
    try {
      const event = await systemEvent(rid, 'EXPIRED', async (tx, row) => {
        const job = isAutomated(row, provisioning) ? await buildRevokeJob(tx, row) : null;
        if (!job) return { by_hand: true };
        await tx.provision_job.create({ data: job });
        return { job_id: job.job_id, job_action: job.action };
      });
      if (!event) continue;
      notify(event);
      log('scheduler.expired', { rid, ...event.details });
      count++;
    } catch (err) {
      log('scheduler.expire_failed', { rid, error: err.message });
    }
  }
  return count;
}

// One dead-lettered message. Only the envelope's plain-text header is read (typ, jti, rid, exp);
// it is never opened. A message that doesn't name a job still waiting for its answer, for that
// request, changes nothing. -> outcome.
export async function handleDeadLetter(text, { log = () => {}, notify = () => {}, now = new Date() }) {
  let h = null;
  try {
    h = JSON.parse(text);
  } catch { /* unreadable */ }
  if (!['job', 'result'].includes(h?.typ) || !UUID_RE.test(h.jti ?? '') || !Number.isSafeInteger(h.rid)) {
    log('scheduler.dead_letter_unreadable', {});
    return 'unreadable';
  }
  let error;
  if (h.typ === 'result') error = 'The SIIT site answered, but its answer could not be read or applied. Check the site before retrying.';
  else if (Number.isInteger(h.exp) && h.exp * 1000 < now.getTime()) error = 'The job expired before the SIIT site took it (was the site offline?).';
  else error = 'The SIIT site refused the job.';
  const outcome = await failJob({ job_id: h.jti, rid: h.rid, error, details: { dead_letter: h.typ }, log, notify });
  if (outcome !== 'failed') log('scheduler.dead_letter_ignored', { job_id: h.jti, rid: h.rid, outcome });
  return outcome;
}

// A Sent job is valid for jobTtlSec; after that the site refuses it, so no answer will come.
// -> number of jobs failed.
export async function failUnansweredJobs({ provisioning, log = () => {}, notify = () => {}, now = new Date() }) {
  const cutoff = new Date(now.getTime() - (provisioning.jobTtlSec + NO_ANSWER_GRACE_SEC) * 1000);
  const jobs = await prisma.provision_job.findMany({ where: { status: 'Sent', sent_at: { lt: cutoff } }, select: { job_id: true, rid: true } });
  const hours = Math.round(provisioning.jobTtlSec / 3600);
  let count = 0;
  for (const { job_id, rid } of jobs) {
    const error = `No answer from the SIIT site within ${hours} hours; the job has expired.`;
    if (await failJob({ job_id, rid, error, details: { no_answer: true }, log, notify }) === 'failed') count++;
  }
  return count;
}

// One pass. A step that fails is logged and the others still run. -> counts.
export async function runPass({ config, provisioning, transport, log = () => {}, notify = () => {}, now = new Date() }) {
  const today = siteToday(config.timeZone, now);
  const counts = {};
  const step = async (name, fn) => {
    try {
      counts[name] = await fn();
    } catch (err) {
      log('scheduler.step_failed', { step: name, error: err.message });
    }
  };
  await step('reminded', () => remindEndingRequests({ today, reminderDays: config.reminderDays, log, notify }));
  await step('expired', () => expireEndedRequests({ today, provisioning, log, notify }));
  if (provisioning) {
    if (transport?.drainDeadLetters) {
      await step('dead_letters', () => transport.drainDeadLetters(text => handleDeadLetter(text, { log, notify, now })));
    }
    await step('unanswered', () => failUnansweredJobs({ provisioning, log, notify, now }));
  }
  return counts;
}

// Runs a pass every config.intervalSec in this backend task while it holds the lease; the lease
// lasts a minute longer than the interval, so the holder keeps it. -> { stop() }
export function startScheduler(config, { provisioning, transport, log = () => {}, notify = () => {} }) {
  const leaseSec = config.intervalSec + 60;
  let running = null;
  const tick = async () => {
    if (running) return;
    running = (async () => {
      try {
        if (!(await acquireLease({ seconds: leaseSec }))) return;
        const counts = await runPass({ config, provisioning, transport, log, notify });
        if (Object.values(counts).some(Boolean)) log('scheduler.pass', counts);
      } catch (err) {
        log('scheduler.failed', { error: err.message });
      }
    })();
    await running;
    running = null;
  };
  const timer = setInterval(tick, config.intervalSec * 1000);
  const first = setTimeout(tick, 5_000);
  log('scheduler.started', { owner: OWNER, interval_sec: config.intervalSec, reminder_days: config.reminderDays,
    time_zone: config.timeZone, dead_letter_queues: provisioning?.[provisioning.transport]?.deadLetterQueues?.length ?? 0 });
  return {
    async stop() {
      clearInterval(timer);
      clearTimeout(first);
      await running;
      await releaseLease().catch(() => {});
    },
  };
}
