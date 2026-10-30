// HUE webGUI automation for Big Data students (Administer Users), using Playwright.
//
// ⚠ NOT VERIFIED against the live UI yet: HUE on the edge node was down when this was written
// (2026-10-30). Paths and selectors follow HUE 4.11's user admin forms (Django form field ids).
// Record flows H0-H10 (docs/codegen-checklist.md) and run the HUE integration test before
// setting HUE_ENABLED=true.
//
// Manual (Step B2): Administer Users -> Add user, username + password twice, untick "Create home
// directory" (acc-prov-vm makes the HDFS home itself), Add user. Revoke = untick "Active" (D16).
//
// One HueSession = one login. A failed login is never retried.

import { chromium } from 'playwright';
import { assertNonEmpty, assertUsername } from './validate.js';

const LOGIN_PATH = '/hue/accounts/login?next=/';
const NEW_USER_PATH = '/hue/useradmin/users/new';
const editPath = (username) => `/hue/useradmin/users/edit/${username}`;
const FORM_ERRORS = '.errorlist li, .alert-error, .alert-danger';

export class HueError extends Error {}

export class HueLoginError extends HueError {}

export class HueUserExistsError extends HueError {}

export class HueUserNotFoundError extends HueError {}

export class HueSession {
  #browser;
  #page;
  #baseUrl;
  #log;

  constructor(browser, page, { baseUrl, log }) {
    this.#browser = browser;
    this.#page = page;
    this.#baseUrl = baseUrl;
    this.#log = log;
  }

  // config: loadHueConfig() result. log(event, fields) never receives passwords.
  static async open(config, { log = () => {}, timeoutMs = 20_000 } = {}) {
    const browser = await chromium.launch({ headless: config.headless ?? true });
    try {
      const page = await (await browser.newContext()).newPage();
      page.setDefaultTimeout(timeoutMs);
      const session = new HueSession(browser, page, { ...config, log });
      await session.#login(config.username, config.password);
      return session;
    } catch (err) {
      await browser.close();
      throw err;
    }
  }

  async #login(username, password) {
    const page = this.#page;
    await page.goto(`${this.#baseUrl}${LOGIN_PATH}`);
    await page.locator('input[name="username"]').fill(username);
    await page.locator('input[name="password"]').fill(password);
    await page.locator('input[name="password"]').press('Enter');
    await page.waitForLoadState('networkidle');
    if (new URL(page.url()).pathname.includes('/accounts/login')) {
      throw new HueLoginError('HUE login failed (check HUE_USER / HUE_PASSWORD and quoting in .env); not retrying');
    }
    this.#log('hue.login', { user: username });
  }

  async #goto(path) {
    await this.#page.goto(`${this.#baseUrl}${path}`);
    await this.#page.waitForLoadState('networkidle');
  }

  // Opens the user's edit page and checks it shows that user. -> false if there is no such user.
  async #openEdit(username) {
    await this.#goto(editPath(username));
    const field = this.#page.locator('#id_username');
    if (!(await field.count())) return false;
    const shown = await field.inputValue();
    if (shown !== username) throw new HueError(`edit page shows ${shown}, expected ${username}`);
    return true;
  }

  async #fillPasswords(password) {
    await this.#page.locator('#id_password1').fill(password);
    await this.#page.locator('#id_password2').fill(password);
  }

  async #submit(label) {
    const page = this.#page;
    await page.locator(`input[type="submit"][value="${label}"], button:has-text("${label}")`).first().click();
    await page.waitForLoadState('networkidle');
    const errors = (await page.locator(FORM_ERRORS).allTextContents()).map((e) => e.trim()).filter(Boolean);
    if (errors.length) throw new HueError(`HUE refused the form: ${errors.join(' | ')}`);
  }

  // -> { exists: false } | { exists: true, active }
  async getUserState(username) {
    assertUsername(username);
    if (!(await this.#openEdit(username))) return { exists: false };
    return { exists: true, active: await this.#page.locator('#id_is_active').isChecked() };
  }

  async createUser({ username, password }) {
    assertUsername(username);
    assertNonEmpty('password', password);
    if ((await this.getUserState(username)).exists) throw new HueUserExistsError(`HUE user already exists: ${username}`);
    const page = this.#page;
    await this.#goto(NEW_USER_PATH);
    await page.locator('#id_username').fill(username);
    await this.#fillPasswords(password);
    const home = page.locator('#id_ensure_home_directory');
    if (await home.count()) await home.setChecked(false);
    await this.#submit('Add user');
    const state = await this.getUserState(username);
    if (!state.exists || !state.active) throw new HueError(`created HUE user ${username} does not read back as active`);
    this.#log('hue.createUser', { user: username });
  }

  // New password and active again (a returning student, D15).
  async resetUser({ username, password }) {
    assertUsername(username);
    assertNonEmpty('password', password);
    if (!(await this.#openEdit(username))) throw new HueUserNotFoundError(`no such HUE user: ${username}`);
    await this.#fillPasswords(password);
    await this.#page.locator('#id_is_active').setChecked(true);
    await this.#submit('Update user');
    if (!(await this.getUserState(username)).active) throw new HueError(`${username} did not become active`);
    this.#log('hue.resetUser', { user: username });
  }

  // -> { changed }; a no-op if the user is already inactive.
  async deactivateUser(username) {
    const before = await this.getUserState(username);
    if (!before.exists) throw new HueUserNotFoundError(`no such HUE user: ${username}`);
    if (!before.active) return { changed: false };
    await this.#page.locator('#id_is_active').setChecked(false);
    await this.#submit('Update user');
    if ((await this.getUserState(username)).active) throw new HueError(`${username} did not become inactive`);
    this.#log('hue.deactivateUser', { user: username });
    return { changed: true };
  }

  async close() {
    await this.#browser.close();
  }
}

// Opens a session, runs fn(session), and always closes it.
export async function withHue(config, fn, opts) {
  const session = await HueSession.open(config, opts);
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}
