// Copies the audit trail (request_event, FR-9.1) out of the database, one JSON line per event, so
// the trail outlives the database and is kept for the audit period (NFR-7.1). On AWS the lines go
// straight to the audit log group (AUDIT_LOG_GROUP, kept 400 days by the logs stack); without it
// (local runs) they are `audit.event` lines in the service log.
//
// The cursor row log_cursor('audit') holds the last event id shipped. Each run locks it with SKIP
// LOCKED, so only one backend task ships at a time and the others just skip. Only events older
// than lagSec are shipped: an event id is taken at insert time, so without the lag an event whose
// transaction commits late could be passed over. The cursor moves only after the sink accepted the
// batch, so delivery is at least once: a batch is sent again (same eid) if the task dies in between.

import { CloudWatchLogsClient, CreateLogStreamCommand, PutLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import prisma from '../lib/prisma.js';

const DEFAULT_INTERVAL_SEC = 30;
// PutLogEvents takes at most 1 MB per call (each event counts 26 bytes more).
const MAX_PUT_BYTES = 900_000;

const eventFields = e => ({
  eid: Number(e.eid), rid: e.rid, action: e.action, from_status: e.from_status, to_status: e.to_status,
  actor_uid: e.actor_uid, comment: e.comment, details: e.details, at: e.created_at,
});

// The audit log group on AWS: one stream per day, created on first use. Events carry the time they
// are shipped (CloudWatch refuses events older than 14 days); `at` is when they happened.
export function cloudWatchSink({ logGroup, client = new CloudWatchLogsClient({}), now = () => new Date() }) {
  const streams = new Set();
  async function stream() {
    const name = `request_event/${now().toISOString().slice(0, 10)}`;
    if (!streams.has(name)) {
      try {
        await client.send(new CreateLogStreamCommand({ logGroupName: logGroup, logStreamName: name }));
      } catch (err) {
        if (err.name !== 'ResourceAlreadyExistsException') throw err;
      }
      streams.add(name);
    }
    return name;
  }
  return {
    async write(events) {
      const logStreamName = await stream();
      const timestamp = now().getTime();
      let batch = [];
      let bytes = 0;
      const flush = async () => {
        if (!batch.length) return;
        const res = await client.send(new PutLogEventsCommand({ logGroupName: logGroup, logStreamName, logEvents: batch }));
        if (res.rejectedLogEventsInfo) throw new Error(`CloudWatch Logs rejected audit events: ${JSON.stringify(res.rejectedLogEventsInfo)}`);
        batch = [];
        bytes = 0;
      };
      for (const e of events) {
        const message = JSON.stringify(eventFields(e));
        if (bytes + message.length + 26 > MAX_PUT_BYTES) await flush();
        batch.push({ timestamp, message });
        bytes += message.length + 26;
      }
      await flush();
    },
  };
}

// Local runs: `audit.event` lines in the service log.
export const logSink = ({ log }) => ({
  async write(events) {
    for (const e of events) log('audit.event', eventFields(e));
  },
});

// -> number of events shipped in this run.
export async function shipAuditEvents({ sink, lagSec = 120, batch = 500, now = () => new Date() }) {
  let shipped = 0;
  for (;;) {
    const n = await prisma.$transaction(async tx => {
      const [cursor] = await tx.$queryRaw`SELECT last_id FROM log_cursor WHERE name = 'audit' FOR UPDATE SKIP LOCKED`;
      if (!cursor) return 0; // another task is shipping
      const events = await tx.request_event.findMany({
        where: { eid: { gt: cursor.last_id }, created_at: { lt: new Date(now().getTime() - lagSec * 1000) } },
        orderBy: { eid: 'asc' },
        take: batch,
      });
      if (!events.length) return 0;
      await sink.write(events);
      await tx.log_cursor.update({ where: { name: 'audit' }, data: { last_id: events.at(-1).eid } });
      return events.length;
    }, { timeout: 30_000 });
    shipped += n;
    if (n < batch) return shipped;
  }
}

// AUDIT_LOG_INTERVAL_SEC (default 30): how often to look for new events.
// AUDIT_LOG_GROUP: the CloudWatch Logs group to write to; empty = the service log.
export function startAuditShipper({
  log,
  intervalSec = Number(process.env.AUDIT_LOG_INTERVAL_SEC || DEFAULT_INTERVAL_SEC),
  logGroup = process.env.AUDIT_LOG_GROUP,
  sink = logGroup ? cloudWatchSink({ logGroup }) : logSink({ log }),
}) {
  if (!Number.isInteger(intervalSec) || intervalSec < 5) throw new Error('AUDIT_LOG_INTERVAL_SEC must be a whole number of seconds, at least 5');
  log('audit.shipper', { to: logGroup || 'service log' });
  let running = null;
  const run = () => {
    if (running) return;
    running = shipAuditEvents({ sink })
      .catch(err => log('audit.ship_failed', { error: err.message }))
      .finally(() => { running = null; });
  };
  const timer = setInterval(run, intervalSec * 1000);
  timer.unref();
  return {
    async stop() {
      clearInterval(timer);
      await running;
    },
  };
}
