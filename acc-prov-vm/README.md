# acc-prov-vm (Account Provisioning VM)

Runs at the SIIT resource site, behind pfSense. When a GPU or Big Data request is approved, it creates the student's accounts; when the request ends, it revokes them:

- **pfSense** VPN user, via the webGUI with Playwright (`src/pfsense.js`)
- **GPU node** Linux user + conda Jupyter kernel, over SSH (`src/ssh.js`, `src/linux.js`, `src/gpu.js`)
- Hadoop Linux / HDFS accounts over SSH (planned)
- HUE user (planned)

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
