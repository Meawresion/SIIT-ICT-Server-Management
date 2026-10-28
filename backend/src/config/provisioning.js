// Settings for automatic provisioning through acc-prov-vm (plan §2, step 6). Every value comes
// from config. Without MESSAGE_TRANSPORT, provisioning is off and GPU requests are activated by
// hand like the other types.
//   MESSAGE_TRANSPORT      amqp (local ActiveMQ, D23) | sqs (AWS) | empty = off
//   AMQP_URL, AMQP_USER, AMQP_PASSWORD, AMQP_REQUEST_QUEUE, AMQP_RESULT_QUEUE      (amqp)
//   SQS_REQUEST_QUEUE_URL, SQS_RESULT_QUEUE_URL, AWS_REGION                         (sqs)
//   MSG_PRIVATE_KEY        this backend's key bundle (D22); MSG_PEER_PUBLIC_KEYS: acc-prov-vm's,
//                          comma-separated during a rotation, the first one is used for sending
//   MSG_JOB_TTL_SEC        how long a job stays valid, so it survives the site being offline
//   MSG_MAX_TTL_SEC        the longest lifetime accepted on a result
//   GPU_NODES              comma-separated node names, as in acc-prov-vm's gpu-nodes.json; a tie
//                          in load goes to the first (D12)
//   OVPN_PROFILE_URL, MANUAL_GPU_URL   links put in the student's email (D14)

import { EnvelopeError, parsePrivateBundle, parsePublicBundles } from '../messaging/envelope.js';

const NODE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const QUEUE_NAME_RE = /^[A-Za-z0-9._-]+$/;

const httpUrl = (value) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

// -> null (off) or the settings. Throws one error that lists every problem.
export function loadProvisioningConfig(source = process.env) {
  const transport = String(source.MESSAGE_TRANSPORT ?? '').trim();
  if (!transport) return null;
  const problems = [];
  const need = (keys) => keys.filter((k) => !source[k]).forEach((k) => problems.push(`${k} is required`));

  let amqp, sqs;
  if (transport === 'amqp') {
    need(['AMQP_URL', 'AMQP_USER', 'AMQP_PASSWORD', 'AMQP_REQUEST_QUEUE', 'AMQP_RESULT_QUEUE']);
    if (source.AMQP_URL && !/^amqps?:\/\//.test(source.AMQP_URL)) problems.push('AMQP_URL must be amqp:// or amqps://');
    for (const k of ['AMQP_REQUEST_QUEUE', 'AMQP_RESULT_QUEUE']) {
      if (source[k] && !QUEUE_NAME_RE.test(source[k])) problems.push(`${k} must be a plain queue name`);
    }
    amqp = { url: source.AMQP_URL, username: source.AMQP_USER, password: source.AMQP_PASSWORD,
      requestQueue: source.AMQP_REQUEST_QUEUE, resultQueue: source.AMQP_RESULT_QUEUE };
  } else if (transport === 'sqs') {
    need(['SQS_REQUEST_QUEUE_URL', 'SQS_RESULT_QUEUE_URL', 'AWS_REGION']);
    for (const k of ['SQS_REQUEST_QUEUE_URL', 'SQS_RESULT_QUEUE_URL']) {
      if (source[k] && !/^https:\/\/sqs\./.test(source[k])) problems.push(`${k} must be an SQS queue URL`);
    }
    sqs = { region: source.AWS_REGION, requestQueueUrl: source.SQS_REQUEST_QUEUE_URL, resultQueueUrl: source.SQS_RESULT_QUEUE_URL };
  } else {
    problems.push('MESSAGE_TRANSPORT must be amqp, sqs or empty');
  }

  need(['MSG_PRIVATE_KEY', 'MSG_PEER_PUBLIC_KEYS', 'MSG_JOB_TTL_SEC', 'MSG_MAX_TTL_SEC', 'GPU_NODES', 'OVPN_PROFILE_URL', 'MANUAL_GPU_URL']);
  let me, peers;
  try {
    if (source.MSG_PRIVATE_KEY) me = parsePrivateBundle(source.MSG_PRIVATE_KEY);
  } catch (err) {
    if (!(err instanceof EnvelopeError)) throw err;
    problems.push(`MSG_PRIVATE_KEY: ${err.message}`);
  }
  try {
    if (source.MSG_PEER_PUBLIC_KEYS) peers = parsePublicBundles(source.MSG_PEER_PUBLIC_KEYS);
  } catch (err) {
    if (!(err instanceof EnvelopeError)) throw err;
    problems.push(`MSG_PEER_PUBLIC_KEYS: ${err.message}`);
  }
  const seconds = (k) => {
    const n = Number(source[k]);
    if (source[k] && (!Number.isInteger(n) || n < 60)) problems.push(`${k} must be a whole number of seconds, at least 60`);
    return n;
  };
  const jobTtlSec = seconds('MSG_JOB_TTL_SEC');
  const maxTtlSec = seconds('MSG_MAX_TTL_SEC');

  const gpuNodes = String(source.GPU_NODES ?? '').split(',').map((n) => n.trim()).filter(Boolean);
  if (source.GPU_NODES && (!gpuNodes.length || gpuNodes.some((n) => !NODE_NAME_RE.test(n)))) {
    problems.push('GPU_NODES must list node names (lowercase letters, digits, -), comma-separated');
  } else if (new Set(gpuNodes).size !== gpuNodes.length) {
    problems.push('GPU_NODES lists a node twice');
  }
  for (const k of ['OVPN_PROFILE_URL', 'MANUAL_GPU_URL']) {
    if (source[k] && !httpUrl(source[k])) problems.push(`${k} must be an http(s) URL`);
  }

  if (problems.length) throw new Error(`Provisioning settings: ${problems.join('; ')}`);
  return {
    transport, amqp, sqs, me, peers, jobTtlSec, maxTtlSec, gpuNodes,
    links: { ovpnProfileUrl: source.OVPN_PROFILE_URL, manualGpuUrl: source.MANUAL_GPU_URL },
  };
}

let cached;
// The settings the running server uses (loaded once; server.js loads them at start so a mistake
// stops the server).
export function provisioningConfig() {
  if (cached === undefined) cached = loadProvisioningConfig();
  return cached;
}
