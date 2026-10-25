// The acc-prov-vm worker: takes one job at a time from the request queue and answers on the
// result queue. Transport-agnostic (local ActiveMQ now, SQS later).
//
// Per message:
// 1. open the envelope; anything untrusted or malformed -> PoisonMessageError (dead-lettered, no reply);
// 2. a jti already done -> re-send its stored result (redelivery / replay is harmless);
// 3. otherwise run the job; success -> store + send the result;
// 4. failure -> retry through redelivery, up to maxAttempts; JobRejectedError or the last attempt
//    -> store + send a failed result, so the backend always hears back.
// The message is acknowledged only after the result has been sent.

import { EnvelopeError, open, seal } from './envelope.js';
import { JobRejectedError, PoisonMessageError } from './errors.js';
import { parseJobPayload } from './jobs.js';

// opts: { transport, requestQueue, resultQueue, me, peers, maxTtlSec, resultTtlSec, store, handlers,
//         maxAttempts, log }
export function createWorker(opts) {
  const { transport, requestQueue, resultQueue, me, peers, maxTtlSec, resultTtlSec, store, handlers, maxAttempts } = opts;
  const log = opts.log ?? (() => {});

  async function sendResult(job, result) {
    const text = seal({ typ: 'result', jti: job.jti, rid: job.rid, payload: result, ttlSec: resultTtlSec }, { me, peer: peers[0] });
    await transport.send(resultQueue, text);
    log('worker.result_sent', { jti: job.jti, rid: job.rid, ok: result.ok });
  }

  async function fail(job, payload, err) {
    const result = {
      ok: false,
      action: payload?.action,
      resource: payload?.resource,
      username: payload?.student?.username,
      error: err.message,
      permanent: err instanceof JobRejectedError,
    };
    store.finish(job.jti, job.rid, result);
    await sendResult(job, result);
  }

  async function onMessage(text, { deliveryCount = 0 } = {}) {
    let job;
    try {
      job = open(text, { me, peers, expectedTyp: 'job', maxTtlSec });
    } catch (err) {
      if (err instanceof EnvelopeError) {
        log('worker.envelope_rejected', { reason: err.message });
        throw new PoisonMessageError(err.message);
      }
      throw err;
    }

    const prior = store.get(job.jti);
    if (prior?.status === 'done') {
      log('worker.duplicate', { jti: job.jti, rid: job.rid });
      await sendResult(job, prior.result);
      return;
    }

    let payload;
    try {
      payload = parseJobPayload(job.payload);
    } catch (err) {
      log('worker.job_rejected', { jti: job.jti, rid: job.rid, reason: err.message });
      await fail(job, job.payload, err);
      return;
    }

    const attempt = deliveryCount + 1;
    log('worker.job_start', { jti: job.jti, rid: job.rid, action: payload.action, user: payload.student.username, attempt });
    try {
      const result = await handlers.run(payload, {
        progress: prior?.progress ?? {},
        saveProgress: (p) => store.setProgress(job.jti, job.rid, p),
      });
      store.finish(job.jti, job.rid, result);
      await sendResult(job, result);
      log('worker.job_done', { jti: job.jti, rid: job.rid });
    } catch (err) {
      if (err instanceof JobRejectedError || attempt >= maxAttempts) {
        log('worker.job_failed', { jti: job.jti, rid: job.rid, attempt, error: err.message });
        await fail(job, payload, err);
        return;
      }
      log('worker.job_retry', { jti: job.jti, rid: job.rid, attempt, error: err.message });
      throw err;
    }
  }

  let sub;
  return {
    onMessage,
    start() {
      sub = transport.consume(requestQueue, onMessage);
      log('worker.started', { requestQueue, resultQueue });
    },
    stop() {
      sub?.stop();
    },
  };
}
