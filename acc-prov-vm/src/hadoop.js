// Big Data provisioning (Step B2 of the technician manual): on every Hadoop node, a Linux user in
// the Hadoop groups; on the node marked hdfsHome, the student's HDFS home directory too. JupyterHub
// on the edge node logs in via PAM, so the Linux password is the JupyterHub password.
//
// Nodes come from BIGDATA_FILE (see config.js); a job never names a host.

import { SshHost } from './ssh.js';
import { createUser, getUserState, lockUser, setPassword, unlockUser } from './linux.js';
import { assertUsername } from './validate.js';

// -> SshHost connected to the node, with its pinned keys and IP check (the nodes share host keys).
export function connectHadoopNode(node, opts) {
  return SshHost.connect({ ...node.ssh, host: node.host, port: node.port, hostKeys: node.hostKeys, expectedIp: node.host }, opts);
}

// usermod -aG for the groups the user is not in yet. -> { changed }
export async function ensureGroups(ssh, username, groups) {
  const before = (await getUserState(ssh, username)).groups;
  const missing = groups.filter((g) => !before.includes(g));
  if (!missing.length) return { changed: false };
  await ssh.exec(['usermod', '-aG', missing.join(','), username], { sudo: true });
  const now = (await getUserState(ssh, username)).groups;
  if (!groups.every((g) => now.includes(g))) throw new Error(`${username} is not in ${groups.join(', ')} on ${ssh.host}`);
  return { changed: true };
}

// hdfs dfs as the HDFS superuser. Exit 1 of -test means "no".
function hdfsDfs(ssh, hdfs, args, opts = {}) {
  return ssh.exec([hdfs.command, 'dfs', ...args], { sudo: true, asUser: hdfs.superuser, timeoutMs: hdfs.timeoutMs, ...opts });
}

// -> { owner, group, mode } of an HDFS directory (from `hdfs dfs -stat`).
export async function hdfsDirState(ssh, hdfs, dir) {
  const { stdout } = await hdfsDfs(ssh, hdfs, ['-stat', '%u %g %a', dir]);
  const line = stdout.trim().split('\n').pop();
  const m = /^(\S+) (\S+) ([0-7]{3,4})$/.exec(line);
  if (!m) throw new Error(`unexpected hdfs -stat output for ${dir}`);
  return { owner: m[1], group: m[2], mode: m[3] };
}

// The student's HDFS home. Owner and group are applied every time, so a retry finishes a
// half-done setup. -> { created, owner, group, mode }
//
// studentOwnsHome: true runs `-chown <user>:<group>`, SIIT's real command step. false runs
// `-chown :<group>` as the manual prints it (a typo, plan.md §6b): only the group changes, the owner
// stays the HDFS superuser and, with mode 755, the student can't write to their own home.
export async function ensureHdfsHome(ssh, hdfs, username) {
  assertUsername(username);
  const dir = `${hdfs.homeDir}/${username}`;
  const exists = (await hdfsDfs(ssh, hdfs, ['-test', '-d', dir], { allowFail: true })).code === 0;
  if (!exists) await hdfsDfs(ssh, hdfs, ['-mkdir', '-p', dir]);
  await hdfsDfs(ssh, hdfs, ['-chown', hdfs.studentOwnsHome ? `${username}:${hdfs.group}` : `:${hdfs.group}`, dir]);
  await hdfsDfs(ssh, hdfs, ['-chmod', hdfs.mode, dir]);
  const state = await hdfsDirState(ssh, hdfs, dir);
  if (state.group !== hdfs.group || (hdfs.studentOwnsHome && state.owner !== username)) {
    throw new Error(`HDFS home ${dir} has owner ${state.owner}:${state.group}`);
  }
  return { created: !exists, ...state };
}

// Create or re-activate a student's account on one Hadoop node: user (if missing), password,
// unlock, groups, and the HDFS home on the hdfsHome node. Safe to re-run.
// -> { created, hdfsHome: 'created' | 'exists' | undefined }
export async function provisionHadoopUser(ssh, node, settings, { username, fullName, password }) {
  const existed = (await getUserState(ssh, username)).exists;
  if (!existed) await createUser(ssh, { username, fullName });
  await setPassword(ssh, { username, fullName, password });
  await unlockUser(ssh, username);
  await ensureGroups(ssh, username, settings.groups);
  let hdfsHome;
  if (node.hdfsHome) hdfsHome = (await ensureHdfsHome(ssh, settings.hdfs, username)).created ? 'created' : 'exists';
  return { created: !existed, hdfsHome };
}

// Lock + expire the Linux account; the home directory and the HDFS home are kept (D16).
export function revokeHadoopUser(ssh, username) {
  return lockUser(ssh, username);
}
