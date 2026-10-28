// SQS transport (AWS), with the same contract as src/amqp.js, so the worker doesn't know which one
// it uses. Queues are named by their URLs.
// - send(queueUrl, text): resolves once SQS has stored the message;
// - consume(queueUrl, handler): one message at a time; it is deleted only after handler resolves.
//   If handler throws, the message comes back after the visibility timeout, and the queue's redrive
//   policy moves it to the DLQ after maxReceiveCount, like Artemis's max-delivery-attempts. A
//   PoisonMessageError makes it visible again at once, so it reaches the DLQ without waiting.
// - While a job runs, its visibility is extended, so a slow job (pfSense UI, conda) is never handed
//   to a second consumer.
// Message bodies are envelope strings (src/envelope.js); this layer never sees plaintext payloads.

import { ChangeMessageVisibilityCommand, DeleteMessageCommand, ReceiveMessageCommand, SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { PoisonMessageError } from './errors.js';

export class SqsConnection {
  #client;
  #log;
  #opts;

  // client: an SQSClient (tests pass a stub). opts: { visibilitySec, heartbeatMs, retryDelayMs }
  constructor(client, log = () => {}, { visibilitySec = 900, heartbeatMs = 5 * 60_000, retryDelayMs = 5_000 } = {}) {
    this.#client = client;
    this.#log = log;
    this.#opts = { visibilitySec, heartbeatMs, retryDelayMs };
  }

  // config: loadSqsConfig()
  static connect({ region }, { log } = {}) {
    return new SqsConnection(new SQSClient({ region }), log);
  }

  async send(queueUrl, text) {
    await this.#client.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: text }));
    this.#log('sqs.sent', { bytes: Buffer.byteLength(text) });
  }

  // handler(text, { deliveryCount }) -> Promise. deliveryCount counts earlier deliveries (0 first),
  // as AMQP's delivery_count does. Returns { stop() }.
  consume(queueUrl, handler) {
    const abort = new AbortController();
    let stopped = false;
    const { visibilitySec, heartbeatMs, retryDelayMs } = this.#opts;
    const loop = (async () => {
      while (!stopped) {
        let m;
        try {
          const r = await this.#client.send(new ReceiveMessageCommand({
            QueueUrl: queueUrl, MaxNumberOfMessages: 1, WaitTimeSeconds: 20, VisibilityTimeout: visibilitySec,
            MessageSystemAttributeNames: ['ApproximateReceiveCount'],
          }), { abortSignal: abort.signal });
          m = r.Messages?.[0];
        } catch (err) {
          if (stopped) break;
          this.#log('sqs.receive_failed', { error: err.message });
          await new Promise((res) => setTimeout(res, retryDelayMs));
          continue;
        }
        if (!m) continue;
        const deliveryCount = Math.max(0, Number(m.Attributes?.ApproximateReceiveCount ?? 1) - 1);
        const visibility = (seconds) => this.#client.send(new ChangeMessageVisibilityCommand({
          QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle, VisibilityTimeout: seconds,
        }));
        const heartbeat = setInterval(() => {
          visibility(visibilitySec).catch((err) => this.#log('sqs.heartbeat_failed', { error: err.message }));
        }, heartbeatMs);
        try {
          await handler(m.Body, { deliveryCount });
          clearInterval(heartbeat);
          await this.#client.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle }));
          this.#log('sqs.deleted', { deliveryCount });
        } catch (err) {
          clearInterval(heartbeat);
          if (err instanceof PoisonMessageError) {
            this.#log('sqs.rejected', { deliveryCount, error: err.message });
            await visibility(0).catch(() => {});
          } else {
            // Back off a little, then let it come back; SQS counts the receive.
            this.#log('sqs.released', { deliveryCount, error: err.message });
            await visibility(Math.ceil(retryDelayMs / 1000)).catch(() => {});
          }
        }
      }
    })();
    return {
      stop: async () => {
        stopped = true;
        abort.abort();
        await loop;
      },
    };
  }

  close() {
    this.#client.destroy();
  }
}
