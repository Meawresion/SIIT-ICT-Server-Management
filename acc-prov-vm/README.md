# acc-prov-vm (Account Provisioning VM)

Runs at the SIIT resource site, behind pfSense. When a GPU or Big Data request is approved, it creates the student's accounts; when the request ends, it revokes them:

- **pfSense** VPN user, via the webGUI with Playwright (`src/pfsense.js`)
- **GPU node** Linux user + conda Jupyter kernel, over SSH (`src/ssh.js`, `src/linux.js`, `src/gpu.js`)
- Hadoop Linux / HDFS accounts over SSH (planned)
- HUE user (planned)
- **Student email** with credentials and links, via SMTP (`src/mail.js`)

## Setup

```bash
cd acc-prov-vm
npm install
npx playwright install chromium
cp .env.example .env                       # fill in; git-ignored
cp gpu-nodes.example.json gpu-nodes.json   # edit for this site; git-ignored
npm run check:config                       # validates both, prints the GPU nodes
```

Nothing site-specific is hard-coded. Every URL, IP, port, host-key fingerprint, CA name, certificate setting and conda path comes from configuration:
- **`.env`** holds credentials and simple values.
- **`gpu-nodes.json`** holds the GPU node list.

Credentials only ever come from `.env` on this host. They are never sent in job messages and never logged.

## pfSense module

```js
import { loadPfSenseConfig } from './src/config.js';
import { withPfSense } from './src/pfsense.js';

await withPfSense(loadPfSenseConfig(), async (pf) => {
  const state = await pf.getUserState('st6622001234'); // { exists, disabled, expires, fullName }
  if (!state.exists) {
    await pf.createUser({ username: 'st6622001234', password, fullName: 'Jane Doe', expires: '2026-12-31' });
  }
});
```

| Method | Notes |
|--------|-------|
| `getUserState(username)` | `{ exists: false }` or `{ exists, disabled, expires: 'YYYY-MM-DD' \| null, fullName }` |
| `createUser({ username, password, fullName, expires })` | Also creates the user certificate: CA from `PFSENSE_CA_NAME`, key type, length, digest and lifetime from `PFSENSE_CERT_*`. Throws `PfSenseUserExistsError` if the user exists. |
| `setPassword({ username, fullName, password })` | Refuses (`PfSenseIdentityError`) unless the edit page shows both that username and that full name. |
| `setExpiration({ username, expires })` | Reads the date back after saving. |
| `disableUser(username)` / `enableUser(username)` | Idempotent; returns `{ changed }`. |

Rules the module enforces:

- **Scope:** only usernames matching `^st[md]?\d{1,12}$` (`st` Undergraduate, `stm` Master, `std` PhD) are touched. Everything else is refused.
- **Dates:** checked before sending, because pfSense silently rolls `11/31` over to `12/01`.
- **One login per session.** A failed login is never retried, because pfSense Login Protection would block the host. Run one job at a time.
- **No delete** yet: revoke = disable (decision pending).

## GPU node module

**Adding a node** means adding an entry to `gpu-nodes.json`. Each node has its own:
- `name`;
- `host` (an IPv4 address, because cloned nodes share hostnames);
- `port`;
- `hostKeys`: one or more pinned `SHA256:` fingerprints, from `ssh-keyscan <ip> | ssh-keygen -lf - -E sha256`;
- `jupyterUrl`;
- optionally `conda`, `kernelDir` and `sshUser`, which override the top-level values.

SSH secrets for one node can override the shared ones in `.env`, for example `GPU_SSH_PASSWORD_GPU_02` for node `gpu-02`.

```js
import { loadGpuConfig } from './src/config.js';
import { connectGpuNode, findGpuNode, provisionGpuUser, revokeGpuUser } from './src/gpu.js';

const config = loadGpuConfig();
const node = findGpuNode(config, 'gpu-01'); // a job names a configured node, never a raw host
const ssh = await connectGpuNode(node);
try {
  await provisionGpuUser(ssh, node, { username: 'st6622001234', fullName: 'Jane Doe', password },
    { timeoutMs: config.condaTimeoutMs });
  // later: await revokeGpuUser(ssh, 'st6622001234');
} finally {
  ssh.close();
}
```

| Function | Notes |
|----------|-------|
| `findGpuNode(config, name)` | Only nodes listed in `gpu-nodes.json`. |
| `connectGpuNode(node)` | Checks the node's pinned host keys, then **checks the host's own IP** (cloned nodes can share keys and hostnames), then checks sudo. |
| `provisionGpuUser(ssh, node, { username, fullName, password }, { timeoutMs })` | Creates the user if missing, sets the password, unlocks, then creates the conda env and Jupyter kernel if missing. Commands run from the student's home. Safe to re-run. |
| `revokeGpuUser(ssh, username)` | `usermod -L` + `chage -E 0`; home and data are kept. |
| `src/linux.js` | `getUserState`, `createUser`, `setPassword` (refuses unless the account's full name matches), `lockUser`, `unlockUser`. Reused for the Hadoop nodes later. |

- Commands are built from argv arrays and quoted, never from interpolated strings.
- Passwords go to `sudo -S` and `chpasswd` on stdin only. sudo always runs with `-k`, so a cached sudo session can't make the password line reach the command.

## Mail module

The student gets **two emails**:
1. **(1/2) Instructions:** the username, the D15 note (whether to keep the existing VPN password), and links to the VPN profile, the service and the student manual. **No password.**
2. **(2/2) The password, as an inline image only.** It is rendered with Playwright's Chromium. The password never appears in any text part, in the image alt text, or in the logs.

```js
import { loadMailConfig } from './src/config.js';
import { createMailer, sendProvisionEmails } from './src/mail.js';
import { renderPasswordImage } from './src/password-image.js';

const mailer = createMailer(loadMailConfig());
await sendProvisionEmails(mailer, {
  to: 'student@...', fullName: 'Jane Doe', username: 'st6622001234',
  vpnIsNew: false, // false: keep the existing VPN password; the new one is for the service only (D15)
  service: { name: 'GPU server gpu-01', links: [{ label: 'JupyterHub', url: node.jupyterUrl }], manualUrl },
  ovpnProfileUrl, period: { start: '2026-11-01', end: '2026-12-31' },
}, password, { renderImage: renderPasswordImage });
```

- **Escaping and attachments:** every email has a text and an HTML version, with user text escaped. The only attachment is the inline password image (CID).
- **Recipients** must be plain addresses. Quotes, `;`, `<>`, `()` and spaces are rejected. Optionally, `MAIL_ALLOWED_RECIPIENT_DOMAINS` limits sending to the SIIT domain.
- **Sender:** SMTP settings come from `.env`; for now that's Gmail with an App Password (D9). The sender can be swapped for an SIIT relay or SES by changing config only.
- **The image is obfuscation, not encryption.** It keeps the password out of search, previews and scrapers, but anyone who opens the email can read it.

## Message envelope (D22)

Every message between the backend and acc-prov-vm is **signed and encrypted**, on every transport (local ActiveMQ, AWS SQS). IAM, TLS and SSE-KMS stay in place underneath. The envelope additionally makes sure that only the backend's key can authorize a job, and only acc-prov-vm can read it.

- **Keys:** each side has one bundle, `<kid>.<Ed25519 key>.<X25519 key>`. Generate one with `npm run keygen -- site-2026-10`.
  - The private bundle goes in this side's `.env` (`MSG_PRIVATE_KEY`) only.
  - The public bundle goes to the other side (`MSG_PEER_PUBLIC_KEYS`, or Secrets Manager on AWS).
  - Several peer bundles can be listed during a key rotation; the first one is used for sending.
- **Crypto (Node built-in `crypto`):** an ephemeral X25519 key with ECDH, then HKDF-SHA256, then AES-256-GCM, with the header as additional authenticated data. The sender signs header + iv + ciphertext + tag with Ed25519.
- **Envelope:** `{ v, typ: 'job'|'result', kid, rkid, jti (job_id), rid, iat, exp, epk, iv, ct, tag, sig }`. Payloads never contain passwords.
- **`open()` checks, in order:**
  1. size (at most 256 KB);
  2. version and type;
  3. a known sender `kid`, and `rkid` equal to this side's own kid;
  4. the time window (`iat` skew, `exp`, `MSG_MAX_TTL_SEC`);
  5. **the signature**;
  6. then it decrypts.

  Detecting a duplicate `jti` (replays and redeliveries) is the caller's job.

```js
import { open, parsePrivateBundle, parsePublicBundles, seal } from './src/envelope.js';

const me = parsePrivateBundle(process.env.MSG_PRIVATE_KEY);
const peers = parsePublicBundles(process.env.MSG_PEER_PUBLIC_KEYS);
const job = open(text, { me, peers, expectedTyp: 'job', maxTtlSec: Number(process.env.MSG_MAX_TTL_SEC) });
const reply = seal({ typ: 'result', jti: job.jti, rid: job.rid, payload: { ok: true }, ttlSec: 86400 },
  { me, peer: peers[0] });
```

