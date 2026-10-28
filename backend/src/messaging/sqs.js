// SQS transport (AWS), with the same contract as the AMQP one:
// - send(text): resolves once SQS has stored the job message;
// - consume(handler): long-polls the result queue; a message is deleted only after handler
//   resolves. If it throws, the message comes back after the queue's visibility timeout; a
//   PoisonMessageError makes it visible again at once, so the redrive policy moves it to the DLQ
//   after maxReceiveCount without waiting;
// - drainDeadLetters(handler): the scheduler reads the request and result DLQs.
// Every running backend task polls; SQS gives each message to one of them, and handleResult is
// idempotent because standard queues deliver at least once.

import { ChangeMessageVisibilityCommand, DeleteMessageCommand, ReceiveMessageCommand, SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { PoisonMessageError } from './errors.js';

export function createSqsTransport({ region, requestQueueUrl, resultQueueUrl, deadLetterQueues = [] },
  { log = () => {}, client = new SQSClient({ region }), retryDelayMs = 5_000 } = {}) {
  async function send(text) {
    await client.send(new SendMessageCommand({ QueueUrl: requestQueueUrl, MessageBody: text }));
  }

  function consume(handler) {
    const abort = new AbortController();
    let stopped = false;
    const loop = (async () => {
      while (!stopped) {
        let messages;
        try {
          ({ Messages: messages = [] } = await client.send(
            new ReceiveMessageCommand({ QueueUrl: resultQueueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 20 }),
            { abortSignal: abort.signal },
          ));
        } catch (err) {
          if (stopped) break;
          log('sqs.receive_failed', { error: err.message });
          await new Promise((r) => setTimeout(r, retryDelayMs));
          continue;
        }
        for (const m of messages) {
          try {
            await handler(m.Body);
            await client.send(new DeleteMessageCommand({ QueueUrl: resultQueueUrl, ReceiptHandle: m.ReceiptHandle }));
          } catch (err) {
            log(err instanceof PoisonMessageError ? 'sqs.rejected' : 'sqs.retry_later', { error: err.message });
            if (err instanceof PoisonMessageError) {
              await client.send(new ChangeMessageVisibilityCommand({ QueueUrl: resultQueueUrl, ReceiptHandle: m.ReceiptHandle, VisibilityTimeout: 0 }))
                .catch((e) => log('sqs.visibility_failed', { error: e.message }));
            }
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

  // The scheduler's look into the dead-letter queues (FR-6.7): reads what is waiting, at most max
  // messages, and deletes each one handler resolved for; one it throws for comes back on a later
  // pass. -> number handled.
  async function drainDeadLetters(handler, { max = 50 } = {}) {
    let seen = 0, handled = 0;
    for (const queueUrl of deadLetterQueues) {
      while (seen < max) {
        const { Messages: messages = [] } = await client.send(new ReceiveMessageCommand({
          QueueUrl: queueUrl, MaxNumberOfMessages: Math.min(10, max - seen), WaitTimeSeconds: 1, VisibilityTimeout: 120,
        }));
        if (!messages.length) break;
        seen += messages.length;
        for (const m of messages) {
          try {
            await handler(m.Body);
            await client.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle }));
            handled++;
          } catch (err) {
            log('sqs.dead_letter_kept', { error: err.message });
          }
        }
      }
    }
    return handled;
  }

  return { send, consume, drainDeadLetters, close: () => client.destroy() };
}
