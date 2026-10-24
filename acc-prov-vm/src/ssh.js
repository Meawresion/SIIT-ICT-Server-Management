// SSH transport for the Linux hosts (GPU nodes, later the Hadoop nodes).
//
// - The host key is pinned by SHA256 fingerprint. The two GPU nodes are clones with the same
//   key (D17), so the key alone can't tell them apart: every session first checks that the
//   host really has the expected IP, and aborts otherwise.
// - Commands are built from argv arrays and single-quoted, never from interpolated strings.
// - Secrets (sudo password, user passwords) only travel on stdin, never in argv or logs.
// - sudo always runs with -k, so a cached sudo timestamp can't make sudo skip reading the
//   password line and hand it to the command instead.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'ssh2';

export class SshError extends Error {}

export class HostIdentityError extends SshError {}

export class SshCommandError extends SshError {
  constructor(command, code, stderr) {
    super(`remote command failed (exit ${code}): ${command}${stderr ? `: ${stderr}` : ''}`);
    this.code = code;
    this.stderr = stderr;
  }
}

export function shellQuote(arg) {
  const s = String(arg);
  if (/^[A-Za-z0-9_\-.,/:=@%+]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function toCommand(argv) {
  return argv.map(shellQuote).join(' ');
}

// Same format as `ssh-keygen -lf ... -E sha256`: SHA256:<base64 without padding>.
export function fingerprintSha256(keyBlob) {
  return `SHA256:${createHash('sha256').update(keyBlob).digest('base64').replace(/=+$/, '')}`;
}

export class SshHost {
  #conn;
  #log;
  #sudoPassword;
  #sudoNeedsPassword = true;

  constructor(conn, host, log, sudoPassword) {
    this.#conn = conn;
    this.host = host;
    this.#log = log;
    this.#sudoPassword = sudoPassword;
  }

  // hostKeys: pinned fingerprints. expectedIp defaults to host.
  static async connect(
    { host, port = 22, username, password, privateKeyPath, sudoPassword = password, hostKeys, expectedIp = host },
    { log = () => {}, readyTimeoutMs = 15_000 } = {},
  ) {
    if (!hostKeys?.length) throw new SshError('no pinned host keys configured');
    const privateKey = privateKeyPath ? await readFile(privateKeyPath) : undefined;
    const conn = new Client();
    await new Promise((resolve, reject) => {
      conn
        .once('ready', resolve)
        .once('error', (err) => reject(
          /verification failed/i.test(err.message)
            ? new HostIdentityError(`host key of ${host} is not pinned`)
            : err,
        ))
        .on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) => finish(prompts.map(() => password)))
        .connect({
          host,
          port,
          username,
          password,
          privateKey,
          tryKeyboard: Boolean(password),
          readyTimeout: readyTimeoutMs,
          hostVerifier: (key) => hostKeys.includes(fingerprintSha256(key)),
        });
    });

    const h = new SshHost(conn, host, log, sudoPassword);
    try {
      await h.#checkIp(expectedIp);
      await h.#probeSudo();
    } catch (err) {
      conn.end();
      throw err;
    }
    log('ssh.connect', { host, user: username });
    return h;
  }

  async #checkIp(expectedIp) {
    const { stdout } = await this.exec(['ip', '-4', '-o', 'addr', 'show']);
    const escaped = expectedIp.replace(/\./g, '\\.');
    if (!new RegExp(`\\binet ${escaped}/`).test(stdout)) {
      throw new HostIdentityError(`connected host does not have IP ${expectedIp}; aborting`);
    }
  }

  async #probeSudo() {
    await this.exec(['sudo', '-k']);
    const nopasswd = await this.exec(['sudo', '-n', 'true'], { allowFail: true });
    this.#sudoNeedsPassword = nopasswd.code !== 0;
    if (!this.#sudoNeedsPassword) return;
    if (!this.#sudoPassword) throw new SshError(`sudo on ${this.host} needs a password and none is configured`);
    // Check the password once, so a wrong one never makes sudo consume later stdin lines.
    const check = await this.exec(['true'], { sudo: true, allowFail: true });
    if (check.code !== 0) throw new SshError(`sudo password rejected on ${this.host}`);
  }

  // Runs argv; with sudo, as root (or asUser). stdin: lines written after the sudo password.
  // -> { code, stdout, stderr }; throws SshCommandError on non-zero exit unless allowFail.
  async exec(argv, { sudo = false, asUser, stdin = [], allowFail = false, timeoutMs = 120_000 } = {}) {
    let full = argv;
    const lines = [...stdin];
    if (sudo) {
      const prefix = this.#sudoNeedsPassword ? ['sudo', '-k', '-S', '-p', ''] : ['sudo', '-n'];
      if (asUser) prefix.push('-u', asUser, '-H');
      full = [...prefix, '--', ...argv];
      if (this.#sudoNeedsPassword) lines.unshift(this.#sudoPassword);
    }
    const command = toCommand(full);

    const result = await new Promise((resolve, reject) => {
      this.#conn.exec(command, (err, stream) => {
        if (err) return reject(err);
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
          stream.close();
          reject(new SshError(`remote command timed out after ${timeoutMs} ms: ${toCommand(argv)}`));
        }, timeoutMs);
        stream.on('data', (d) => { stdout += d; });
        stream.stderr.on('data', (d) => { stderr += d; });
        stream.on('close', (code) => {
          clearTimeout(timer);
          resolve({ code: code ?? -1, stdout, stderr: stderr.trim() });
        });
        stream.end(lines.length ? `${lines.join('\n')}\n` : undefined);
      });
    });

    this.#log('ssh.exec', { host: this.host, argv, sudo, asUser, code: result.code });
    if (result.code !== 0 && !allowFail) throw new SshCommandError(toCommand(argv), result.code, result.stderr);
    return result;
  }

  close() {
    this.#conn.end();
  }
}
