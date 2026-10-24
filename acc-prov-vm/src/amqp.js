// AMQP 1.0 transport for the local ActiveMQ Artemis broker (D23), with the same contract the SQS
// transport will have:
// - send(queue, text): resolves once the broker has accepted (stored) the message;
// - consume(queue, handler): one message at a time; it is accepted (removed) only after handler
//   resolves, and released for redelivery if handler throws. Artemis moves a message to its DLQ
//   after max-delivery-attempts, like an SQS dead-letter queue. A PoisonMessageError rejects the
//   message instead, so it is dead-lettered at once.
// Message bodies are envelope strings (src/envelope.js); this layer never sees plaintext payloads.

import rhea from 'rhea';
import { PoisonMessageError } from './errors.js';

export class AmqpConnection {
  #conn;
  #log;

  constructor(conn, log) {
    this.#conn = conn;
    this.#log = log;
  }

  // config: loadAmqpConfig()
  static connect({ url, username, password }, { log = () => {}, timeoutMs = 10_000 } = {}) {
    const u = new URL(url);
    const container = rhea.create_container();
    return new Promise((resolve, reject) => {
      const conn = container.connect({
        host: u.hostname,
        port: Number(u.port || (u.protocol === 'amqps:' ? 5671 : 5672)),
        transport: u.protocol === 'amqps:' ? 'tls' : 'tcp',
        username,
        password,
        reconnect: false,
      });
      const timer = setTimeout(() => {
        conn.close();
        reject(new Error(`AMQP connect to ${u.host} timed out`));
      }, timeoutMs);
      conn.once('connection_open', () => {
        clearTimeout(timer);
        log('amqp.connect', { host: u.host });
        resolve(new AmqpConnection(conn, log));
      });
      const fail = (ctx) => {
        clearTimeout(timer);
        const err = ctx.connection?.error ?? ctx.error;
        reject(new Error(`AMQP connection to ${u.host} failed: ${err?.description ?? err?.message ?? 'disconnected'}`));
      };
      conn.once('connection_error', fail);
      conn.once('disconnected', fail);
    });
  }

  // 'queue' capability = Artemis ANYCAST: each message goes to exactly one consumer.
  send(queue, text) {
    const sender = this.#conn.open_sender({ target: { address: queue, capabilities: ['queue'] } });
    return new Promise((resolve, reject) => {
      const done = (fn, arg) => {
        sender.close();
        fn(arg);
      };
      sender.once('sendable', () => {
        const delivery = sender.send({ body: text, durable: true });
        const settle = (outcome) => (ctx) => {
          if (ctx.delivery !== delivery) return;
          if (outcome === 'accepted') {
            this.#log('amqp.sent', { queue, bytes: Buffer.byteLength(text) });
            done(resolve);
          } else {
            done(reject, new Error(`broker ${outcome} the message on ${queue}`));
          }
        };
        sender.on('accepted', settle('accepted'));
        sender.on('rejected', settle('rejected'));
        sender.on('released', settle('released'));
        sender.on('modified', settle('modified'));
      });
      sender.once('sender_error', (ctx) => done(reject, new Error(`AMQP sender error: ${ctx.sender.error?.description}`)));
    });
  }

  // handler(text, { deliveryCount }) -> Promise. Returns { stop() }.
  consume(queue, handler, { retryDelayMs = 5_000 } = {}) {
    const receiver = this.#conn.open_receiver({
      source: { address: queue, capabilities: ['queue'] },
      autoaccept: false,
      credit_window: 0,
    });
    let stopped = false;
    receiver.on('receiver_open', () => receiver.add_credit(1));
    receiver.on('message', async (ctx) => {
      const deliveryCount = ctx.message.delivery_count ?? 0;
      try {
        await handler(String(ctx.message.body), { deliveryCount });
        ctx.delivery.accept();
        this.#log('amqp.accepted', { queue, deliveryCount });
      } catch (err) {
        if (err instanceof PoisonMessageError) {
          // Untrusted or malformed: never retry; Artemis dead-letters rejected messages.
          ctx.delivery.reject({ condition: 'amqp:invalid-field', description: 'invalid message' });
          this.#log('amqp.rejected', { queue, deliveryCount, error: err.message });
          if (!stopped) receiver.add_credit(1);
          return;
        }
        this.#log('amqp.released', { queue, deliveryCount, error: err.message });
        // Back off a little so a failing job doesn't spin; Artemis counts the failed delivery.
        await new Promise((r) => setTimeout(r, retryDelayMs));
        ctx.delivery.release({ delivery_failed: true });
      }
      if (!stopped) receiver.add_credit(1);
    });
    return {
      stop: () => {
        stopped = true;
        receiver.close();
      },
    };
  }

  close() {
    this.#conn.close();
  }
}
