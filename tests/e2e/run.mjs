// Frontend end-to-end tests (Playwright). The API is replaced by mockapi.mjs, so these test the
// React app's behaviour against the documented API responses, not the backend itself.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createMockApi } from './mockapi.mjs';

const BASE = 'http://localhost:4180';
const OUT = process.argv[2] || './out';
mkdirSync(`${OUT}/shots`, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const results = [];
let api;
let page;
let ctx;

async function fresh(viewport = { width: 1366, height: 850 }) {
  if (ctx) await ctx.close();
  api = createMockApi();
  ctx = await browser.newContext({ viewport, acceptDownloads: true });
  page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    let body = null;
    try { body = req.postDataJSON(); } catch { body = null; }
    const res = api.handle(req.method(), new URL(req.url()).pathname + new URL(req.url()).search, body);
    await route.fulfill(res);
  });
  await page.route('https://accounts.google.com/**', (route) => route.fulfill({ status: 200, body: 'google', headers: { 'content-type': 'text/plain' } }));
}

async function test(id, fr, name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ id, fr, name, result: 'Pass', ms: Date.now() - t0 });
    console.log('PASS', id, name);
  } catch (err) {
    results.push({ id, fr, name, result: 'Fail', ms: Date.now() - t0, error: String(err.message).split('\n')[0] });
    console.log('FAIL', id, name, String(err.message).split('\n')[0]);
    try { await page.screenshot({ path: `${OUT}/shots/FAIL-${id}.png` }); } catch { /* ignore */ }
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const shot = (n) => page.screenshot({ path: `${OUT}/shots/${n}.png` });
const signIn = async (who) => { api.state.session = who; await page.goto(`${BASE}/dashboard`); await page.waitForLoadState('networkidle'); };
const fillProfile = async () => {
  await page.getByLabel(/Program\/Department/).fill('Digital Engineering');
  await page.getByLabel(/Primary Advisor/).fill('Dr. Pakinee Aimmanee');
  await page.getByLabel(/Contact Phone/).fill('0812345678');
};
const fillRequest = async (title) => {
  await page.getByLabel(/Project Title/).fill(title);
  await page.getByLabel(/Brief Project\/Task Description/).fill('Train a segmentation model for retinal images.');
  await page.getByLabel(/Supervisor or Course Instructor/).fill('Dr. Pakinee Aimmanee');
  await page.getByLabel(/Resource Type/).selectOption('HPC_GPU');
  await page.getByLabel(/Justification/).fill('The model does not fit in laptop GPU memory.');
  await page.getByLabel('Start date').fill('2026-12-01');
  await page.getByLabel('End date').fill('2027-01-31');
  await page.getByLabel(/supervisor is aware/i).check();
};

await fresh();
await test('TC-01', 'FR-1.1', 'Landing page opens Google sign-in', async () => {
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  await shot('01-landing');
  await page.getByRole('button', { name: /Sign in with Google/i }).click();
  await page.waitForURL(/accounts\.google\.com/, { timeout: 5000 });
  expect(api.state.calls.includes('GET /api/auth/google'), 'auth URL not requested');
});

await fresh();
await test('TC-02', 'FR-1.3', 'Signed-out visitor is sent back to the landing page', async () => {
  await page.goto(`${BASE}/home`);
  await page.waitForURL(`${BASE}/`, { timeout: 5000 });
});

await fresh();
await test('TC-03', 'FR-2.1', 'First sign-in requires a complete profile', async () => {
  await signIn('student');
  await page.waitForURL(/\/profile$/, { timeout: 5000 });
  await shot('02-profile-setup');
  await page.getByRole('button', { name: /Save and continue/i }).click();
  expect(await page.locator('.field-error').count() > 0, 'no validation errors shown');
  await fillProfile();
  await page.getByRole('button', { name: /Save and continue/i }).click();
  await page.waitForURL(/\/home$/, { timeout: 5000 });
  await page.locator('tr', { hasText: 'Traffic Flow Analysis' }).first().waitFor({ timeout: 5000 });
  await shot('03-student-home');
});

await test('TC-04', 'FR-3.6', 'Empty request form is not submitted and shows field errors', async () => {
  const before = api.state.requests.length;
  await page.getByRole('button', { name: /New Request/i }).click();
  await shot('04-request-form');
  await page.getByRole('button', { name: /Submit Request/i }).click();
  expect(await page.locator('.field-error').count() >= 4, 'expected field errors');
  expect(api.state.requests.length === before, 'request was sent');
  await shot('05-request-form-errors');
});

await test('TC-05', 'FR-3.2', 'Save a draft and load it again', async () => {
  await page.getByLabel(/Project Title/).fill('Draft: Retina Segmentation');
  await page.getByRole('button', { name: /Save Draft/i }).click();
  await page.getByRole('button', { name: 'Close' }).first().click();
  await page.getByRole('button', { name: /Load Draft/i }).click();
  await shot('06-load-draft');
  await page.locator('.draft-list button').first().click();
  expect((await page.getByLabel(/Project Title/).inputValue()) === 'Draft: Retina Segmentation', 'draft not loaded');
  expect(api.state.calls.includes('POST /api/drafts') && api.state.drafts.length === 1, 'draft not saved on the server');
});

await test('TC-06', 'FR-3.4', 'Submit a complete request; it is listed as Pending', async () => {
  await fillRequest('Retina Segmentation');
  await page.getByRole('button', { name: /Submit Request/i }).click();
  await page.getByText('Submitted!').waitFor({ timeout: 5000 });
  await shot('07-submitted');
  await page.getByRole('button', { name: 'OK' }).click();
  await page.waitForLoadState('networkidle');
  const row = page.locator('tr', { hasText: 'Retina Segmentation' }).first();
  expect((await row.innerText()).includes('Pending'), 'row not pending');
  expect(api.state.calls.includes('POST /api/requests'), 'no POST');
  expect(api.state.drafts.length === 0, 'the submitted draft was not deleted');
  await shot('08-home-after-submit');
});

await test('TC-07', 'FR-3.5', 'A pending request can be edited', async () => {
  await page.locator('tr', { hasText: 'Retina Segmentation' }).first().getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel(/Project Title/).fill('Retina Segmentation v2');
  await page.getByRole('button', { name: /Save Changes/i }).click();
  await page.waitForLoadState('networkidle');
  await page.locator('tr', { hasText: 'Retina Segmentation v2' }).first().waitFor({ timeout: 5000 });
});

await test('TC-08', 'FR-4.2', 'A reviewed request shows the approver comment', async () => {
  await page.locator('tr', { hasText: 'LLM Fine-tuning' }).first().getByRole('button', { name: 'View' }).click();
  await page.getByText('Please narrow the scope first.').waitFor({ timeout: 5000 });
  await shot('09-view-rejected');
  await page.keyboard.press('Escape');
});

await test('TC-09', 'FR-1.3', 'A student cannot open the approver page', async () => {
  await page.goto(`${BASE}/admin`);
  await page.waitForURL(/\/home$/, { timeout: 5000 });
});

await test('TC-10', 'FR-2.3', 'Student edits own profile', async () => {
  await page.getByRole('link', { name: 'Account' }).click();
  await page.waitForLoadState('networkidle');
  await shot('10-account');
  await page.getByRole('button', { name: /Edit/ }).first().click();
  await page.getByLabel(/Contact Phone/).fill('0899999999');
  await page.getByRole('button', { name: /Save changes/i }).click();
  await page.waitForLoadState('networkidle');
  expect(api.state.profile.phone_number === '0899999999', 'phone not saved');
});

await fresh();
await test('TC-11', 'FR-5.1', 'Approver home lists pending and active requests', async () => {
  api.state.profile = { id: '1', kind: 'student', student_id: '6622780000', degree: 'UNDERGRADUATE', program: 'Digital Engineering', advisor_name: 'Dr. Pakinee Aimmanee', phone_number: '0812345678' };
  api.state.requests.unshift({ id: 3, purpose: 'Retina Segmentation', project_description: 'Train a segmentation model.', project_supervisor_name: 'Dr. Pakinee Aimmanee', resource_type: 'HPC_GPU', justification: 'Needs a GPU.', technical_requirements: '24 GB GPU memory', estimated_start_date: '2026-12-01T00:00:00.000Z', estimated_end_date: '2027-01-31T00:00:00.000Z', impact_score: 8, supervisor_confirmation: 'CONFIRMED', status: 'PENDING', review_comment: null, reviewed_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), extension: null });
  await signIn('approver');
  await page.waitForURL(/\/admin$/, { timeout: 5000 });
  await page.waitForLoadState('networkidle');
  await page.getByText('Pending Requests').waitFor();
  await page.locator('tr', { hasText: 'Retina Segmentation' }).first().waitFor({ timeout: 5000 });
  await shot('11-approver-home');
});

await test('TC-12', 'FR-5.4', 'Approve without a comment is blocked', async () => {
  await page.locator('tr', { hasText: 'Retina Segmentation' }).first().getByRole('button', { name: /Review/ }).click();
  await page.waitForLoadState('networkidle');
  await shot('12-review-modal');
  await page.getByRole('button', { name: /^Approve/ }).click();
  expect(await page.locator('.field-error').count() > 0, 'no comment error');
  expect(!api.state.calls.some((c) => c.endsWith('/approve')), 'approve was sent');
});

await test('TC-13', 'FR-5.3', 'Approve with a comment changes the status to Approved', async () => {
  await page.getByLabel(/Comment to the student/).fill('Approved for one semester on the A40.');
  await Promise.all([page.waitForResponse((r) => r.url().endsWith('/approve')), page.getByRole('button', { name: /^Approve/ }).click()]);
  await page.waitForLoadState('networkidle');
  expect(api.state.requests.find((r) => r.id === 3).status === 'APPROVED', 'not approved');
  await shot('13-after-approve');
});

await test('TC-14', 'FR-9.3', 'Approver exports requests as CSV', async () => {
  await page.getByRole('link', { name: 'Request History' }).click();
  await page.waitForLoadState('networkidle');
  await page.getByText('Export CSV').click();
  await shot('14-export');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.getByRole('button', { name: 'Download' }).click()]);
  expect((await dl.suggestedFilename()).endsWith('.csv'), 'not a csv');
});

await fresh({ width: 390, height: 844 });
await test('TC-15', 'NFR-5.1', 'Phone width: no horizontal scrolling', async () => {
  api.state.profile = { id: '1', kind: 'student', student_id: '6622780000', degree: 'UNDERGRADUATE', program: 'Digital Engineering', advisor_name: 'Dr. Pakinee Aimmanee', phone_number: '0812345678' };
  await signIn('student');
  await page.waitForURL(/\/home$/, { timeout: 5000 });
  await page.waitForLoadState('networkidle');
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  await shot('15-mobile-home');
  expect(w <= 390, `scrollWidth ${w}`);
});

await fresh();
await test('TC-16', 'FR-1.4', 'An ended session returns the user to sign-in', async () => {
  api.state.profile = { id: '1', kind: 'student', student_id: '6622780000', degree: 'UNDERGRADUATE', program: 'Digital Engineering', advisor_name: 'Dr. Pakinee Aimmanee', phone_number: '0812345678' };
  await signIn('student');
  await page.waitForURL(/\/home$/, { timeout: 5000 });
  api.state.session = null; // the token expired
  await page.getByRole('link', { name: 'Request History' }).click();
  await page.waitForURL(`${BASE}/`, { timeout: 8000 });
});

await browser.close();
writeFileSync(`${OUT}/results.json`, JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
const failed = results.filter((r) => r.result !== 'Pass').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
