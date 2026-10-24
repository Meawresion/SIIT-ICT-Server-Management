// GPU node provisioning (Step B1 of the technician manual): a Linux user on the assigned
// node plus a personal conda env registered as a Jupyter kernel. JupyterHub logs in via PAM,
// so the Linux password is the JupyterHub password.
//
// Nodes come from GPU_NODES_FILE (see config.js); a job names a node, never a raw host.

import { SshHost } from './ssh.js';
import { createUser, getUserState, lockUser, setPassword, unlockUser } from './linux.js';
import { assertUsername } from './validate.js';

export function findGpuNode(config, name) {
  const node = config.nodes.find((n) => n.name === name);
  if (!node) throw new Error(`not a configured GPU node: ${name}`);
  return node;
}

// -> SshHost connected to the node, with its pinned keys and IP check.
export function connectGpuNode(node, opts) {
  return SshHost.connect({ ...node.ssh, host: node.host, port: node.port, hostKeys: node.hostKeys, expectedIp: node.host }, opts);
}

// Runs a login-shell script as the student, from the student's home. (The SSH session's cwd is
// the admin's home, which the student can't enter; conda's subprocesses chdir() into it.)
function asUserLogin(ssh, username, script, opts = {}) {
  return ssh.exec(['bash', '-lc', `cd ~ && ${script}`], { sudo: true, asUser: username, ...opts });
}

// -> { env: boolean, kernel: boolean }
export async function getKernelState(ssh, node, username) {
  assertUsername(username);
  const envs = await asUserLogin(ssh, username, `${node.conda} env list --json`);
  // A login shell may print extra lines; take the JSON object only.
  const json = envs.stdout.slice(envs.stdout.indexOf('{'), envs.stdout.lastIndexOf('}') + 1);
  const env = JSON.parse(json).envs.some((p) => p.split('/').pop() === username);
  const kernel = await asUserLogin(
    ssh, username, `test -f ~/${node.kernelDir}/${username}/kernel.json`, { allowFail: true },
  );
  return { env, kernel: kernel.code === 0 };
}

// conda create + ipykernel install, each only if missing. -> { changed }
export async function ensureCondaKernel(ssh, node, username, { timeoutMs }) {
  const before = await getKernelState(ssh, node, username);
  if (!before.env) {
    await asUserLogin(ssh, username, `${node.conda} create -y -n ${username} ipykernel`, { timeoutMs });
  }
  if (!before.kernel) {
    await asUserLogin(
      ssh, username, `${node.conda} run -n ${username} python3 -m ipykernel install --user --name ${username}`,
      { timeoutMs },
    );
  }
  const after = await getKernelState(ssh, node, username);
  if (!after.env || !after.kernel) throw new Error(`conda kernel for ${username} is incomplete on ${node.name}`);
  return { changed: !before.env || !before.kernel };
}

// Create or re-activate a student's GPU account: user (if missing), password, unlock, kernel.
export async function provisionGpuUser(ssh, node, { username, fullName, password }, { timeoutMs }) {
  const existed = (await getUserState(ssh, username)).exists;
  if (!existed) await createUser(ssh, { username, fullName });
  await setPassword(ssh, { username, fullName, password });
  await unlockUser(ssh, username);
  await ensureCondaKernel(ssh, node, username, { timeoutMs });
  return { created: !existed, state: await getUserState(ssh, username) };
}

export function revokeGpuUser(ssh, username) {
  return lockUser(ssh, username);
}
