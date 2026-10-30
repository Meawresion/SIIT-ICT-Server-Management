// Job handlers: what CREATE, REVOKE and EXTEND do for a GPU or Big Data request (runbooks in
// plan.md §6b).
//
// Job payload (from the backend, inside the envelope; never contains passwords):
//   { action: 'CREATE' | 'REVOKE' | 'EXTEND', resource: 'GPU_SERVER' | 'BIG_DATA',
//     student: { username, fullName, email },
//     gpuNode: '<node name from gpu-nodes.json>',      GPU_SERVER only
//     period: { start, end },                          CREATE and EXTEND (the new end date)
//     links: { ovpnProfileUrl, manualUrl },            CREATE only
//     revokeVpn: boolean }                             REVOKE only (no other active request)
//
// GPU_SERVER: a Linux account and conda kernel on the named node. BIG_DATA: a Linux account on
// every Hadoop node of BIGDATA_FILE, the HDFS home, and (HUE_ENABLED) a HUE account. The site,
// not the job, decides which hosts are touched.
//
// CREATE is safe to retry: every attempt generates a fresh password, sets it on every account it
// manages in this job, and emails it last. Whether this job made the VPN account new is kept in
// the job's progress, so a retry resets the VPN password too instead of treating it as existing.

import { JobRejectedError } from './errors.js';
import { assertRecipient } from './mail.js';
import { PfSenseIdentityError } from './pfsense.js';
import { LinuxIdentityError, LinuxUserNotFoundError } from './linux.js';
import { assertIsoDate, assertNonEmpty, assertUsername } from './validate.js';

const RESOURCES = ['GPU_SERVER', 'BIG_DATA'];

function reject(msg) {
  throw new JobRejectedError(msg);
}

function check(fn) {
  try {
    fn();
  } catch (err) {
    reject(err.message);
  }
}

export function parseJobPayload(p) {
  if (!p || typeof p !== 'object') reject('payload must be an object');
  if (!['CREATE', 'REVOKE', 'EXTEND'].includes(p.action)) reject(`unsupported action ${p.action}`);
  if (!RESOURCES.includes(p.resource)) reject(`unsupported resource ${p.resource}`);
  const s = p.student ?? {};
  check(() => assertUsername(s.username));
  check(() => assertNonEmpty('student.fullName', s.fullName));
  if (p.resource === 'GPU_SERVER') check(() => assertNonEmpty('gpuNode', p.gpuNode));
  if (p.action === 'CREATE') {
    check(() => assertRecipient(s.email));
    check(() => assertIsoDate(p.period?.start));
    check(() => assertIsoDate(p.period?.end));
    if (p.period.end < p.period.start) reject('period.end is before period.start');
    for (const k of ['ovpnProfileUrl', 'manualUrl']) {
      if (!/^https?:\/\/\S+$/.test(p.links?.[k] ?? '')) reject(`links.${k} must be an http(s) URL`);
    }
  } else if (p.action === 'EXTEND') {
    check(() => assertIsoDate(p.period?.start));
    check(() => assertIsoDate(p.period?.end));
    if (p.period.end < p.period.start) reject('period.end is before period.start');
  } else if (typeof p.revokeVpn !== 'boolean') {
    reject('revokeVpn must be true or false');
  }
  return p;
}

const today = (now) => new Date(now()).toISOString().slice(0, 10);

// D15. -> { vpn: 'created' | 'reactivated' | 'kept' | 'skipped', vpnIsNew }
async function ensureVpn(pf, { username, fullName, password, end, now, forceNew }) {
  const state = await pf.getUserState(username);
  if (!state.exists) {
    await pf.createUser({ username, password, fullName, expires: end });
    return { vpn: 'created', vpnIsNew: true };
  }
  const active = !state.disabled && (state.expires === null || state.expires >= today(now));
  if (active && !forceNew) {
    // Keep the student's current VPN password; only extend a set expiration if this request ends later.
    if (state.expires !== null && state.expires < end) await pf.setExpiration({ username, expires: end });
    return { vpn: 'kept', vpnIsNew: false };
  }
  // Missing-then-created by an earlier attempt of this job (forceNew), expired or disabled:
  // the new password covers the VPN too.
  await pf.setPassword({ username, fullName, password });
  await pf.enableUser(username);
  await pf.setExpiration({ username, expires: end });
  return { vpn: 'reactivated', vpnIsNew: true };
}

// A Linux account that belongs to someone else is never changed, and retrying won't help.
async function linuxStep(username, node, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof LinuxIdentityError) reject(`Linux account ${username} on ${node} belongs to a different full name`);
    throw err;
  }
}

// deps: {
//   pfsenseEnabled, withPfSense(fn),
//   withGpuNode(name, fn(ssh, node)), provisionGpuUser, revokeGpuUser, gpuTimeoutMs,
//   bigData (loadBigDataConfig() result, or null), withHadoopNode(node, fn(ssh)), provisionHadoopUser,
//   revokeHadoopUser, hueEnabled, withHue(fn),
//   sendEmails(msg, password), generatePassword(), now(), log
// }
export function createJobHandlers(deps) {
  const { log = () => {} } = deps;

  function bigData() {
    if (!deps.bigData) reject('Big Data is not configured on this site (BIGDATA_FILE)');
    return deps.bigData;
  }

  // -> { mail: service for the email, result: fields for the result message }
  async function setUpGpu(p, user) {
    const gpu = await deps.withGpuNode(p.gpuNode, async (ssh, node) => {
      if (!node.jupyterUrl) reject(`GPU node ${node.name} has no jupyterUrl configured`);
      const r = await linuxStep(user.username, node.name,
        () => deps.provisionGpuUser(ssh, node, user, { timeoutMs: deps.gpuTimeoutMs }));
      return { created: r.created, node };
    });
    log('job.gpu', { user: user.username, node: gpu.node.name, created: gpu.created });
    return {
      mail: { name: `GPU server ${gpu.node.name}`, links: [{ label: 'JupyterHub', url: gpu.node.jupyterUrl }] },
      result: { gpuNode: gpu.node.name, linuxCreated: gpu.created },
    };
  }

  async function setUpBigData(p, user) {
    const bd = bigData();
    const hadoop = {};
    let hdfsHome;
    for (const node of bd.nodes) {
      const r = await linuxStep(user.username, node.name,
        () => deps.withHadoopNode(node, (ssh) => deps.provisionHadoopUser(ssh, node, bd, user)));
      hadoop[node.name] = r.created ? 'created' : 'updated';
      if (r.hdfsHome) hdfsHome = r.hdfsHome;
    }
    log('job.hadoop', { user: user.username, hadoop, hdfsHome });

    let hue = 'skipped';
    if (deps.hueEnabled) {
      hue = await deps.withHue(async (h) => {
        if (!(await h.getUserState(user.username)).exists) {
          await h.createUser(user);
          return 'created';
        }
        await h.resetUser(user);
        return 'reset';
      });
    }
    log('job.hue', { user: user.username, hue });

    const links = [{ label: 'JupyterHub', url: bd.jupyterUrl }];
    if (hue !== 'skipped') links.push({ label: 'HUE', url: bd.hueUrl });
    return {
      mail: {
        name: 'Big Data platform',
        links,
        notes: hue === 'skipped' ? ['Your HUE login is not ready yet. SIIT ICT will tell you when it is.'] : [],
      },
      result: { hadoop, hdfsHome, hue },
    };
  }

  async function create(p, { progress, saveProgress }) {
    const { username, fullName, email } = p.student;
    const password = deps.generatePassword();
    if (p.resource === 'BIG_DATA') bigData(); // refuse before touching anything

    let vpn = { vpn: 'skipped', vpnIsNew: false };
    if (deps.pfsenseEnabled) {
      try {
        vpn = await deps.withPfSense((pf) => ensureVpn(pf, {
          username, fullName, password, end: p.period.end, now: deps.now, forceNew: progress.vpnIsNew === true,
        }));
      } catch (err) {
        if (err instanceof PfSenseIdentityError) reject(`VPN account ${username} belongs to a different full name`);
        throw err;
      }
      if (vpn.vpnIsNew) saveProgress({ ...progress, vpnIsNew: true });
    }
    log('job.vpn', { user: username, vpn: vpn.vpn });

    const user = { username, fullName, password };
    const service = p.resource === 'GPU_SERVER' ? await setUpGpu(p, user) : await setUpBigData(p, user);

    await deps.sendEmails({
      to: email,
      fullName,
      username,
      vpnIsNew: vpn.vpnIsNew,
      service: { ...service.mail, manualUrl: p.links.manualUrl },
      ovpnProfileUrl: p.links.ovpnProfileUrl,
      period: p.period,
    }, password);
    log('job.emailed', { user: username });

    return { ok: true, action: 'CREATE', resource: p.resource, username, ...service.result, vpn: vpn.vpn, emailed: true };
  }

  // 'locked' | 'already-locked' | 'missing'
  async function lockLinux(lock) {
    try {
      return (await lock()).changed ? 'locked' : 'already-locked';
    } catch (err) {
      if (err instanceof LinuxUserNotFoundError) return 'missing';
      throw err;
    }
  }

  async function revoke(p) {
    const { username } = p.student;
    let service;
    if (p.resource === 'GPU_SERVER') {
      const gpu = await deps.withGpuNode(p.gpuNode, (ssh) => lockLinux(() => deps.revokeGpuUser(ssh, username)));
      service = { gpuNode: p.gpuNode, gpu };
    } else {
      const bd = bigData();
      const hadoop = {};
      for (const node of bd.nodes) {
        hadoop[node.name] = await deps.withHadoopNode(node, (ssh) => lockLinux(() => deps.revokeHadoopUser(ssh, username)));
      }
      let hue = 'skipped';
      if (deps.hueEnabled) {
        hue = await deps.withHue(async (h) => {
          if (!(await h.getUserState(username)).exists) return 'missing';
          return (await h.deactivateUser(username)).changed ? 'deactivated' : 'already-inactive';
        });
      }
      service = { hadoop, hue };
    }

    let vpn = 'kept';
    if (p.revokeVpn) {
      vpn = deps.pfsenseEnabled
        ? await deps.withPfSense(async (pf) => {
          if (!(await pf.getUserState(username)).exists) return 'missing';
          return (await pf.disableUser(username)).changed ? 'disabled' : 'already-disabled';
        })
        : 'skipped';
    }
    log('job.revoked', { user: username, ...service, vpn });
    return { ok: true, action: 'REVOKE', resource: p.resource, username, ...service, vpn };
  }

  // FR-8.3: a later end date. The VPN account's expiration moves to it, never earlier (the account
  // is shared by the student's requests). Linux and HUE accounts carry no expiration (REVOKE
  // locks them at the end), so nothing changes on the GPU or Hadoop nodes. A missing or disabled
  // VPN account is reported, not created or enabled: that is CREATE's job.
  async function extend(p) {
    const { username, fullName } = p.student;
    let vpn = 'skipped';
    if (deps.pfsenseEnabled) {
      try {
        vpn = await deps.withPfSense(async (pf) => {
          const state = await pf.getUserState(username);
          if (!state.exists) return 'missing';
          if (state.disabled) return 'disabled';
          if (state.expires === null || state.expires >= p.period.end) return 'kept';
          await pf.setExpiration({ username, expires: p.period.end, fullName });
          return 'extended';
        });
      } catch (err) {
        if (err instanceof PfSenseIdentityError) reject(`VPN account ${username} belongs to a different full name`);
        throw err;
      }
    }
    log('job.extended', { user: username, vpn, end: p.period.end });
    return {
      ok: true, action: 'EXTEND', resource: p.resource, username,
      ...(p.resource === 'GPU_SERVER' && { gpuNode: p.gpuNode }), vpn,
    };
  }

  return {
    run(payload, ctx) {
      return { CREATE: create, REVOKE: revoke, EXTEND: extend }[payload.action](payload, ctx);
    },
  };
}
