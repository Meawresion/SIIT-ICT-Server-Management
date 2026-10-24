# Playwright codegen recording checklist (pfSense + HUE)

Use this checklist to record each UI flow that acc-prov-vm needs. The recordings will be turned into the provisioner modules. `example-script.js` was never tested against the real UI, so these recordings replace it.

## Before you start

- Record from a PC on the SIIT LAN, or with the `ICT_SIIT` VPN connected.
- Use a **throwaway test user** that matches the naming pattern but can't be a real student, e.g. **`st9990000001`**. Use a second one (`st9990000002`) for the duplicate-user flows.
- Use a fake test password, e.g. `Test-Passw0rd-2026!`. Never record a real student's password.
- Write down the versions so the code can be pinned to them:
  - pfSense CE version: shown on the Dashboard under "System Information".
  - HUE version: `4.11.0`, shown at the bottom-left of the HUE menu.
- Record **one flow per file**:
  ```bash
  # pfSense (self-signed cert, so --ignore-https-errors is needed)
  npx playwright codegen --ignore-https-errors --target javascript \
    -o acc-prov-vm/recordings/pfsense-P3-create-user.js https://192.168.77.1:8443/

  # HUE
  npx playwright codegen --target javascript \
    -o acc-prov-vm/recordings/hue-H3-create-user.js http://192.168.77.65:8888/
  ```
- In the codegen window:
  - Use **"Pick locator"** on every field you touch, and on every success or error message.
  - Prefer the locators it suggests that use `getByLabel` or `getByRole`.
  - Before you click Save, use **"Assert visibility" / "Assert text"** on the field values.
- **After each recording:**
  - Replace the typed admin password with `process.env.PFSENSE_PASSWORD` or `process.env.HUE_PASSWORD`, and the test password with `process.env.TEST_PASSWORD`.
  - Do this *before* sharing the files with anyone, Claude included.
  - `acc-prov-vm/recordings/` is git-ignored locally (it is in `.git/info/exclude`).
- **Write down three things for each flow:**
  1. the URL after each step;
  2. what **success** looks like (a redirect, a green alert, the row appearing);
  3. what **failure** looks like (a red "input errors" box, a toast, and so on).

  Put them as comments at the top of each recording file.

---

## pfSense (`https://192.168.77.1:8443`, login `stuadmin`)

| ID | Flow | Steps to record | Capture |
|----|------|-----------------|---------|
| P0 | **Login** | 1. Open the base URL. 2. Fill in the username and password. 3. Click Sign In. | The locator that shows you are logged in (e.g. the Dashboard heading or the top menu). Also record a **wrong-password** attempt and capture the error text. |
| P1 | **Open User Manager** | Go to System → User Manager. | The direct URL (expected: `/system_usermanager.php`), so the code can go there directly. Check whether the users table **paginates** or shows every user on one page. |
| P2 | **Find a user / read state** | 1. In the list, find a row by username. 2. Click its edit (pencil) icon. | The row locator; the edit URL pattern (expected: `?act=edit&userid=N`); the locators for the **Disabled** checkbox, **Expiration date** and **Full name**. |
| P3 | **Create user + cert** (main flow) | 1. Click Add. 2. Username `st9990000001`. 3. Password twice. 4. Full name. 5. Expiration date (MM/DD/YYYY). 6. Tick "Click to create a user certificate". 7. Descriptive name `st9990000001`. 8. Certificate authority **`OpenVpn for remote access`**. 9. Key type RSA. 10. Key length 2048. 11. Digest sha256. 12. Lifetime 3650. 13. Click Save. | The locator of every field. The CA `<select>` and how its options are labelled. Where you land after Save, and the success indicator. |
| P4 | **Create a duplicate** | Repeat P3 with the **same** username. | The exact error text and where it appears. |
| P5 | **Invalid input** | Use a bad expiration date (e.g. `13/45/2026`), or passwords that don't match. Click Save. | The error box locator and its text. |
| P6 | **Extend expiration** | Edit the test user, change Expiration date, click Save. | Success indicator. Check the new date is shown when you reopen the user. |
| P7 | **Change password** | Edit the test user, type a new password twice, click Save. | Success indicator. Check: does leaving the password fields **blank** keep the old password? (Needed so other edits don't reset it.) |
| P8 | **Disable user** | Edit, tick "This user cannot login", click Save. | The checkbox locator. How a disabled user looks in the list (icon or greyed out). |
| P9 | **Re-enable user** | Edit, untick it, click Save. | Same as P8. |
| P10 | **Delete user** (test cleanup only) | Click the trash icon on the test user's row, then confirm. | Whether the confirm is a **browser dialog** (codegen will show `page.once('dialog', …)`) or an HTML modal. Also check whether the user's certificate is still listed under System → Certificates afterwards. |
| P11 | **Logout** | Click the logout icon (top right). | The locator. |

Clean up at the end: delete `st9990000001` and `st9990000002` and their certificates (System → Certificates).

---

## HUE (`http://192.168.77.65:8888`, login `stuadmin`)

| ID | Flow | Steps to record | Capture |
|----|------|-----------------|---------|
| H0 | **Login** | 1. Fill in the username and password. 2. Click Sign In. | The logged-in indicator. Also record a **wrong-password** attempt and capture its error. |
| H1 | **Open Administer Users** | Click the user menu (bottom-left) → Administer Users. | The direct URL (probably `/hue/useradmin/users`), so the code can go straight there. |
| H2 | **Search for a user** | Type `st9990000001` in "Search for name, group, etc…". | The row locator, and what "no match" looks like. |
| H3 | **Create user** (main flow) | 1. Click Add user. 2. Step 1: Username. 3. New Password. 4. Password confirmation. 5. **Untick "Create home directory"**. 6. Click **Add user**. Don't click Next. | Each field locator. The success indicator (back to the list? a toast?). Check that the user appears in the list. |
| H4 | **Create a duplicate** | Repeat H3 with the same username. | The exact error text and where it appears. |
| H5 | **Open a user** | Click the username in the list. | The edit URL pattern (probably `/hue/useradmin/users/edit/<username>`). |
| H6 | **Change password** | In the user edit form, set a new password twice, then save. | Which step or tab holds the password fields; the save button's label; the success indicator. |
| H7 | **Deactivate user** | Open the user, find the **"Active"** checkbox (probably under Step 3: Advanced), untick it, save. | The checkbox locator. What "Is active" shows in the list afterwards. |
| H8 | **Reactivate user** | Same as H7, but tick it. | Same as H7. |
| H9 | **Delete user** (test cleanup only) | Tick the checkbox on the test user's row, click Delete, confirm. | Whether the confirm is an HTML modal or a browser dialog. |
| H10 | **Logout** | User menu → Log Out. | The locator. |

---

## What the code will build from these recordings

| Function | pfSense flows | HUE flows |
|----------|---------------|-----------|
| `login()` | P0 | H0 |
| `getUserState(username)` → `missing` / `active` / `disabled` / `expired` | P1, P2 | H1, H2, H5 |
| `createUser({ username, password, fullName, expires })` | P3 (+ P4, P5 for errors) | H3 (+ H4) |
| `setExpiration(username, date)` | P6 | n/a |
| `setPassword(username, password)` | P7 | H6 |
| `disableUser(username)` / `enableUser(username)` | P8 / P9 | H7 / H8 |
| `deleteUser(username)` (later, if allowed) | P10 | H9 |
| `logout()` | P11 | H10 |

The most important flows are **P0–P3, P8, H0–H3 and H7**. With those, the end-to-end happy path and revoke both work. The rest cover re-requests (D15) and error handling.
