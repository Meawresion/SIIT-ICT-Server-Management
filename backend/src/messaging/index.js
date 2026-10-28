// Starts provisioning in this backend task: the outbox dispatcher and the result consumer, on the
// transport MESSAGE_TRANSPORT names. The rest of the code doesn't know which one is in use.

import { dispatchQueued, handleResult } from '../services/provisioning.service.js';
import { notifyRequestEvent } from '../services/notify.service.js';

const DISPATCH_INTERVAL_MS = 3_000;

export async function createTransport(config, { log }) {
  if (config.transport === 'sqs') {
    const { createSqsTransport } = await import('./sqs.js');
    return createSqsTransport(config.sqs, { log });
  }
  const { createAmqpTransport } = await import('./amqp.js');
  return createAmqpTransport(config.amqp, { log });
}

// -> { transport, stop() } (the scheduler reads the dead letters through transport)
export async function startProvisioning(config, { log }) {
  const transport = await createTransport(config, { log });
  const consumer = transport.consume((text) => handleResult(text, { config, log, notify: notifyRequestEvent }));
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await dispatchQueued({ config, transport, log });
    } catch (err) {
      log('provision.dispatch_failed', { error: err.message });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, DISPATCH_INTERVAL_MS);
  tick();
  log('provision.started', { transport: config.transport, kid: config.me.kid, gpu_nodes: config.gpuNodes });
  return {
    transport,
    async stop() {
      clearInterval(timer);
      await consumer.stop();
      transport.close();
    },
  };
}
