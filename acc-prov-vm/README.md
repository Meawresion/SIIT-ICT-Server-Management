# acc-prov-vm (Account Provisioning VM)

Runs at the SIIT resource site, behind pfSense. When a GPU or Big Data request is approved, it creates the student's accounts; when the request ends, it revokes them:

- **pfSense** VPN user, via the webGUI with Playwright (`src/pfsense.js`)
- **GPU node** Linux user + conda Jupyter kernel, over SSH (`src/ssh.js`, `src/linux.js`, `src/gpu.js`)
- **Hadoop nodes** Linux user in the Hadoop groups on every node, plus the HDFS home, over SSH (`src/hadoop.js`)
- **HUE** user, via the webGUI with Playwright (`src/hue.js`; off until verified on the live UI)
- **Messaging:** signed + encrypted envelopes (`src/envelope.js`) over local ActiveMQ (`src/amqp.js`) or AWS SQS (`src/sqs.js`)
- **Student email** with credentials and links, sent directly from this host to the SMTP relay (`src/mail.js`)
- **Worker** (`npm start`): runs CREATE / REVOKE / EXTEND jobs from the queue (`src/worker.js`, `src/jobs.js`)

## Setup

```bash
cd acc-prov-vm
npm install
npx playwright install chromium
cp .env.example .env                       # fill in; git-ignored
cp gpu-nodes.example.json gpu-nodes.json   # edit for this site; git-ignored
cp bigdata.example.json bigdata.json       # the Hadoop nodes; git-ignored (optional)
npm run check:config                       # validates them, prints the GPU and Hadoop nodes
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
- **No delete:** revoke = disable. Deleting is a separate admin command (see below).

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
| `src/linux.js` | `getUserState`, `createUser`, `setPassword` (refuses unless the account's full name matches), `lockUser`, `unlockUser`. Also used for the Hadoop nodes. |

- Commands are built from argv arrays and quoted, never from interpolated strings.
- Passwords go to `sudo -S` and `chpasswd` on stdin only. sudo always runs with `-k`, so a cached sudo session can't make the password line reach the command.

## Deleting a student's accounts (admin only)

The worker never deletes anything (revoke = disable). To delete one student's accounts everywhere, for example the throwaway test user `st9990000001`, the admin runs:

```bash
npm run cleanup-user -- st9990000001 --fullname "Test User For acc-prov-vm"         # check only
npm run cleanup-user -- st9990000001 --fullname "Test User For acc-prov-vm" --yes   # check, confirm, delete
```

- **Covers:**
  - the pfSense VPN user;
  - the Linux user and its home on **every** GPU node (`gpu-nodes.json`) and every Hadoop node (`bigdata.json`);
  - the HDFS home (`hdfs dfs -rm -r`, so it goes to the HDFS trash if trash is on).

  Systems not configured in `.env` are skipped. HUE users are not automated yet; the report reminds you to delete them by hand.
- **Check first.** Every system is checked and reported: exists or not, full name, lock state, groups, running processes, HDFS owner and size. A missing account is reported as "not found, nothing to do", not as an error, so a second run is harmless.
- **Never deletes another person's account.** An account whose full name differs from `--fullname` is skipped. Only `st`/`stm`/`std` + digits usernames are accepted.
- With `--yes` it asks you to type the username, checks everything again, then deletes. It stops the user's processes, runs `deluser --remove-home`, and verifies each deletion. Every line is time-stamped on stdout for you to read.
- The pfSense user's certificate stays in System > Cert Manager > Certificates; the report says so.
- The pfSense delete step (trash link, confirm dialog, success alert) comes from the recorded flow and had not run live yet. Watch the first run.
- Exit code 0 only when nothing was skipped and nothing failed.

## Big Data (Hadoop) module

The Hadoop nodes are listed in `bigdata.json` (`BIGDATA_FILE`). Without it, Big Data jobs are refused with a failed result.
- Each node has a `name`, an IPv4 `host`, a `port` and pinned `hostKeys`. The SIIT nodes `h99` and `h0` are clones that share one host key, so the IP check in every SSH session is what tells them apart.
- **Exactly one node has `"hdfsHome": true`.** HDFS is one file system for the whole cluster, so the HDFS home is made once, from that node.
- `groups`: the groups the student joins on every node. SIIT uses `hadoop` only (see below).
- `hdfs`: the `command`, the HDFS `superuser` that runs it, the `homeDir` parent, the home's `group` and `mode`, and `studentOwnsHome`.
- `jupyterUrl` and `hueUrl` go into the student's email.
- **SSH login:** `HADOOP_SSH_USER`, `HADOOP_SSH_PASSWORD`, `HADOOP_SSH_KEY_PATH` and `HADOOP_SUDO_PASSWORD`, with per-node overrides like the GPU ones. Any of them that is not set falls back to the `GPU_*` value (one admin account).

| Function | Notes |
|----------|-------|
| `provisionHadoopUser(ssh, node, settings, { username, fullName, password })` | Creates the user if missing, sets the password (only if the full name matches), unlocks, adds the missing groups. On the `hdfsHome` node it also makes `<homeDir>/<user>` as the HDFS superuser and applies the owner, group and mode. Safe to re-run. |
| `revokeHadoopUser(ssh, username)` | `usermod -L` + `chage -E 0`. The home and the HDFS home are kept. |

- **HDFS home owner:** `studentOwnsHome: true` runs `-chown <user>:<group>`, SIIT's real command step, so the student owns their home. The manual prints `-chown :hadoop` (a typo): that changes only the group, the owner stays `hdfs`, and with mode 755 the student can't write there.
- **Never add students to `hdfs`.** On the SIIT cluster `hdfs` is HDFS's superuser group (`dfs.permissions.superusergroup=hdfs`), so a member can read and delete everyone's HDFS data. The technician manual adds students to `hadoop,hdfs`; acc-prov-vm uses `hadoop` only. Accounts made by hand from the manual may still be in `hdfs`.
- JupyterHub on the edge node signs in through PAM, so the Linux password is the JupyterHub password, and a locked account can't sign in.

## HUE module

`src/hue.js` adds, resets and deactivates HUE users through Administer Users (HUE 4.11), when `HUE_ENABLED=true` (`HUE_URL`, `HUE_USER`, `HUE_PASSWORD`).
- **Not verified yet.** HUE was down while this was written, so the paths and form fields follow HUE 4.11's standard user forms. Record flows H0–H10 (`docs/codegen-checklist.md`) and test against the live UI before turning it on.
- While it is off, Big Data students get a note in the email that their HUE login comes later, and the result says `hue: 'skipped'`.
- Create unticks "Create home directory", because acc-prov-vm makes the HDFS home itself. A returning student's HUE user gets the new password and is made active again. Revoke unticks "Active".

## Mail module

The student gets **two emails**:
1. **(1/2) Instructions:** the username, the VPN password note (whether to keep the existing VPN password; with `PFSENSE_ENABLED=false` it says the VPN login comes separately from SIIT ICT), and links to the VPN profile, the service and the student manual. **No password.**
2. **(2/2) The password, as an inline image only.** It is rendered with Playwright's Chromium. The password never appears in any text part, in the image alt text, or in the logs.

```js
import { loadMailConfig } from './src/config.js';
import { createMailer, sendProvisionEmails } from './src/mail.js';
import { renderPasswordImage } from './src/password-image.js';

const mailer = createMailer(loadMailConfig());
await sendProvisionEmails(mailer, {
  to: 'student@...', fullName: 'Jane Doe', username: 'st6622001234',
  vpnIsNew: false, // false: keep the existing VPN password; the new one is for the service only
                   // null: the VPN account wasn't checked here (PFSENSE_ENABLED=false); no claim either way
  service: { name: 'GPU server gpu-01', links: [{ label: 'JupyterHub', url: node.jupyterUrl }], manualUrl },
  ovpnProfileUrl, period: { start: '2026-11-01', end: '2026-12-31' },
}, password, { renderImage: renderPasswordImage });
```

- **Escaping and attachments:** every email has a text and an HTML version, with user text escaped. The only attachment is the inline password image (CID).
- **Recipients** must be plain addresses. Quotes, `;`, `<>`, `()` and spaces are rejected. Optionally, `MAIL_ALLOWED_RECIPIENT_DOMAINS` limits sending to the SIIT domain.
- **Sender:** this host connects to the SMTP relay itself, with the `SMTP_*` settings in its own `.env`; nothing about the email passes through AWS. For now the relay is Gmail with an App Password. It can be swapped for an SIIT relay or SES by changing config only. The portal's status emails are separate: the notification Lambda sends them with its own copy of the settings.
- **The image is obfuscation, not encryption.** It keeps the password out of search, previews and scrapers, but anyone who opens the email can read it.

## Message envelope

Every message between the backend and acc-prov-vm is **signed and encrypted**, on every transport (local ActiveMQ, AWS SQS). IAM, TLS and SQS-managed encryption stay in place underneath. The envelope additionally makes sure that only the backend's key can authorize a job, and only acc-prov-vm can read it.

- **Keys:** each side has one bundle, `<kid>.<Ed25519 key>.<X25519 key>`. Generate one with `npm run keygen -- site-2026-10`.
  - The private bundle goes in this side's `.env` (`MSG_PRIVATE_KEY`) only.
  - The public bundle goes to the other side (`MSG_PEER_PUBLIC_KEYS`, or the SSM parameter on AWS, `MSG_PEER_PUBLIC_KEYS_PARAM`).
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

## Local message broker

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
- `MSG_PEER_PUBLIC_KEYS_PARAM`: the SSM parameter with the backend's public key
  (`BackendPublicKeyParameter`: `/des424-126-g01/backend-public-key` on the course account), read once at start. Or the key
  itself as text in `MSG_PEER_PUBLIC_KEYS` (it wins); the backend's private key exists only in
  Secrets Manager;
- this site's public bundle (`npm run keygen`) goes to SSM with `infra/scripts/set-site-key.sh`;
- credentials: IAM Roles Anywhere with the site certificate (`credential_process`, see "Running at
  the site", step 6).
- **Heartbeat:** every `HEARTBEAT_INTERVAL_SEC` (default 300; 0 = off) the worker sends the portal
  a signed and encrypted heartbeat on the result queue (`src/heartbeat.js`, rid 0, no job). It
  carries a TCP check of the pfSense webGUI and each node's SSH port, with no login. The portal
  alarms when none arrives for 15 minutes (site, network or expired keys) or when a check fails
  twice in a row.
- Keep `WORKER_MAX_ATTEMPTS` below `MaxReceiveCount`, so the backend always gets a failed result
  instead of a silent dead-letter.

## Worker (`npm start`)

`src/main.js` connects the pieces. It takes **one job at a time** from the request queue and answers on the result queue. Logs are JSON lines on stdout, with no passwords and no message plaintext.

| Job | What it does |
|-----|--------------|
| `CREATE` (GPU) | 1. Generate a password (`PASSWORD_LENGTH`; letters and digits, no look-alikes). 2. **VPN**, if `PFSENSE_ENABLED=true`: create the account if it's missing; keep an active one, extending its expiration only if it was set; re-activate a disabled or expired one with the new password. 3. GPU account and conda kernel on the named node. 4. Both emails, **last**. |
| `REVOKE` (GPU) | Lock the Linux account. Disable the VPN account only when `revokeVpn` is true (the student has no other active request). |
| `CREATE` (Big Data) | The same password and VPN steps, then the Linux account on every Hadoop node, the HDFS home, the HUE user (if `HUE_ENABLED`), and both emails (JupyterHub, plus HUE when it was set up), **last**. |
| `REVOKE` (Big Data) | Lock the Linux account on every Hadoop node, deactivate the HUE user (if `HUE_ENABLED`); the VPN as for GPU. |
| `EXTEND` (GPU, Big Data) | A later end date (FR-8.3): move the VPN account's expiration to `period.end`, never earlier, after checking its full name. A missing or disabled VPN account is reported (`vpn`), not created or enabled. Nothing changes on the GPU or Hadoop nodes or in HUE: those accounts have no expiration, `REVOKE` locks them at the end. |

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
npm run send-test-job -- create bigdata you@example.com   # the Hadoop nodes of bigdata.json
```

## Running at the site (systemd)

`deploy/acc-prov-vm.service` runs the worker as the unprivileged `accprov` user. The code is
root-owned, so the service can't change it. The settings are in `/etc/acc-prov-vm`, and the job
store and Chromium live in `/var/lib/acc-prov-vm`.

**Requirements on the host (Ubuntu):**
- Node.js 22 at `/usr/bin/node` (e.g. from NodeSource; otherwise change `ExecStart`).
- Outbound HTTPS to `sqs.<region>.amazonaws.com`, `ssm.<region>.amazonaws.com` and
  `rolesanywhere.<region>.amazonaws.com`.
- Outbound SMTP to the relay (`SMTP_PORT`: 465 for Gmail). The credential emails go straight from
  this host, so pfSense must let this out. The emails are the last step of a job, so a blocked port
  shows up as a failed job after the accounts were made.
- The pfSense webGUI, and SSH to the GPU and Hadoop nodes.

**Install** (as an admin with sudo):

1. Code, user and folders:
   ```bash
   sudo git clone https://github.com/Meawresion/SIIT-ICT-Server-Management.git /opt/siit
   cd /opt/siit/acc-prov-vm && sudo npm ci --omit=dev
   sudo useradd --system --home-dir /var/lib/acc-prov-vm --shell /usr/sbin/nologin accprov
   sudo install -d -o accprov -g accprov -m 750 /var/lib/acc-prov-vm
   sudo install -d -o root -g accprov -m 750 /etc/acc-prov-vm
   ```
2. Chromium for Playwright. The system libraries need root; the browser goes to the service's folder:
   ```bash
   sudo npx playwright install-deps chromium
   sudo -u accprov env PLAYWRIGHT_BROWSERS_PATH=/var/lib/acc-prov-vm/ms-playwright npx playwright install chromium
   ```
3. Settings. Run these from `/opt/siit/acc-prov-vm`, then fill them in as in [Setup](#setup):
   ```bash
   cd /opt/siit/acc-prov-vm
   sudo cp .env.example /etc/acc-prov-vm/acc-prov-vm.env
   sudo cp gpu-nodes.example.json /etc/acc-prov-vm/gpu-nodes.json
   sudo cp bigdata.example.json /etc/acc-prov-vm/bigdata.json
   # The example has paths relative to the code folder; at the site the files are in /etc/acc-prov-vm.
   sudo sed -i -e 's|^GPU_NODES_FILE=.*|GPU_NODES_FILE=/etc/acc-prov-vm/gpu-nodes.json|' \
     -e 's|^BIGDATA_FILE=.*|BIGDATA_FILE=/etc/acc-prov-vm/bigdata.json|' /etc/acc-prov-vm/acc-prov-vm.env
   # Files only: a folder in here (ssh/, site/) must keep mode 750, or accprov can't enter it.
   sudo find /etc/acc-prov-vm -maxdepth 1 -type f -exec chown root:accprov {} + -exec chmod 640 {} +
   # The npm scripts read .env in the code folder.
   sudo ln -sf /etc/acc-prov-vm/acc-prov-vm.env /opt/siit/acc-prov-vm/.env
   sudoedit /etc/acc-prov-vm/acc-prov-vm.env
   ```
   - `GPU_NODES_FILE` and `BIGDATA_FILE` must stay absolute paths: a relative one is looked up in
     the folder the command runs in (`cannot read GPU_NODES_FILE /opt/siit/acc-prov-vm/...`).
   - An SSH key goes in `/etc/acc-prov-vm/ssh/`: the folder `root:accprov` mode 750, the key 640.
   - `JOB_STORE_FILE` is set by the unit (`/var/lib/acc-prov-vm/jobs.json`).
   - Leave the `AWS_*` keys out of this file (step 6 sets up the AWS access); `AWS_REGION` stays.
   - `node: .env: not found` from an npm script means the link above is missing.
4. Message keys and queues:
   - `sudo -u accprov npm run keygen -- site-YYYY-MM`. The private line goes in the settings file
     (`MSG_PRIVATE_KEY`). The public line goes to the portal admin, who runs
     `infra/scripts/set-site-key.sh <public line>` (SSM; the provisioning service restarts with it).
   - Set `MESSAGE_TRANSPORT=sqs`, the two queue URLs and `MSG_PEER_PUBLIC_KEYS_PARAM` (the backend's
     public key in SSM, read at start) as `deploy.sh site` prints them. On the course account every
     name has the prefix `des424-126-g01`: `/des424-126-g01/backend-public-key`, queues
     `des424-126-g01-provision-requests` and `-provision-results`. A value with `siit-` in it means the
     admin ran `deploy.sh` without `CONFIG=infra/config.des424.env`. Leave `MSG_PEER_PUBLIC_KEYS`
     empty (it would win over the parameter).
5. Check the settings (from the code folder):
   ```bash
   cd /opt/siit/acc-prov-vm
   sudo -u accprov env PLAYWRIGHT_BROWSERS_PATH=/var/lib/acc-prov-vm/ms-playwright npm run check:config
   ```
   It prints `config OK` with the GPU and Hadoop nodes.
6. AWS access with IAM Roles Anywhere (no keys to paste or renew). The portal admin runs
   `site-ca.sh issue` and gives you `site.key` and `site.pem` (over SSH, never by email), and the
   three ARNs that `deploy.sh site` prints:
   ```bash
   # The credential helper, from AWS (check the SHA256 against the Roles Anywhere user guide,
   # "Get temporary security credentials"; 1.8.6 Linux x86-64 below)
   curl -fLo /tmp/aws_signing_helper https://rolesanywhere.amazonaws.com/releases/1.8.6/X86_64/Linux/Amzn2023/aws_signing_helper
   echo "3553fdc515e5682541a9ebdd37031ec7f461169aa13ccbb6fbd5b7259644113d  /tmp/aws_signing_helper" | sha256sum -c
   sudo install -o root -g root -m 755 /tmp/aws_signing_helper /usr/local/bin/aws_signing_helper
   # The certificate and its key
   sudo install -d -o root -g accprov -m 750 /etc/acc-prov-vm/site
   sudo install -o root -g accprov -m 640 site.pem site.key /etc/acc-prov-vm/site/
   # The SDK runs the helper and renews the credentials by itself
   sudo tee /etc/acc-prov-vm/aws-config >/dev/null <<'CFG'
   [default]
   credential_process = /usr/local/bin/aws_signing_helper credential-process --certificate /etc/acc-prov-vm/site/site.pem --private-key /etc/acc-prov-vm/site/site.key --trust-anchor-arn <TrustAnchorArn> --profile-arn <ProfileArn> --role-arn <RoleArn>
   CFG
   sudo chown root:accprov /etc/acc-prov-vm/aws-config && sudo chmod 640 /etc/acc-prov-vm/aws-config
   # Test: prints temporary credentials as JSON (don't share the output)
   sudo -u accprov /usr/local/bin/aws_signing_helper credential-process --certificate /etc/acc-prov-vm/site/site.pem --private-key /etc/acc-prov-vm/site/site.key --trust-anchor-arn <TrustAnchorArn> --profile-arn <ProfileArn> --role-arn <RoleArn> | head -c 20; echo
   ```
   `Profile default could not be found` or `Could not load credentials` means the `[default]` line
   at the top of `aws-config` is missing.

   To try it in the foreground first (Ctrl+C stops it):
   ```bash
   cd /opt/siit/acc-prov-vm && sudo -u accprov -H env AWS_CONFIG_FILE=/etc/acc-prov-vm/aws-config PLAYWRIGHT_BROWSERS_PATH=/var/lib/acc-prov-vm/ms-playwright JOB_STORE_FILE=/var/lib/acc-prov-vm/jobs.json /usr/bin/node --env-file=/etc/acc-prov-vm/acc-prov-vm.env src/main.js
   ```
   Then the service:
   ```bash
   sudo cp deploy/acc-prov-vm.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now acc-prov-vm
   ```
   The site role may only take jobs from the request queue, send results and read the backend's
   public key. The certificate lasts a year: `site-ca.sh issue` again, copy, restart.
7. Watch the first start: `journalctl -u acc-prov-vm -f`. It logs JSON lines, starting with
   `acc-prov-vm.ready` (the transport, the key id and the nodes).
   - If Chromium or SSH fails only under systemd, comment out the hardening lines in the unit one at
     a time (`ProtectSystem`, then `ProtectHome`, then `PrivateTmp`), `daemon-reload` and restart.

**Day to day:**

| Task | Command |
|---|---|
| New site certificate (yearly) | copy the new `site.pem` and `site.key` to `/etc/acc-prov-vm/site/`, `sudo systemctl restart acc-prov-vm` |
| Logs | `journalctl -u acc-prov-vm -f` (`--since "1 hour ago"`) |
| Is it connected? | The portal admin runs `find-in-logs.sh '"event":"site.heartbeat"' --group provisioning` (one every 5 minutes, only while the portal's stacks are up). `envelope expired` lines right after a portal start are old heartbeats and are harmless |
| Stop or start (e.g. before a portal smoke test, which must not meet the real worker) | `sudo systemctl stop acc-prov-vm` / `start` |
| New version | `cd /opt/siit && sudo git pull && cd acc-prov-vm && sudo npm ci --omit=dev && sudo systemctl restart acc-prov-vm` |
| Changed settings | `sudoedit /etc/acc-prov-vm/acc-prov-vm.env`, then `sudo systemctl restart acc-prov-vm` |
| Delete a student's accounts (admin) | `cd /opt/siit/acc-prov-vm && sudo -u accprov npm run cleanup-user -- <username> --fullname "<name>"` (see above) |

A stop or restart in the middle of a job is safe: the job comes back from the queue, and a
CREATE retry sets one fresh password on every account and emails it last.
