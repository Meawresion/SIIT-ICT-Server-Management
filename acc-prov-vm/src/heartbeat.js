// Site heartbeat: every HEARTBEAT_INTERVAL_SEC the worker tells the portal it is alive. It sends a
// signed and encrypted result envelope with rid 0 (no request) on the result queue, so nobody else
// can fake one. The portal's provisioning service logs it, and its alarms fire when none arrives
// (the site or its network is down, or the Learner Lab keys have expired) or when the site reports
// a system it can't reach.
// The checks only open a TCP connection to the pfSense webGUI and to each node's SSH port, with no
// login: pfSense's login protection is never involved, and no credential is used.

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { seal } from './envelope.js';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

// Resolves true when host:port accepts a TCP connection within timeoutMs.
export function tcpCheck(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const finish = (ok) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

// What the heartbeat checks: pfSense (when enabled; loadPfSenseConfig() result) and every GPU and
// Hadoop node.
export function siteTargets({ pfsense, gpu, bigData }) {
  const targets = [];
  if (pfsense) {
    const url = new URL(pfsense.baseUrl);
    targets.push({ name: 'pfsense', kind: 'pfsense', host: url.hostname, port: Number(url.port) || (url.protocol === 'http:' ? 80 : 443) });
  }
  for (const n of gpu?.nodes ?? []) targets.push({ name: n.name, kind: 'gpu', host: n.host, port: n.port });
  for (const n of bigData?.nodes ?? []) targets.push({ name: n.name, kind: 'hadoop', host: n.host, port: n.port });
  return targets;
}

export async function runChecks(targets, check = tcpCheck) {
  return Promise.all(targets.map(async ({ name, kind, host, port }) => ({ name, kind, ok: await check(host, port) })));
}

// startHeartbeat({ intervalSec, send, me, peer, targets, log }) sends one heartbeat now and then
// every intervalSec; returns { stop, beat }. A failed send is logged and tried again next time.
export function startHeartbeat({ intervalSec, send, me, peer, targets, log = () => {}, check = tcpCheck, now = Date.now }) {
  const startedAt = now();
  async function beat() {
    try {
      const checks = await runChecks(targets, check);
      const payload = { heartbeat: { version: VERSION, uptimeSec: Math.round((now() - startedAt) / 1000), checks } };
      // Lives two intervals (at least 10 minutes): an old heartbeat says nothing about now.
      const ttlSec = Math.max(600, intervalSec * 2);
      await send(seal({ typ: 'result', jti: randomUUID(), rid: 0, payload, ttlSec, now: now() }, { me, peer }));
      const failed = checks.filter((c) => !c.ok).map((c) => c.name);
      log('heartbeat.sent', { checks: checks.length, failed });
    } catch (err) {
      log('heartbeat.send_failed', { error: err.message });
    }
  }
  beat();
  const timer = setInterval(beat, intervalSec * 1000);
  return { stop: () => clearInterval(timer), beat };
}
