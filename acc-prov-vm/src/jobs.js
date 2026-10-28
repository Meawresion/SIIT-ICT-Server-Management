// Job handlers: what CREATE, REVOKE and EXTEND do for a GPU request (runbooks in plan.md §6b).
//
// Job payload (from the backend, inside the envelope; never contains passwords):
//   { action: 'CREATE' | 'REVOKE' | 'EXTEND', resource: 'GPU_SERVER',
//     student: { username, fullName, email },
//     gpuNode: '<node name from gpu-nodes.json>',
//     period: { start, end },                          CREATE and EXTEND (the new end date)
//     links: { ovpnProfileUrl, manualUrl },            CREATE only
//     revokeVpn: boolean }                             REVOKE only (no other active request)
//
// CREATE is safe to retry: every attempt generates a fresh password, sets it on every account it
// manages in this job, and emails it last. Whether this job made the VPN account new is kept in
// the job's progress, so a retry resets the VPN password too instead of treating it as existing.

import { JobRejectedError } from './errors.js';
import { assertRecipient } from './mail.js';
import { PfSenseIdentityError } from './pfsense.js';
import { LinuxIdentityError, LinuxUserNotFoundError } from './linux.js';
import { assertIsoDate, assertNonEmpty, assertUsername } from './validate.js';

const RESOURCES = ['GPU_SERVER'];

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
  check(() => assertNonEmpty('gpuNode', p.gpuNode));
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

// deps: {
//   pfsenseEnabled, withPfSense(fn), withGpuNode(name, fn(ssh, node)), provisionGpuUser, revokeGpuUser,
//   sendEmails(msg, password), generatePassword(), gpuTimeoutMs, now(), log
// }
export function createJobHandlers(deps) {
  const { log = () => {} } = deps;

  async function create(p, { progress, saveProgress }) {
    const { username, fullName, email } = p.student;
    const password = deps.generatePassword();

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

    const gpu = await deps.withGpuNode(p.gpuNode, async (ssh, node) => {
      if (!node.jupyterUrl) reject(`GPU node ${node.name} has no jupyterUrl configured`);
      try {
        const r = await deps.provisionGpuUser(ssh, node, { username, fullName, password }, { timeoutMs: deps.gpuTimeoutMs });
        return { created: r.created, node };
      } catch (err) {
        if (err instanceof LinuxIdentityError) reject(`Linux account ${username} on ${node.name} belongs to a different full name`);
        throw err;
      }
    });
    log('job.gpu', { user: username, node: gpu.node.name, created: gpu.created });

    await deps.sendEmails({
      to: email,
      fullName,
      username,
      vpnIsNew: vpn.vpnIsNew,
      service: {
        name: `GPU server ${gpu.node.name}`,
        links: [{ label: 'JupyterHub', url: gpu.node.jupyterUrl }],
        manualUrl: p.links.manualUrl,
      },
      ovpnProfileUrl: p.links.ovpnProfileUrl,
      period: p.period,
    }, password);
    log('job.emailed', { user: username });

    return {
      ok: true, action: 'CREATE', resource: p.resource, username, gpuNode: gpu.node.name,
      vpn: vpn.vpn, linuxCreated: gpu.created, emailed: true,
    };
  }

  async function revoke(p) {
    const { username } = p.student;
    const gpu = await deps.withGpuNode(p.gpuNode, async (ssh) => {
      try {
        const r = await deps.revokeGpuUser(ssh, username);
        return r.changed ? 'locked' : 'already-locked';
      } catch (err) {
        if (err instanceof LinuxUserNotFoundError) return 'missing';
        throw err;
      }
    });

    let vpn = 'kept';
    if (p.revokeVpn) {
      vpn = deps.pfsenseEnabled
        ? await deps.withPfSense(async (pf) => {
          if (!(await pf.getUserState(username)).exists) return 'missing';
          return (await pf.disableUser(username)).changed ? 'disabled' : 'already-disabled';
        })
        : 'skipped';
    }
    log('job.revoked', { user: username, gpu, vpn });
    return { ok: true, action: 'REVOKE', resource: p.resource, username, gpuNode: p.gpuNode, gpu, vpn };
  }

  // FR-8.3: a later end date. The VPN account's expiration moves to it, never earlier (the account
  // is shared by the student's requests). Linux accounts carry no expiration (REVOKE locks them
  // at the end), so nothing changes on the GPU node. A missing or disabled VPN account is reported,
  // not created or enabled: that is CREATE's job.
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
    return { ok: true, action: 'EXTEND', resource: p.resource, username, gpuNode: p.gpuNode, vpn };
  }

  return {
    run(payload, ctx) {
      return { CREATE: create, REVOKE: revoke, EXTEND: extend }[payload.action](payload, ctx);
    },
  };
}
