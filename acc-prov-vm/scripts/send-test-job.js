// LOCAL TESTING ONLY: plays the backend. Seals one job with a test backend key, sends it to the
// request queue, then prints the decrypted result from the result queue.
//
//   npm run send-test-job -- create <gpuNode> <email> [username]
//   npm run send-test-job -- revoke <gpuNode> [username] [--revoke-vpn]
//
// Needs in .env: AMQP_*, TEST_BACKEND_PRIVATE_KEY (backend test bundle), TEST_SITE_PUBLIC_KEY (the
// public bundle of this site's MSG_PRIVATE_KEY), and for create: OVPN_PROFILE_URL, MANUAL_GPU_URL.

import { randomUUID } from 'node:crypto';
import { AmqpConnection } from '../src/amqp.js';
import { loadAmqpConfig } from '../src/config.js';
import { open, parsePrivateBundle, parsePublicBundles, seal } from '../src/envelope.js';

const [action, gpuNode, ...rest] = process.argv.slice(2);
const usage = 'usage: send-test-job create <gpuNode> <email> [username] | revoke <gpuNode> [username] [--revoke-vpn]';
if (!['create', 'revoke'].includes(action) || !gpuNode) {
  console.error(usage);
  process.exit(2);
}
for (const k of ['TEST_BACKEND_PRIVATE_KEY', 'TEST_SITE_PUBLIC_KEY']) {
  if (!process.env[k]) {
    console.error(`set ${k} in .env`);
    process.exit(2);
  }
}

const student = { fullName: 'Test User For acc-prov-vm' };
let payload;
if (action === 'create') {
  const [email, username = 'st9990000001'] = rest;
  if (!email) {
    console.error(usage);
    process.exit(2);
  }
  for (const k of ['OVPN_PROFILE_URL', 'MANUAL_GPU_URL']) {
    if (!/^https?:\/\/\S+$/.test(process.env[k] ?? '')) {
      console.error(`set ${k} in .env to an http(s) URL (uncommented); create jobs put it in the email`);
      process.exit(2);
    }
  }
  const start = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  payload = {
    action: 'CREATE',
    resource: 'GPU_SERVER',
    student: { ...student, username, email },
    gpuNode,
    period: { start, end },
    links: { ovpnProfileUrl: process.env.OVPN_PROFILE_URL, manualUrl: process.env.MANUAL_GPU_URL },
  };
} else {
  const username = rest.find((a) => !a.startsWith('--')) ?? 'st9990000001';
  payload = { action: 'REVOKE', resource: 'GPU_SERVER', student: { ...student, username }, gpuNode, revokeVpn: rest.includes('--revoke-vpn') };
}

const amqp = loadAmqpConfig();
const me = parsePrivateBundle(process.env.TEST_BACKEND_PRIVATE_KEY);
const peers = parsePublicBundles(process.env.TEST_SITE_PUBLIC_KEY);
const jti = randomUUID();
const conn = await AmqpConnection.connect(amqp);

await conn.send(amqp.requestQueue, seal({ typ: 'job', jti, rid: 1, payload, ttlSec: 3600 }, { me, peer: peers[0] }));
console.log(`sent ${payload.action} job ${jti} for ${payload.student.username} on ${gpuNode}; waiting for the result...`);

const timer = setTimeout(() => {
  console.error('no result after 30 minutes');
  process.exit(1);
}, 30 * 60_000);
const sub = conn.consume(amqp.resultQueue, async (text) => {
  const r = open(text, { me, peers, expectedTyp: 'result' });
  if (r.jti !== jti) {
    console.log(`(skipping an older result for job ${r.jti})`);
    return;
  }
  clearTimeout(timer);
  console.log(JSON.stringify(r.payload, null, 2));
  sub.stop();
  conn.close();
});
