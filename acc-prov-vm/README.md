# acc-prov-vm (Account Provisioning VM)

Runs at the SIIT resource site, behind pfSense. When a GPU or Big Data request is approved, it creates the student's accounts; when the request ends, it revokes them:

- **pfSense** VPN user, via the webGUI with Playwright (`src/pfsense.js`)
- Linux / HDFS accounts over SSH (planned)
- HUE user (planned)

## Setup

```bash
cd acc-prov-vm
npm install
npx playwright install chromium
cp .env.example .env   # then fill in the credentials; .env is git-ignored
```

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
