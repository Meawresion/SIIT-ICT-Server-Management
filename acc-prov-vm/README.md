# acc-prov-vm (Account Provisioning VM)

Runs at the SIIT resource site, behind pfSense. When a GPU or Big Data request is approved, it creates the student's accounts; when the request ends, it revokes them:

- **pfSense** VPN user, via the webGUI with Playwright (`src/pfsense.js`)
- **GPU node** Linux user + conda Jupyter kernel, over SSH (`src/ssh.js`, `src/linux.js`, `src/gpu.js`)
- Hadoop Linux / HDFS accounts over SSH (planned)
- HUE user (planned)
- **Messaging:** signed + encrypted envelopes (`src/envelope.js`) over local ActiveMQ (`src/amqp.js`) or AWS SQS (`src/sqs.js`)
- **Student email** with credentials and links, via SMTP (`src/mail.js`)
- **Worker** (`npm start`): runs CREATE / REVOKE jobs from the queue (`src/worker.js`, `src/jobs.js`)

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

## Local message broker (D23)

For local testing, the backend and acc-prov-vm exchange envelopes through **ActiveMQ Artemis**, the `activemq` service in the root `docker-compose.yml`. In AWS they use SQS instead. The broker:
- listens on `127.0.0.1` only (AMQP 5672, web console 8161);
- takes its login from `ARTEMIS_USER` / `ARTEMIS_PASSWORD` in the root `.env`;
- has anonymous login disabled.

`src/amqp.js` (AMQP 1.0, `rhea`) has the same contract as the SQS transport:

| Call | Behaviour |
|------|-----------|
| `AmqpConnection.connect(loadAmqpConfig())` | Logs in with `AMQP_USER` / `AMQP_PASSWORD`. |
| `send(queue, text)` | Resolves once the broker has stored the message (durable, anycast queue). |
| `consume(queue, handler)` | One message at a time. **Accepted only after `handler` resolves**; released for redelivery if it throws (after a short back-off). Artemis dead-letters a message after its max delivery attempts, like an SQS DLQ. |

```bash
docker compose up -d activemq                     # from the repo root
cd acc-prov-vm && npm run test:amqp               # throwaway queue; real queues untouched
```

## AWS SQS

With `MESSAGE_TRANSPORT=sqs` the worker uses the queues from the root `infra` queues stack
(`infra/cloudformation/queues.yaml`). `src/sqs.js` has the same contract as `src/amqp.js`:

| Call | Behaviour |
|------|-----------|
| `SqsConnection.connect(loadSqsConfig())` | Region and the queue URLs `SQS_REQUEST_QUEUE_URL` / `SQS_RESULT_QUEUE_URL`; credentials as for the AWS CLI. |
| `send(queueUrl, text)` | Resolves once SQS has stored the message. |
| `consume(queueUrl, handler)` | One message at a time. **Deleted only after `handler` resolves**; if it throws, the message comes back after a short back-off. While a job runs its visibility is extended, so a slow job is never handed out twice. A forged message is made visible at once, and the queue's redrive policy moves it to the dead-letter queue after `MaxReceiveCount` (5) deliveries. |

Setup, from the stack outputs:
- `SQS_REQUEST_QUEUE_URL`, `SQS_RESULT_QUEUE_URL`: `RequestQueueUrl`, `ResultQueueUrl`;
- `MSG_PEER_PUBLIC_KEYS`: `BackendPublicKey` (the backend's private key exists only in Secrets Manager);
- this site's public bundle (`npm run keygen`) goes into `SITE_PUBLIC_KEYS` in `infra/config.env`;
- credentials: on Learner Lab, the session's `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and
  `AWS_SESSION_TOKEN` in `.env` each session (plan §10.1); with the full account, IAM Roles Anywhere.
- Keep `WORKER_MAX_ATTEMPTS` below `MaxReceiveCount`, so the backend always gets a failed result
  instead of a silent dead-letter.

## Worker (`npm start`)

`src/main.js` connects the pieces. It takes **one job at a time** from the request queue and answers on the result queue. Logs are JSON lines on stdout, with no passwords and no message plaintext.

| Job | What it does |
|-----|--------------|
| `CREATE` (GPU) | 1. Generate a password (`PASSWORD_LENGTH`; letters and digits, no look-alikes). 2. **VPN (D15)**, if `PFSENSE_ENABLED=true`: create the account if it's missing; keep an active one, extending its expiration only if it was set; re-activate a disabled or expired one with the new password. 3. GPU account and conda kernel on the named node. 4. Both emails, **last**. |
| `REVOKE` (GPU) | Lock the Linux account. Disable the VPN account only when `revokeVpn` is true (the student has no other active request). |

- **Retries and failures:**
  - A transient failure is retried through redelivery, up to `WORKER_MAX_ATTEMPTS`.
  - The last attempt, or a job that can never succeed (unsupported resource, bad payload, an account belonging to another full name), sends a **failed result**, so the backend always hears back.
  - A forged or malformed message is **rejected**: the broker dead-letters it and no result is sent.
- **Retrying CREATE is safe.** Each attempt sets one fresh password on every account the job manages, and emails it last. If an earlier attempt created the VPN account, that fact is kept in the job store (no secrets), so the retry resets the VPN password too.
- **Duplicates:** `JOB_STORE_FILE` records each finished `jti`. A redelivered or replayed job is not run again; its stored result is re-sent.

**Local end-to-end test** (the local ActiveMQ broker, a real GPU node and real email, with pfSense off):
```bash
npm run keygen -- site-local      # MSG_PRIVATE_KEY=... -> .env ; public line -> TEST_SITE_PUBLIC_KEY
npm run keygen -- backend-local   # its private value -> TEST_BACKEND_PRIVATE_KEY ; public -> MSG_PEER_PUBLIC_KEYS
npm start                                                  # terminal 1
npm run send-test-job -- create gpu-01 you@example.com     # terminal 2, prints the result
npm run send-test-job -- revoke gpu-01
```
