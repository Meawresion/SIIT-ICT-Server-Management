// acc-prov-vm entry point: npm start (reads .env).
// Logs are JSON lines on stdout. They never contain passwords or message plaintext.

import { AmqpConnection } from './amqp.js';
import { loadAmqpConfig, loadGpuConfig, loadMailConfig, loadPfSenseConfig, loadSqsConfig, loadWorkerConfig } from './config.js';
import { parsePrivateBundle, parsePublicBundles } from './envelope.js';
import { connectGpuNode, findGpuNode, provisionGpuUser, revokeGpuUser } from './gpu.js';
import { JobStore } from './jobstore.js';
import { createJobHandlers } from './jobs.js';
import { createMailer, sendProvisionEmails } from './mail.js';
import { generatePassword } from './password.js';
import { renderPasswordImage } from './password-image.js';
import { withPfSense } from './pfsense.js';
import { SqsConnection } from './sqs.js';
import { createWorker } from './worker.js';

const log = (event, fields = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));

const cfg = loadWorkerConfig();
// Local ActiveMQ (amqp) or AWS (sqs); both give { requestQueue, resultQueue } and the same transport contract.
const queues = cfg.transport === 'sqs' ? loadSqsConfig() : loadAmqpConfig();
const gpu = loadGpuConfig();
const mailer = createMailer(loadMailConfig(), { log });
const pfsense = cfg.pfsenseEnabled ? loadPfSenseConfig() : null;
const me = parsePrivateBundle(cfg.privateKey);
const peers = parsePublicBundles(cfg.peerPublicKeys);

const handlers = createJobHandlers({
  pfsenseEnabled: cfg.pfsenseEnabled,
  withPfSense: (fn) => withPfSense(pfsense, fn, { log }),
  async withGpuNode(name, fn) {
    const node = findGpuNode(gpu, name);
    const ssh = await connectGpuNode(node, { log });
    try {
      return await fn(ssh, node);
    } finally {
      ssh.close();
    }
  },
  provisionGpuUser,
  revokeGpuUser,
  sendEmails: (msg, password) => sendProvisionEmails(mailer, msg, password, { renderImage: renderPasswordImage }),
  generatePassword: () => generatePassword(cfg.passwordLength),
  gpuTimeoutMs: gpu.condaTimeoutMs,
  now: Date.now,
  log,
});

const transport = cfg.transport === 'sqs' ? SqsConnection.connect(queues, { log }) : await AmqpConnection.connect(queues, { log });
const worker = createWorker({
  transport,
  requestQueue: queues.requestQueue,
  resultQueue: queues.resultQueue,
  me,
  peers,
  maxTtlSec: cfg.maxTtlSec,
  resultTtlSec: cfg.resultTtlSec,
  store: new JobStore(cfg.jobStoreFile),
  handlers,
  maxAttempts: cfg.maxAttempts,
  log,
});
worker.start();
log('acc-prov-vm.ready', { transport: cfg.transport, kid: me.kid, pfsenseEnabled: cfg.pfsenseEnabled, gpuNodes: gpu.nodes.map((n) => n.name) });

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log('acc-prov-vm.stopping', { signal: sig });
    worker.stop();
    transport.close();
    mailer.close();
    setTimeout(() => process.exit(0), 500);
  });
}
