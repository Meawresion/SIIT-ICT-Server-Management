// Renders a password as a PNG so it never appears as text in an email (searchable, previewed
// in notifications, scraped). Uses the Chromium that Playwright already installs for pfSense.
// This is obfuscation, not encryption: anyone who opens the email can still read it.

import { chromium } from 'playwright';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// -> PNG Buffer. opts.browser: reuse an already launched Playwright browser.
export async function renderPasswordImage(password, { browser } = {}) {
  if (typeof password !== 'string' || !password || /[\r\n]/.test(password)) throw new Error('invalid password to render');
  const own = browser ? null : await chromium.launch({ headless: true });
  const context = await (browser ?? own).newContext({ deviceScaleFactor: 2 });
  try {
    const page = await context.newPage();
    // No network access: the page is self-contained.
    await page.route('**/*', (route) => route.abort());
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff">
<div id="pw" style="display:inline-block;padding:14px 22px;border:2px solid #333;border-radius:8px;
font:600 28px/1.2 'DejaVu Sans Mono',Consolas,'Courier New',monospace;letter-spacing:4px;color:#111;
background:#fff">${escapeHtml(password)}</div></body></html>`);
    return await page.locator('#pw').screenshot({ type: 'png' });
  } finally {
    await context.close();
    await own?.close();
  }
}
