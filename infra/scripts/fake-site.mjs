// Smoke tests only: plays acc-prov-vm against the real SQS queues. It opens each job with a
// throwaway site key, checks it, and answers success without touching any real system. It stops
// after <count> jobs or the timeout.
//   node infra/scripts/fake-site.mjs <count> <timeout seconds>
// Env: SITE_PRIVATE_KEY (throwaway bundle), BACKEND_PUBLIC_KEY, REQUEST_QUEUE_URL,
// RESULT_QUEUE_URL, AWS_REGION; AWS credentials as for the CLI (AWS_PROFILE).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const backend = new URL('../../backend/', import.meta.url);
const require = createRequire(fileURLToPath(new URL('package.json', backend)));
const { SQSClient } = require('@aws-sdk/client-sqs');
const { open, parsePrivateBundle, parsePublicBundles, seal } = await import(new URL('src/messaging/envelope.js', backend));
const { createSqsTransport } = await import(new URL('src/messaging/sqs.js', backend));

const [count = '1', timeout = '600'] = process.argv.slice(2);
const me = parsePrivateBundle(process.env.SITE_PRIVATE_KEY);
const peers = parsePublicBundles(process.env.BACKEND_PUBLIC_KEY);
const log = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }));
// The site's view: it receives on the request queue and sends on the result queue.
const transport = createSqsTransport(
  { requestQueueUrl: process.env.RESULT_QUEUE_URL, resultQueueUrl: process.env.REQUEST_QUEUE_URL },
  { client: new SQSClient({ region: process.env.AWS_REGION }), log },
);

let handled = 0;
let done;
const finished = new Promise((r) => { done = r; });
const consumer = transport.consume(async (text) => {
  const job = open(text, { me, peers, expectedTyp: 'job', maxTtlSec: 259200 });
  const p = job.payload;
  if (!/^st[md]?\d+$/.test(p.student?.username ?? '') || !p.gpuNode) throw new Error('unexpected job payload');
  const result = p.action === 'CREATE'
    ? { ok: true, action: 'CREATE', resource: p.resource, username: p.student.username, gpuNode: p.gpuNode, vpn: 'created', linuxCreated: true, emailed: true }
    : { ok: true, action: 'REVOKE', resource: p.resource, username: p.student.username, gpuNode: p.gpuNode, gpu: 'locked', vpn: p.revokeVpn ? 'disabled' : 'kept' };
  await transport.send(seal({ typ: 'result', jti: job.jti, rid: job.rid, payload: result, ttlSec: 3600 }, { me, peer: peers[0] }));
  log('site.handled', { action: p.action, rid: job.rid, username: p.student.username, gpu_node: p.gpuNode });
  if (++handled >= Number(count)) done();
});
const timer = setTimeout(() => { log('site.timeout', { handled }); done(); }, Number(timeout) * 1000);
await finished;
clearTimeout(timer);
await consumer.stop();
transport.close();
process.exit(handled >= Number(count) ? 0 : 1);
