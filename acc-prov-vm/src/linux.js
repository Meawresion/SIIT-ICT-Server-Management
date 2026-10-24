// Linux account operations over an SshHost (runbooks in the technician manuals).
// Revoke = lock + expire, never delete (D16). Passwords go to chpasswd on stdin only.

import { assertNonEmpty, assertUsername } from './validate.js';

export class LinuxUserExistsError extends Error {}

export class LinuxUserNotFoundError extends Error {}

export class LinuxIdentityError extends Error {}

// adduser rejects : , = in the GECOS field; newlines would break /etc/passwd.
export function sanitizeGecos(fullName) {
  return fullName.replace(/[:,=\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
}

// name:x:uid:gid:gecos:home:shell
export function parsePasswdLine(line) {
  const f = line.trim().split(':');
  if (f.length < 7) throw new Error('unexpected passwd entry');
  return { uid: Number(f[2]), fullName: f[4].split(',')[0], home: f[5], shell: f[6] };
}

// name:hash:lastchg:min:max:warn:inactive:expire:reserved (expire in days since epoch)
export function parseShadowLine(line, today = Math.floor(Date.now() / 86_400_000)) {
  const f = line.trim().split(':');
  if (f.length < 9) throw new Error('unexpected shadow entry');
  const expire = f[7] === '' ? null : Number(f[7]);
  return { locked: f[1].startsWith('!'), expired: expire !== null && expire <= today };
}

// -> { exists: false } | { exists: true, uid, fullName, home, shell, groups, locked, expired }
export async function getUserState(host, username) {
  assertUsername(username);
  const pw = await host.exec(['getent', 'passwd', username], { allowFail: true });
  if (pw.code === 2) return { exists: false };
  if (pw.code !== 0) throw new Error(`getent passwd failed on ${host.host} (exit ${pw.code})`);

  const shadow = await host.exec(['getent', 'shadow', username], { sudo: true });
  const groups = await host.exec(['id', '-nG', username]);
  return {
    exists: true,
    ...parsePasswdLine(pw.stdout),
    groups: groups.stdout.trim().split(/\s+/),
    ...parseShadowLine(shadow.stdout),
  };
}

export async function createUser(host, { username, fullName }) {
  assertUsername(username);
  assertNonEmpty('fullName', fullName);
  if ((await getUserState(host, username)).exists) {
    throw new LinuxUserExistsError(`Linux user already exists on ${host.host}: ${username}`);
  }
  await host.exec(['adduser', '--disabled-password', '--gecos', sanitizeGecos(fullName), username], { sudo: true });
  const state = await getUserState(host, username);
  if (!state.exists) throw new Error(`${username} was not created on ${host.host}`);
  return state;
}

// Sets the password only after the account's full name matches the expected one.
export async function setPassword(host, { username, fullName, password }) {
  assertUsername(username);
  assertNonEmpty('fullName', fullName);
  assertNonEmpty('password', password);
  if (/[\r\n]/.test(password)) throw new Error('password must not contain line breaks');

  const state = await getUserState(host, username);
  if (!state.exists) throw new LinuxUserNotFoundError(`no such Linux user on ${host.host}: ${username}`);
  if (state.fullName !== sanitizeGecos(fullName)) {
    throw new LinuxIdentityError(`full name of ${username} on ${host.host} does not match`);
  }
  await host.exec(['chpasswd'], { sudo: true, stdin: [`${username}:${password}`] });
}

// Lock the password and expire the account; home and data are kept. -> { changed }
export async function lockUser(host, username) {
  const before = await getUserState(host, username);
  if (!before.exists) throw new LinuxUserNotFoundError(`no such Linux user on ${host.host}: ${username}`);
  if (before.locked && before.expired) return { changed: false };
  await host.exec(['usermod', '-L', username], { sudo: true });
  await host.exec(['chage', '-E', '0', username], { sudo: true });
  const after = await getUserState(host, username);
  if (!after.locked || !after.expired) throw new Error(`${username} did not lock on ${host.host}`);
  return { changed: true };
}

// Needs a password to be set first (usermod -U refuses to leave an account passwordless).
export async function unlockUser(host, username) {
  const before = await getUserState(host, username);
  if (!before.exists) throw new LinuxUserNotFoundError(`no such Linux user on ${host.host}: ${username}`);
  if (!before.locked && !before.expired) return { changed: false };
  await host.exec(['usermod', '-U', username], { sudo: true });
  await host.exec(['chage', '-E', '-1', username], { sudo: true });
  const after = await getUserState(host, username);
  if (after.locked || after.expired) throw new Error(`${username} did not unlock on ${host.host}`);
  return { changed: true };
}
