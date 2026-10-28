// AMQP 1.0 transport to the local ActiveMQ Artemis broker (D23), with the same contract as the SQS
// transport:
// - send(text): resolves once the broker has stored the job message;
// - consume(handler): the result message is accepted (removed) only after handler resolves,
//   released for redelivery if it throws, and rejected (dead-lettered) on a PoisonMessageError;
// - drainDeadLetters(handler): the scheduler reads the broker's DLQ.
// Message bodies are envelope strings; this layer never sees plaintext.
// Unlike acc-prov-vm's one-shot connection, the backend keeps running while the broker restarts:
// rhea reconnects and re-attaches the result receiver; a send in the meantime times out and the
// dispatcher retries the job later.

import rhea from 'rhea';
import { PoisonMessageError } from './errors.js';

export function createAmqpTransport({ url, username, password, requestQueue, resultQueue, deadLetterQueues = [] },
  { log = () => {}, sendTimeoutMs = 15_000, retryDelayMs = 5_000 } = {}) {
  const u = new URL(url);
  const container = rhea.create_container();
  const conn = container.connect({
    host: u.hostname,
    port: Number(u.port || (u.protocol === 'amqps:' ? 5671 : 5672)),
    transport: u.protocol === 'amqps:' ? 'tls' : 'tcp',
    username,
    password,
    reconnect: true,
    initial_reconnect_delay: 1_000,
    max_reconnect_delay: 30_000,
  });
  conn.on('connection_open', () => log('amqp.connected', { host: u.host }));
  conn.on('connection_error', (ctx) => log('amqp.error', { host: u.host, error: ctx.connection?.error?.description }));
  conn.on('disconnected', (ctx) => log('amqp.disconnected', { host: u.host, error: ctx.error?.message }));
  conn.on('error', (ctx) => log('amqp.error', { host: u.host, error: ctx.error?.message }));

  // 'queue' capability = Artemis ANYCAST: each message goes to exactly one consumer.
  function send(text) {
    const sender = conn.open_sender({ target: { address: requestQueue, capabilities: ['queue'] } });
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sender.close();
        if (err) reject(err);
        else resolve();
      };
      const timer = setTimeout(() => done(new Error(`the broker at ${u.host} did not take the message in time`)), sendTimeoutMs);
      sender.once('sendable', () => {
        const delivery = sender.send({ body: text, durable: true });
        const settle = (outcome) => (ctx) => {
          if (ctx.delivery !== delivery) return;
          done(outcome === 'accepted' ? null : new Error(`the broker ${outcome} the message on ${requestQueue}`));
        };
        for (const outcome of ['accepted', 'rejected', 'released', 'modified']) sender.on(outcome, settle(outcome));
      });
      sender.once('sender_error', (ctx) => done(new Error(`AMQP sender error: ${ctx.sender.error?.description}`)));
    });
  }

  // handler(text) -> Promise. Returns { stop() }.
  function consume(handler) {
    const receiver = conn.open_receiver({
      source: { address: resultQueue, capabilities: ['queue'] },
      autoaccept: false,
      credit_window: 1,
    });
    receiver.on('message', async (ctx) => {
      try {
        await handler(String(ctx.message.body));
        ctx.delivery.accept();
      } catch (err) {
        if (err instanceof PoisonMessageError) {
          ctx.delivery.reject({ condition: 'amqp:invalid-field', description: 'invalid message' });
          log('amqp.rejected', { queue: resultQueue, error: err.message });
          return;
        }
        log('amqp.released', { queue: resultQueue, error: err.message });
        // Back off a little so a failing result doesn't spin; Artemis counts the failed delivery.
        await new Promise((r) => setTimeout(r, retryDelayMs));
        ctx.delivery.release({ delivery_failed: true });
      }
    });
    return { stop: () => receiver.close() };
  }

  // The scheduler's look into the dead-letter queue (FR-6.7; Artemis puts both directions' dead
  // letters in one DLQ): takes what is waiting, at most max messages, until none arrives for
  // idleMs. A message handler resolved for is accepted (removed); one it throws for is put back
  // for a later pass, never to this receiver again. -> number handled.
  function drainDeadLetters(handler, { max = 50, idleMs = 1_000, timeoutMs = 30_000 } = {}) {
    const [queue] = deadLetterQueues;
    if (!queue) return Promise.resolve(0);
    return new Promise((resolve) => {
      const receiver = conn.open_receiver({ source: { address: queue, capabilities: ['queue'] }, autoaccept: false, credit_window: 0 });
      let seen = 0, handled = 0, idle, finished = false, work = Promise.resolve();
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(idle);
        clearTimeout(limit);
        work.then(() => {
          receiver.close();
          resolve(handled);
        });
      };
      const limit = setTimeout(finish, timeoutMs);
      const waitForMore = () => {
        clearTimeout(idle);
        idle = setTimeout(finish, idleMs);
      };
      receiver.once('receiver_open', () => {
        receiver.add_credit(max);
        waitForMore();
      });
      receiver.on('message', (ctx) => {
        if (finished) return;
        seen++;
        waitForMore();
        work = work.then(async () => {
          try {
            await handler(String(ctx.message.body));
            ctx.delivery.accept();
            handled++;
          } catch (err) {
            log('amqp.dead_letter_kept', { queue, error: err.message });
            ctx.delivery.modified({ delivery_failed: true, undeliverable_here: true });
          }
        });
        if (seen >= max) finish();
      });
      receiver.once('receiver_error', (ctx) => {
        log('amqp.error', { queue, error: ctx.receiver?.error?.description });
        finish();
      });
    });
  }

  return { send, consume, drainDeadLetters, close: () => conn.close() };
}
