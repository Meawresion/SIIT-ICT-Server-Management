// Reads acc-prov-vm settings. Nothing site-specific is hard-coded:
// - secrets and simple values come from the environment (.env on the acc-prov-vm host);
// - the GPU node list comes from a settings file (GPU_NODES_FILE, e.g. gpu-nodes.json).
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

const NODE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const FINGERPRINT_RE = /^SHA256:[A-Za-z0-9+/]{43}$/;
const COMMAND_RE = /^[A-Za-z0-9_\-./]+$/;
const REL_DIR_RE = /^(?!.*\.\.)[A-Za-z0-9_\-.]+(\/[A-Za-z0-9_\-.]+)*$/;

// Per-node secret override: GPU_SSH_PASSWORD_<NAME>, e.g. GPU_SSH_PASSWORD_GPU_48 for "gpu-48".
function nodeEnv(env, key, name) {
  return env[`${key}_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`] || env[key] || undefined;
}

// settings: the parsed GPU_NODES_FILE. Each node can override conda / kernelDir / sshUser.
export function parseGpuConfig(settings, env = process.env) {
  const fail = (msg) => { throw new Error(`GPU settings: ${msg}`); };
  if (!Array.isArray(settings?.nodes) || settings.nodes.length === 0) fail('"nodes" must be a non-empty array');

  const seen = new Set();
  const nodes = settings.nodes.map((n, i) => {
    const where = `nodes[${i}]`;
    if (!NODE_NAME_RE.test(n.name ?? '')) fail(`${where}.name must match ${NODE_NAME_RE}`);
    if (seen.has(n.name)) fail(`duplicate node name ${n.name}`);
    seen.add(n.name);
    // Clones share hostnames (D17), so nodes are identified by IP.
    if (!IPV4_RE.test(n.host ?? '')) fail(`${where}.host must be an IPv4 address`);
    const port = n.port ?? 22;
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`${where}.port is invalid`);
    if (!Array.isArray(n.hostKeys) || !n.hostKeys.length || !n.hostKeys.every((k) => FINGERPRINT_RE.test(k))) {
      fail(`${where}.hostKeys must be a non-empty list of SHA256:... fingerprints`);
    }
    if (n.jupyterUrl !== undefined && !/^https?:\/\//.test(n.jupyterUrl)) fail(`${where}.jupyterUrl must be http(s)`);
    const conda = n.conda ?? settings.conda;
    if (!COMMAND_RE.test(conda ?? '')) fail(`${where}: "conda" (node or top level) must be a command or path`);
    const kernelDir = n.kernelDir ?? settings.kernelDir;
    if (!REL_DIR_RE.test(kernelDir ?? '')) fail(`${where}: "kernelDir" (node or top level) must be a path relative to home`);

    const ssh = {
      username: n.sshUser ?? nodeEnv(env, 'GPU_SSH_USER', n.name),
      password: nodeEnv(env, 'GPU_SSH_PASSWORD', n.name),
      privateKeyPath: nodeEnv(env, 'GPU_SSH_KEY_PATH', n.name),
    };
    ssh.sudoPassword = nodeEnv(env, 'GPU_SUDO_PASSWORD', n.name) ?? ssh.password;
    if (!ssh.username) fail(`${where}: no SSH user (sshUser or GPU_SSH_USER)`);
    if (!ssh.password && !ssh.privateKeyPath) fail(`${where}: no GPU_SSH_PASSWORD or GPU_SSH_KEY_PATH`);

    return { name: n.name, host: n.host, port, hostKeys: [...n.hostKeys], jupyterUrl: n.jupyterUrl, conda, kernelDir, ssh };
  });

  const condaTimeoutMs = settings.condaTimeoutMs;
  if (!Number.isInteger(condaTimeoutMs) || condaTimeoutMs <= 0) fail('"condaTimeoutMs" must be a positive integer');
  return { nodes, condaTimeoutMs };
}

export function loadGpuConfig(env = process.env) {
  requireEnv(env, ['GPU_NODES_FILE']);
  const file = resolve(env.GPU_NODES_FILE);
  let settings;
  try {
    settings = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`cannot read GPU_NODES_FILE ${file}: ${err.message}`);
  }
  return parseGpuConfig(settings, env);
}
