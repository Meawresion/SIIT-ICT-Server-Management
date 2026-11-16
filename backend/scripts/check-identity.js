// Integration check of the identity service's database work, in an identity task:
//   run-task.sh --identity node scripts/check-identity.js [<marker>]
// 1. Sign-in, profile and role change on one rollback-only transaction (nothing stays): by hand
//    (set-user-role), and from APPROVER_EMAILS (promoted, then removed); a staff member's profile.
// 2. The identity database user has exactly its rights (check-grants.js).
// 3. With a marker: adds the accounts the other checks use (check-db, check-provisioning and
//    check-scheduler run in the request service, whose user may only read accounts), named
//    "Check <name> <marker>". They stay behind, so use a marker only on a throwaway database:
//      a student for each check (db, provisioning, scheduler), with a student address and an ID
//      that starts with zeros (SIIT doesn't issue those), so their status emails are sent
//      (the smoke test checks they reach the notification Lambda);
//      an approver at approver-<marker>@check.invalid.
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import prisma from '../src/lib/prisma.js';
import { loadIdentityRules } from '../src/config/identity.js';
import { setUserRoleByEmail } from '../src/services/role.service.js';
import { findOrCreateAccount, getAccountById } from '../src/services/auth.service.js';
import { createUserProfile, getUserByAccountId } from '../src/services/user.service.js';
import { checkGrants } from './check-grants.js';

const CHECK_STUDENTS = ['db', 'provisioning', 'scheduler'];
const marker = process.argv[2];
// Sign-in only accepts student and staff addresses, so the check uses a student address
// built from those settings. Its ID starts with zeros, which SIIT doesn't issue.
const rules = loadIdentityRules();
const prefixes = JSON.parse(process.env.DEGREE_EMAIL_PREFIXES);
const prefix = prefixes.UNDERGRADUATE ?? Object.values(prefixes)[0];
const email = `${prefix}${String(randomInt(10 ** 6)).padStart(rules.digits, '0')}@${rules.studentDomain}`;
const staffEmail = `check-${randomInt(10 ** 6)}@${rules.staffDomains[0]}`;
// The task's APPROVER_EMAILS doesn't list the check accounts: start by hand, set it per step below.
delete process.env.APPROVER_EMAILS;
const rollback = new Error('Intentional test rollback');
const originalTransaction = prisma.$transaction.bind(prisma);
const restores = [];
try {
  if (marker !== undefined && !/^[a-z0-9]{4,20}$/.test(marker)) throw new Error('The marker must be 4-20 lowercase letters or digits');
  await originalTransaction(async tx => {
    // Run the real services against one isolated, rollback-only transaction.
    for (const method of ['upsert', 'findUnique', 'update']) {
      const original = prisma.user[method];
      restores.push(() => { prisma.user[method] = original; });
      prisma.user[method] = (...args) => tx.user[method](...args);
    }
    const account = await findOrCreateAccount({ email, hd: rules.studentDomain, name: 'Integration check' });
    assert.equal(await getUserByAccountId(account.id), null);
    await createUserProfile(account.id, { student_id: 'TEST123', degree: 'DOCTORAL', program: 'ICT', phone_number: '0000000000' });
    assert.equal((await getUserByAccountId(account.id)).degree, 'DOCTORAL');
    await setUserRoleByEmail(email, 'Approver', tx);
    assert.equal((await tx.user.findUnique({ where: { uid: account.id } })).role, 'Approver');
    await setUserRoleByEmail(email, 'Student', tx);
    assert.equal((await tx.user.findUnique({ where: { uid: account.id } })).role, 'Student');
    // APPROVER_EMAILS decides: on it, the account is an approver and the column follows; off it, not.
    process.env.APPROVER_EMAILS = email;
    assert.equal((await getAccountById(account.id)).role, 'Approver');
    assert.equal((await tx.user.findUnique({ where: { uid: account.id } })).role, 'Approver');
    process.env.APPROVER_EMAILS = staffEmail;
    assert.equal((await getAccountById(account.id)).role, 'Student');
    assert.equal((await tx.user.findUnique({ where: { uid: account.id } })).role, 'Student');
    delete process.env.APPROVER_EMAILS;
    // A staff member who isn't an approver requests resources with a staff profile.
    const staff = await findOrCreateAccount({ email: staffEmail, hd: rules.staffDomains[0], name: 'Integration check staff' });
    assert.equal(staff.role, 'Student');
    await createUserProfile(staff.id, { full_name: 'Integration check staff', department: 'ICT', phone_number: '0000000000' });
    const staffProfile = await getUserByAccountId(staff.id);
    assert.equal(staffProfile.kind, 'staff');
    assert.equal(staffProfile.department, 'ICT');
    assert.equal(staffProfile.student_id, null);
    throw rollback;
  }, { timeout: 30000 });
} catch (err) {
  if (err !== rollback) { console.error(err.message); process.exitCode = 1; }
} finally {
  for (const restore of restores.reverse()) restore();
}
try {
  if (!process.exitCode) {
    assert.equal(await prisma.user.findUnique({ where: { siitemail: email } }), null);
    assert.equal(await prisma.user.findUnique({ where: { siitemail: staffEmail } }), null);
    const problems = await checkGrants(prisma, process.env.SERVICE_ROLE ?? 'all');
    if (problems.length) throw new Error(`Grants: ${problems.join('; ')}`);
    console.log(`Identity integration passed: sign-in, profile, role change by hand and from APPROVER_EMAILS, a staff profile, all rolled back; its database user (${process.env.DB_USER}) has exactly its rights.`);
    if (marker) {
      for (const name of CHECK_STUDENTS) {
        const sid = String(randomInt(10 ** 6)).padStart(rules.digits, '0');
        await prisma.user.create({ data: { role: 'Student', fullname: `Check ${name} ${marker}`, siitemail: `${prefixes.MASTER ?? prefix}${sid}@${rules.studentDomain}`,
          phone_number: '0', s_id: sid, study_degree: 'Master', s_program: 'ICT' } });
      }
      await prisma.user.create({ data: { role: 'Approver', fullname: `Check approver ${marker}`, siitemail: `approver-${marker}@check.invalid`, phone_number: '0' } });
      console.log(`Added the check accounts for marker ${marker}: ${CHECK_STUDENTS.join(', ')} and an approver`);
    }
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
