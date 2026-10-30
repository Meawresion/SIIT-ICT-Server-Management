// Reads acc-prov-vm settings. Nothing site-specific is hard-coded:
// - secrets and simple values come from the environment (.env on the acc-prov-vm host);
// - the GPU node list comes from a settings file (GPU_NODES_FILE, e.g. gpu-nodes.json), the
//   Hadoop nodes from another (BIGDATA_FILE, e.g. bigdata.json).
// Credentials only ever come from here; they are never part of a job message.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function requireEnv(env, keys) {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) throw new Error(`missing environment variables: ${missing.join(', ')}`);
}

export function loadPfSenseConfig(env = process.env) {
  requireEnv(env, [
    'PFSENSE_URL', 'PFSENSE_USER', 'PFSENSE_PASSWORD', 'PFSENSE_CA_NAME',
    'PFSENSE_CERT_KEY_TYPE', 'PFSENSE_CERT_KEY_LENGTH', 'PFSENSE_CERT_DIGEST', 'PFSENSE_CERT_LIFETIME_DAYS',
  ]);
  if (new URL(env.PFSENSE_URL).protocol !== 'https:') throw new Error('PFSENSE_URL must use https');
  if (!/^\d+$/.test(env.PFSENSE_CERT_LIFETIME_DAYS)) throw new Error('PFSENSE_CERT_LIFETIME_DAYS must be a number');

  return {
    baseUrl: env.PFSENSE_URL.replace(/\/+$/, ''),
    username: env.PFSENSE_USER,
    password: env.PFSENSE_PASSWORD,
    caName: env.PFSENSE_CA_NAME,
    cert: {
      keytype: env.PFSENSE_CERT_KEY_TYPE,
      keylen: env.PFSENSE_CERT_KEY_LENGTH,
      digest: env.PFSENSE_CERT_DIGEST,
      lifetimeDays: env.PFSENSE_CERT_LIFETIME_DAYS,
    },
    headless: env.HEADLESS !== 'false',
  };
}

// Temporary sender (D9): Gmail SMTP with an App Password. Swappable for an SIIT relay or SES.
export function loadMailConfig(env = process.env) {
  requireEnv(env, ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_APP_PASSWORD', 'MAIL_FROM']);
  const port = Number(env.SMTP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP_PORT is invalid');
  if (!['true', 'false'].includes(env.SMTP_SECURE)) throw new Error('SMTP_SECURE must be true or false');
  const domains = (env.MAIL_ALLOWED_RECIPIENT_DOMAINS ?? '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  return {
    smtp: {
      host: env.SMTP_HOST,
      port,
      secure: env.SMTP_SECURE === 'true',
      // STARTTLS is required when the connection doesn't start with TLS.
      requireTLS: env.SMTP_SECURE !== 'true',
      auth: { user: env.SMTP_USER, pass: env.SMTP_APP_PASSWORD },
    },
    from: env.MAIL_FROM,
    replyTo: env.MAIL_REPLY_TO || undefined,
    allowedRecipientDomains: domains,
  };
}

// Worker behaviour and message keys (D22).
export function loadWorkerConfig(env = process.env) {
  requireEnv(env, [
    'MESSAGE_TRANSPORT', 'MSG_PRIVATE_KEY', 'MSG_PEER_PUBLIC_KEYS', 'MSG_MAX_TTL_SEC', 'MSG_RESULT_TTL_SEC',
    'WORKER_MAX_ATTEMPTS', 'JOB_STORE_FILE', 'PASSWORD_LENGTH', 'PFSENSE_ENABLED',
  ]);
  if (!['amqp', 'sqs'].includes(env.MESSAGE_TRANSPORT)) throw new Error('MESSAGE_TRANSPORT must be amqp or sqs');
  const int = (k, min) => {
    const n = Number(env[k]);
    if (!Number.isInteger(n) || n < min) throw new Error(`${k} must be an integer >= ${min}`);
    return n;
  };
  if (!['true', 'false'].includes(env.PFSENSE_ENABLED)) throw new Error('PFSENSE_ENABLED must be true or false');
  // Optional: HUE accounts for Big Data requests, off when unset.
  if (env.HUE_ENABLED !== undefined && !['true', 'false'].includes(env.HUE_ENABLED)) throw new Error('HUE_ENABLED must be true or false');
  return {
    transport: env.MESSAGE_TRANSPORT,
    privateKey: env.MSG_PRIVATE_KEY,
    peerPublicKeys: env.MSG_PEER_PUBLIC_KEYS,
    maxTtlSec: int('MSG_MAX_TTL_SEC', 60),
    resultTtlSec: int('MSG_RESULT_TTL_SEC', 60),
    maxAttempts: int('WORKER_MAX_ATTEMPTS', 1),
    jobStoreFile: env.JOB_STORE_FILE,
    passwordLength: int('PASSWORD_LENGTH', 14),
    pfsenseEnabled: env.PFSENSE_ENABLED === 'true',
    hueEnabled: env.HUE_ENABLED === 'true',
  };
}

// Local broker (D23): ActiveMQ Artemis over AMQP 1.0.
export function loadAmqpConfig(env = process.env) {
  requireEnv(env, ['AMQP_URL', 'AMQP_USER', 'AMQP_PASSWORD', 'AMQP_REQUEST_QUEUE', 'AMQP_RESULT_QUEUE']);
  if (!['amqp:', 'amqps:'].includes(new URL(env.AMQP_URL).protocol)) throw new Error('AMQP_URL must be amqp:// or amqps://');
  for (const k of ['AMQP_REQUEST_QUEUE', 'AMQP_RESULT_QUEUE']) {
    if (!/^[A-Za-z0-9._-]+$/.test(env[k])) throw new Error(`${k} must be a plain queue name`);
  }
  return {
    url: env.AMQP_URL,
    username: env.AMQP_USER,
    password: env.AMQP_PASSWORD,
    requestQueue: env.AMQP_REQUEST_QUEUE,
    resultQueue: env.AMQP_RESULT_QUEUE,
  };
}

// AWS (plan §10.1): the queue URLs from the queues stack. Credentials come from the usual AWS
// variables (Learner Lab: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN) or a profile.
export function loadSqsConfig(env = process.env) {
  requireEnv(env, ['AWS_REGION', 'SQS_REQUEST_QUEUE_URL', 'SQS_RESULT_QUEUE_URL']);
  for (const k of ['SQS_REQUEST_QUEUE_URL', 'SQS_RESULT_QUEUE_URL']) {
    if (!/^https:\/\/sqs\.[a-z0-9-]+\.amazonaws\.com\/\d{12}\/[A-Za-z0-9_-]+$/.test(env[k])) throw new Error(`${k} must be an SQS queue URL`);
  }
  return { region: env.AWS_REGION, requestQueue: env.SQS_REQUEST_QUEUE_URL, resultQueue: env.SQS_RESULT_QUEUE_URL };
}

const NODE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const FINGERPRINT_RE = /^SHA256:[A-Za-z0-9+/]{43}$/;
const COMMAND_RE = /^[A-Za-z0-9_\-./]+$/;
const REL_DIR_RE = /^(?!.*\.\.)[A-Za-z0-9_\-.]+(\/[A-Za-z0-9_\-.]+)*$/;
const ABS_DIR_RE = /^(\/[A-Za-z0-9_\-.]+)+$/;
const GROUP_RE = /^[a-z_][a-z0-9_-]{0,31}$/;

// Per-node secret override: GPU_SSH_PASSWORD_<NAME>, e.g. GPU_SSH_PASSWORD_GPU_48 for "gpu-48".
// With several prefixes, the first one that has a value wins (HADOOP_SSH_USER, then GPU_SSH_USER).
function nodeEnv(env, key, name, prefixes = ['GPU']) {
  for (const p of prefixes) {
    const k = `${p}_${key}`;
    const v = env[`${k}_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`] || env[k];
    if (v) return v;
  }
  return undefined;
}

// One SSH host of a settings file: name, IPv4 host, port, pinned keys, credentials from env.
function parseSshNode(n, where, env, prefixes, fail) {
  if (!NODE_NAME_RE.test(n.name ?? '')) fail(`${where}.name must match ${NODE_NAME_RE}`);
  // Clones share hostnames and host keys (D17), so nodes are identified by IP.
  if (!IPV4_RE.test(n.host ?? '')) fail(`${where}.host must be an IPv4 address`);
  const port = n.port ?? 22;
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`${where}.port is invalid`);
  if (!Array.isArray(n.hostKeys) || !n.hostKeys.length || !n.hostKeys.every((k) => FINGERPRINT_RE.test(k))) {
    fail(`${where}.hostKeys must be a non-empty list of SHA256:... fingerprints`);
  }
  const ssh = {
    username: n.sshUser ?? nodeEnv(env, 'SSH_USER', n.name, prefixes),
    password: nodeEnv(env, 'SSH_PASSWORD', n.name, prefixes),
    privateKeyPath: nodeEnv(env, 'SSH_KEY_PATH', n.name, prefixes),
  };
  ssh.sudoPassword = nodeEnv(env, 'SUDO_PASSWORD', n.name, prefixes) ?? ssh.password;
  const p = prefixes[0];
  if (!ssh.username) fail(`${where}: no SSH user (sshUser or ${p}_SSH_USER)`);
  if (!ssh.password && !ssh.privateKeyPath) fail(`${where}: no ${p}_SSH_PASSWORD or ${p}_SSH_KEY_PATH`);
  return { name: n.name, host: n.host, port, hostKeys: [...n.hostKeys], ssh };
}

function assertUniqueNames(nodes, fail) {
  const seen = new Set();
  for (const { name } of nodes) {
    if (seen.has(name)) fail(`duplicate node name ${name}`);
    seen.add(name);
  }
}

function readSettings(env, key) {
  const file = resolve(env[key]);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`cannot read ${key} ${file}: ${err.message}`);
  }
}

// settings: the parsed GPU_NODES_FILE. Each node can override conda / kernelDir / sshUser.
export function parseGpuConfig(settings, env = process.env) {
  const fail = (msg) => { throw new Error(`GPU settings: ${msg}`); };
  if (!Array.isArray(settings?.nodes) || settings.nodes.length === 0) fail('"nodes" must be a non-empty array');

  const nodes = settings.nodes.map((n, i) => {
    const where = `nodes[${i}]`;
    const { ssh, ...node } = parseSshNode(n, where, env, ['GPU'], fail);
    if (n.jupyterUrl !== undefined && !/^https?:\/\//.test(n.jupyterUrl)) fail(`${where}.jupyterUrl must be http(s)`);
    const conda = n.conda ?? settings.conda;
    if (!COMMAND_RE.test(conda ?? '')) fail(`${where}: "conda" (node or top level) must be a command or path`);
    const kernelDir = n.kernelDir ?? settings.kernelDir;
    if (!REL_DIR_RE.test(kernelDir ?? '')) fail(`${where}: "kernelDir" (node or top level) must be a path relative to home`);
    return { ...node, jupyterUrl: n.jupyterUrl, conda, kernelDir, ssh };
  });
  assertUniqueNames(nodes, fail);

  const condaTimeoutMs = settings.condaTimeoutMs;
  if (!Number.isInteger(condaTimeoutMs) || condaTimeoutMs <= 0) fail('"condaTimeoutMs" must be a positive integer');
  return { nodes, condaTimeoutMs };
}

export function loadGpuConfig(env = process.env) {
  requireEnv(env, ['GPU_NODES_FILE']);
  return parseGpuConfig(readSettings(env, 'GPU_NODES_FILE'), env);
}

// settings: the parsed BIGDATA_FILE (Step B2 of the technician manual). Every node gets the
// student's Linux account and groups; the one node with "hdfsHome": true also makes the HDFS home
// (HDFS is one file system for the whole cluster). SSH credentials: HADOOP_SSH_USER,
// HADOOP_SSH_PASSWORD, HADOOP_SSH_KEY_PATH, HADOOP_SUDO_PASSWORD, with per-node overrides as for
// the GPU nodes; any of them not set falls back to the GPU_* value (D18: one admin account).
export function parseBigDataConfig(settings, env = process.env) {
  const fail = (msg) => { throw new Error(`Big Data settings: ${msg}`); };
  if (!Array.isArray(settings?.nodes) || settings.nodes.length === 0) fail('"nodes" must be a non-empty array');
  const nodes = settings.nodes.map((n, i) => {
    const where = `nodes[${i}]`;
    if (n.hdfsHome !== undefined && typeof n.hdfsHome !== 'boolean') fail(`${where}.hdfsHome must be true or false`);
    return { ...parseSshNode(n, where, env, ['HADOOP', 'GPU'], fail), hdfsHome: n.hdfsHome === true };
  });
  assertUniqueNames(nodes, fail);
  if (nodes.filter((n) => n.hdfsHome).length !== 1) fail('exactly one node must have "hdfsHome": true');

  const { groups, hdfs = {}, jupyterUrl, hueUrl } = settings;
  if (!Array.isArray(groups) || !groups.every((g) => GROUP_RE.test(g))) fail('"groups" must be a list of group names');
  if (!COMMAND_RE.test(hdfs.command ?? '')) fail('"hdfs.command" must be a command or path');
  if (!GROUP_RE.test(hdfs.superuser ?? '')) fail('"hdfs.superuser" must be a user name');
  if (!ABS_DIR_RE.test(hdfs.homeDir ?? '') || hdfs.homeDir.includes('..')) fail('"hdfs.homeDir" must be an absolute path');
  if (!GROUP_RE.test(hdfs.group ?? '')) fail('"hdfs.group" must be a group name');
  if (!/^[0-7]{3,4}$/.test(hdfs.mode ?? '')) fail('"hdfs.mode" must be an octal mode such as 755');
  if (typeof hdfs.studentOwnsHome !== 'boolean') fail('"hdfs.studentOwnsHome" must be true or false');
  if (!Number.isInteger(hdfs.timeoutMs) || hdfs.timeoutMs <= 0) fail('"hdfs.timeoutMs" must be a positive integer');
  for (const [k, v] of Object.entries({ jupyterUrl, hueUrl })) {
    if (!/^https?:\/\/\S+$/.test(v ?? '')) fail(`"${k}" must be an http(s) URL`);
  }

  return {
    nodes,
    groups: [...groups],
    hdfs: {
      command: hdfs.command, superuser: hdfs.superuser, homeDir: hdfs.homeDir, group: hdfs.group,
      mode: hdfs.mode, studentOwnsHome: hdfs.studentOwnsHome, timeoutMs: hdfs.timeoutMs,
    },
    jupyterUrl,
    hueUrl,
  };
}

// -> null when this site has no Big Data cluster (BIGDATA_FILE not set): Big Data jobs are refused.
export function loadBigDataConfig(env = process.env) {
  if (!env.BIGDATA_FILE) return null;
  return parseBigDataConfig(readSettings(env, 'BIGDATA_FILE'), env);
}

// HUE webGUI (Administer Users), used when HUE_ENABLED=true. HUE runs on the internal LAN over
// http, so http is accepted.
export function loadHueConfig(env = process.env) {
  requireEnv(env, ['HUE_URL', 'HUE_USER', 'HUE_PASSWORD']);
  if (!['http:', 'https:'].includes(new URL(env.HUE_URL).protocol)) throw new Error('HUE_URL must be http(s)');
  return {
    baseUrl: env.HUE_URL.replace(/\/+$/, ''),
    username: env.HUE_USER,
    password: env.HUE_PASSWORD,
    headless: env.HEADLESS !== 'false',
  };
}
