// Copies the audit trail (request_event, FR-9.1) into the logs as one `audit.event` line per event.
// On AWS the logs go to S3 (logs stack), so the trail outlives the database and is kept for the
// audit period (NFR-7.1).
//
// The cursor row log_cursor('audit') holds the last event id shipped. Each run locks it with SKIP
// LOCKED, so only one backend task ships at a time and the others just skip. Only events older
// than lagSec are shipped: an event id is taken at insert time, so without the lag an event whose
// transaction commits late could be passed over. Delivery is at least once: if a task dies between
// logging a batch and saving the cursor, that batch is logged again (same eid).

import prisma from '../lib/prisma.js';

const DEFAULT_INTERVAL_SEC = 30;

// -> number of events shipped in this run.
export async function shipAuditEvents({ log, lagSec = 120, batch = 500, now = () => new Date() } = {}) {
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
      for (const e of events) {
        log('audit.event', {
          eid: Number(e.eid), rid: e.rid, action: e.action, from_status: e.from_status, to_status: e.to_status,
          actor_uid: e.actor_uid, comment: e.comment, details: e.details, at: e.created_at,
        });
      }
      if (events.length) await tx.log_cursor.update({ where: { name: 'audit' }, data: { last_id: events.at(-1).eid } });
      return events.length;
    });
    shipped += n;
    if (n < batch) return shipped;
  }
}

// AUDIT_LOG_INTERVAL_SEC (default 30): how often to look for new events.
export function startAuditShipper({ log, intervalSec = Number(process.env.AUDIT_LOG_INTERVAL_SEC || DEFAULT_INTERVAL_SEC) }) {
  if (!Number.isInteger(intervalSec) || intervalSec < 5) throw new Error('AUDIT_LOG_INTERVAL_SEC must be a whole number of seconds, at least 5');
  let running = null;
  const run = () => {
    if (running) return;
    running = shipAuditEvents({ log })
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
