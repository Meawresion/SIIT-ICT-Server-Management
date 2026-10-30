// Deleting a student's accounts everywhere: the admin's tool (scripts/cleanup-user.js), never the
// worker (D16: revoke = disable). Every system is checked first; an account is deleted only when it
// exists and its full name matches; every check and change is printed for the admin to verify.
//
// Systems: pfSense VPN user, the Linux user on every GPU node and every Hadoop node (with its home
// directory), and the HDFS home. HUE users are not automated yet: the plan prints a reminder.

import { getUserState, sanitizeGecos } from './linux.js';
import { assertNonEmpty, assertUsername } from './validate.js';

// deps: {
//   pfsense: withPfSense(fn) | null,                       null = not configured on this host
//   linuxNodes: [{ label: 'gpu gpu-48', connect() -> SshHost }],
//   hdfs: { label, connect(), settings: bigdata.hdfs } | null,
//   hue: boolean,                                         HUE configured: print the manual step
// }
// out(line): one line of the report. apply: false = check only.
// -> { deleted, wouldDelete, notFound, skipped, failed }
export async function cleanupUser({ username, fullName, apply, deps, out }) {
  assertUsername(username);
  assertNonEmpty('fullName', fullName);
  const tally = { deleted: 0, wouldDelete: 0, notFound: 0, skipped: 0, failed: 0 };
  const act = apply ? 'DELETE' : 'CHECK ';
  const say = (where, msg) => out(`${act} [${where}] ${msg}`);

  async function step(where, fn) {
    try {
      tally[await fn()] += 1;
    } catch (err) {
      tally.failed += 1;
      say(where, `ERROR: ${err.message}`);
    }
  }

  // ---- pfSense
  if (!deps.pfsense) {
    say('pfsense', 'not configured on this host (PFSENSE_* in .env); skipped');
  } else {
    await step('pfsense', () => deps.pfsense(async (pf) => {
      const s = await pf.getUserState(username);
      if (!s.exists) {
        say('pfsense', `VPN user ${username}: not found, nothing to do`);
        return 'notFound';
      }
      say('pfsense', `VPN user ${username}: found, full name "${s.fullName}", ${s.disabled ? 'disabled' : 'enabled'}, expires ${s.expires ?? 'never'}`);
      if (s.fullName !== fullName) {
        say('pfsense', `SKIPPED: the full name is not "${fullName}"`);
        return 'skipped';
      }
      if (!apply) {
        say('pfsense', `would delete VPN user ${username}`);
        return 'wouldDelete';
      }
      await pf.deleteUser({ username, fullName });
      if ((await pf.getUserState(username)).exists) throw new Error(`${username} still exists after the delete`);
      say('pfsense', `deleted VPN user ${username}`);
      say('pfsense', `note: its certificate "${username}" stays in System > Cert Manager > Certificates; delete it there if wanted`);
      return 'deleted';
    }));
  }

  // ---- Linux users (GPU and Hadoop nodes)
  for (const node of deps.linuxNodes) {
    await step(node.label, () => withHost(node, async (ssh) => {
      const s = await getUserState(ssh, username);
      if (!s.exists) {
        say(node.label, `Linux user ${username}: not found, nothing to do`);
        return 'notFound';
      }
      const procs = (await ssh.exec(['pgrep', '-u', username], { allowFail: true })).stdout.trim().split('\n').filter(Boolean);
      say(node.label, `Linux user ${username}: found, uid ${s.uid}, full name "${s.fullName}", home ${s.home}, ` +
        `${s.locked ? 'locked' : 'unlocked'}, groups ${s.groups.join(',')}, ${procs.length} running process(es)`);
      if (s.fullName !== sanitizeGecos(fullName)) {
        say(node.label, `SKIPPED: the full name is not "${sanitizeGecos(fullName)}"`);
        return 'skipped';
      }
      if (!apply) {
        say(node.label, `would ${procs.length ? 'stop its processes, then ' : ''}delete user ${username} and its home ${s.home}`);
        return 'wouldDelete';
      }
      if (procs.length) {
        await ssh.exec(['pkill', '-KILL', '-u', username], { sudo: true, allowFail: true });
        say(node.label, `stopped ${procs.length} process(es) of ${username}`);
      }
      await ssh.exec(['deluser', '--remove-home', username], { sudo: true });
      if ((await getUserState(ssh, username)).exists) throw new Error(`${username} still exists after deluser`);
      say(node.label, `deleted user ${username} and its home ${s.home}`);
      return 'deleted';
    }));
  }

  // ---- HDFS home
  if (deps.hdfs) {
    const { settings } = deps.hdfs;
    const dir = `${settings.homeDir}/${username}`;
    const hdfs = (ssh, args, opts = {}) => ssh.exec([settings.command, 'dfs', ...args],
      { sudo: true, asUser: settings.superuser, timeoutMs: settings.timeoutMs, ...opts });
    await step(deps.hdfs.label, () => withHost(deps.hdfs, async (ssh) => {
      if ((await hdfs(ssh, ['-test', '-d', dir], { allowFail: true })).code !== 0) {
        say(deps.hdfs.label, `HDFS ${dir}: not found, nothing to do`);
        return 'notFound';
      }
      const stat = (await hdfs(ssh, ['-stat', '%u:%g %a', dir])).stdout.trim().split('\n').pop();
      const size = (await hdfs(ssh, ['-du', '-s', dir])).stdout.trim().split('\n').pop().split(/\s+/)[0];
      say(deps.hdfs.label, `HDFS ${dir}: found, ${stat}, ${size} bytes`);
      if (!apply) {
        say(deps.hdfs.label, `would remove ${dir} (to the HDFS trash if trash is on)`);
        return 'wouldDelete';
      }
      await hdfs(ssh, ['-rm', '-r', dir]);
      if ((await hdfs(ssh, ['-test', '-d', dir], { allowFail: true })).code === 0) throw new Error(`${dir} still exists`);
      say(deps.hdfs.label, `removed ${dir} (kept in the HDFS trash for fs.trash.interval if trash is on)`);
      return 'deleted';
    }));
  }

  if (deps.hue) say('hue', `not automated yet: delete ${username} by hand in HUE > Administer Users if it exists`);

  out(`SUMMARY ${apply ? 'deleted' : 'would delete'} ${apply ? tally.deleted : tally.wouldDelete}, not found ${tally.notFound}, ` +
    `skipped ${tally.skipped}, errors ${tally.failed}`);
  return tally;
}

async function withHost(node, fn) {
  const ssh = await node.connect();
  try {
    return await fn(ssh);
  } finally {
    ssh.close();
  }
}
