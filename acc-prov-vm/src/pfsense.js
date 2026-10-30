// pfSense webGUI automation for VPN accounts (System > User Manager), using Playwright.
//
// Selectors and behaviour were verified on the live pfSense CE UI on 2026-10-24:
// - Login always lands on the Dashboard, whatever URL was requested.
// - `userid` in `?act=edit&userid=N` is the row index and shifts when a user above is deleted,
//   so rows are always looked up by exact username and the edit page is re-checked.
// - #usernamefld is editable on the edit page: never fill it there.
// - Impossible dates roll over (11/31 -> 12/01): dates are validated before sending.
// - A blank password on edit keeps the old password.
// - Failed logins count towards Login Protection: a failed login is never retried.
//
// One PfSenseSession = one login. Run every step of a job inside one session, one job at a time.

import { chromium } from 'playwright';
import { assertIsoDate, assertNonEmpty, assertUsername } from './validate.js';

const USERS_PATH = '/system_usermanager.php';
const LOGOUT = '#pf-navbar a[href="/index.php?logout"]:visible';

export class PfSenseError extends Error {}

export class PfSenseLoginError extends PfSenseError {}

export class PfSenseInputError extends PfSenseError {
  constructor(errors) {
    super(`pfSense input errors: ${errors.join(' | ')}`);
    this.errors = errors;
  }
}

export class PfSenseUserExistsError extends PfSenseError {}

export class PfSenseUserNotFoundError extends PfSenseError {}

// The edit page shows a different account than the one requested.
export class PfSenseIdentityError extends PfSenseError {}

// 'YYYY-MM-DD' -> 'MM/DD/YYYY'
export function toPfDate(iso) {
  assertIsoDate(iso);
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

// 'MM/DD/YYYY' -> 'YYYY-MM-DD'; empty -> null (no expiration).
export function fromPfDate(value) {
  if (!value) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!m) throw new PfSenseError(`unexpected expiration format: ${JSON.stringify(value)}`);
  return `${m[3]}-${m[1]}-${m[2]}`;
}

export class PfSenseSession {
  #browser;
  #page;
  #baseUrl;
  #caName;
  #cert;
  #log;

  constructor(browser, page, { baseUrl, caName, cert, log }) {
    this.#browser = browser;
    this.#page = page;
    this.#baseUrl = baseUrl;
    this.#caName = caName;
    this.#cert = cert;
    this.#log = log;
  }

  // config: loadPfSenseConfig() result. log(event, fields) never receives passwords.
  static async open(config, { log = () => {}, timeoutMs = 15_000 } = {}) {
    const browser = await chromium.launch({ headless: config.headless ?? true });
    try {
      // pfSense uses a self-signed certificate on the internal LAN.
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      page.setDefaultTimeout(timeoutMs);
      const session = new PfSenseSession(browser, page, { ...config, log });
      await session.#login(config.username, config.password);
      return session;
    } catch (err) {
      await browser.close();
      throw err;
    }
  }

  async #login(username, password) {
    const page = this.#page;
    await page.goto(this.#baseUrl);
    await page.locator('#usernamefld').fill(username);
    await page.locator('#passwordfld').fill(password);
    await page.locator('input[name="login"]').click();
    await page.waitForLoadState('domcontentloaded');
    if (await page.locator('#passwordfld').count()) {
      const rejected = await page.getByRole('heading', { name: 'Username or Password incorrect' }).count();
      throw new PfSenseLoginError(
        `pfSense login failed${rejected ? ': username or password incorrect (check quoting in .env)' : ''}; ` +
          'not retrying (Login Protection)',
      );
    }
    await page.locator(LOGOUT).waitFor();
    this.#log('pfsense.login', { user: username });
  }

  async #gotoUsers() {
    await this.#page.goto(`${this.#baseUrl}${USERS_PATH}`);
  }

  #row(username) {
    const page = this.#page;
    // The cell starts with a Font Awesome glyph, so allow leading non-word characters only.
    const exact = new RegExp(`^[^A-Za-z0-9_]*${username}\\s*$`);
    return page.locator('table tbody tr').filter({
      has: page.locator('td:nth-child(2)', { hasText: exact }),
    });
  }

  // Opens the user's edit page and checks it shows that user (and fullName, if given).
  // Returns false if the user does not exist.
  async #openEdit(username, { fullName } = {}) {
    const page = this.#page;
    await this.#gotoUsers();
    const row = this.#row(username);
    const n = await row.count();
    if (n === 0) return false;
    if (n > 1) throw new PfSenseError(`more than one row for ${username}`);

    const href = await row.locator('a.fa-pencil').getAttribute('href');
    await page.goto(new URL(href, page.url()).href);

    const shownUser = await page.locator('#usernamefld').inputValue();
    if (shownUser !== username) {
      throw new PfSenseIdentityError(`edit page shows ${shownUser}, expected ${username}`);
    }
    if (fullName !== undefined) {
      const shownName = await page.locator('#descr').inputValue();
      if (shownName !== fullName) {
        throw new PfSenseIdentityError(`full name on the edit page does not match for ${username}`);
      }
    }
    return true;
  }

  async #save() {
    const page = this.#page;
    await page.locator('#save').click();
    await page.waitForLoadState('domcontentloaded');
    const errors = await page.locator('.alert-danger li').allTextContents();
    if (errors.length) throw new PfSenseInputError(errors.map((e) => e.trim()));
    const url = new URL(page.url());
    if (url.pathname !== USERS_PATH || url.search.includes('act=')) {
      throw new PfSenseError(`save did not return to the user list (at ${url.pathname}${url.search})`);
    }
  }

  async #fillPasswords(password) {
    await this.#page.locator('#passwordfld1').fill(password);
    await this.#page.locator('#passwordfld2').fill(password);
  }

  async #requireEdit(username, opts) {
    if (!(await this.#openEdit(username, opts))) {
      throw new PfSenseUserNotFoundError(`no such pfSense user: ${username}`);
    }
  }

  // -> { exists: false } | { exists: true, disabled, expires: 'YYYY-MM-DD' | null, fullName }
  async getUserState(username) {
    assertUsername(username);
    if (!(await this.#openEdit(username))) return { exists: false };
    const page = this.#page;
    return {
      exists: true,
      disabled: await page.locator('#disabled').isChecked(),
      expires: fromPfDate(await page.locator('#expires').inputValue()),
      fullName: await page.locator('#descr').inputValue(),
    };
  }

  // Creates the VPN user with a user certificate signed by the configured CA.
  async createUser({ username, password, fullName, expires }) {
    assertUsername(username);
    assertNonEmpty('password', password);
    assertNonEmpty('fullName', fullName);
    const pfExpires = toPfDate(expires);

    if ((await this.getUserState(username)).exists) {
      throw new PfSenseUserExistsError(`pfSense user already exists: ${username}`);
    }

    const page = this.#page;
    await page.goto(`${this.#baseUrl}${USERS_PATH}?act=new`);
    await page.locator('#usernamefld').fill(username);
    await this.#fillPasswords(password);
    await page.locator('#descr').fill(fullName);
    await page.locator('#expires').fill(pfExpires);
    await page.locator('#showcert').check();
    await page.locator('#name').fill(username);
    await page.locator('#caref').selectOption({ label: this.#caName });
    await page.locator('#keytype').selectOption(this.#cert.keytype);
    await page.locator('#keylen').selectOption(this.#cert.keylen);
    await page.locator('#digest_alg').selectOption(this.#cert.digest);
    await page.locator('#lifetime').fill(this.#cert.lifetimeDays);
    await this.#save();

    const state = await this.getUserState(username);
    if (!state.exists || state.disabled || state.expires !== expires || state.fullName !== fullName) {
      throw new PfSenseError(`created user ${username} does not read back as expected`);
    }
    this.#log('pfsense.createUser', { user: username, expires });
  }

  // Changes the password only after the edit page shows both the username and the full name.
  async setPassword({ username, fullName, password }) {
    assertUsername(username);
    assertNonEmpty('fullName', fullName);
    assertNonEmpty('password', password);
    await this.#requireEdit(username, { fullName });
    await this.#fillPasswords(password);
    await this.#save();
    this.#log('pfsense.setPassword', { user: username });
  }

  // fullName (optional): checked on the edit page first, like setPassword.
  async setExpiration({ username, expires, fullName }) {
    assertUsername(username);
    const pfExpires = toPfDate(expires);
    await this.#requireEdit(username, { fullName });
    await this.#page.locator('#expires').fill(pfExpires);
    await this.#save();
    if ((await this.getUserState(username)).expires !== expires) {
      throw new PfSenseError(`expiration for ${username} does not read back as ${expires}`);
    }
    this.#log('pfsense.setExpiration', { user: username, expires });
  }

  disableUser(username) {
    return this.#setDisabled(username, true);
  }

  enableUser(username) {
    return this.#setDisabled(username, false);
  }

  // -> { changed: boolean }; a no-op if the user is already in that state.
  async #setDisabled(username, disabled) {
    assertUsername(username);
    const before = await this.getUserState(username);
    if (!before.exists) throw new PfSenseUserNotFoundError(`no such pfSense user: ${username}`);
    if (before.disabled === disabled) return { changed: false };

    // getUserState left the page on this user's verified edit page.
    await this.#page.locator('#disabled').setChecked(disabled);
    await this.#save();
    if ((await this.getUserState(username)).disabled !== disabled) {
      throw new PfSenseError(`${username} did not become ${disabled ? 'disabled' : 'enabled'}`);
    }
    this.#log(disabled ? 'pfsense.disableUser' : 'pfsense.enableUser', { user: username });
    return { changed: true };
  }

  // Admin only (scripts/cleanup-user.js): the worker never deletes (D16). Deletes only after the
  // edit page shows both the username and the full name. The trash link, its confirm() dialog and
  // the alert text come from the recorded delete flow (P10); it had not run live when this was
  // written. The user's certificate stays in Cert Manager.
  async deleteUser({ username, fullName }) {
    assertUsername(username);
    assertNonEmpty('fullName', fullName);
    await this.#requireEdit(username, { fullName });
    const page = this.#page;
    await this.#gotoUsers();
    const row = this.#row(username);
    if ((await row.count()) !== 1) throw new PfSenseError(`expected one row for ${username}`);
    page.once('dialog', (dialog) => dialog.accept());
    await row.locator('a.fa-trash-can').click();
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('alert').filter({ hasText: `Successfully deleted user: ${username}` }).waitFor();
    await this.#gotoUsers();
    if (await this.#row(username).count()) throw new PfSenseError(`${username} is still listed after the delete`);
    this.#log('pfsense.deleteUser', { user: username });
  }

  // Logs out (best effort) and always closes the browser.
  async close() {
    try {
      await this.#page.locator(LOGOUT).click({ timeout: 5_000 });
    } catch {
      // The browser is closed below either way.
    } finally {
      await this.#browser.close();
    }
  }
}

// Opens a session, runs fn(session), and always closes it.
export async function withPfSense(config, fn, opts) {
  const session = await PfSenseSession.open(config, opts);
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}
