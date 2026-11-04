import prisma from '../src/lib/prisma.js';
import { setUserRoleByEmail } from '../src/services/role.service.js';
import { approverEmails } from '../src/config/identity.js';

try {
  const [email, role, ...extra] = process.argv.slice(2);
  if (!email || !role || extra.length) {
    throw new Error('Usage: npm run user:role -- person@siit.tu.ac.th Approver|Student');
  }
  const result = await setUserRoleByEmail(email, role);
  console.log(`Set ${result.email} to ${result.role}. Access updates on their next request.`);
  // With APPROVER_EMAILS set, the list decides (config/identity.js roleFor); this column follows it.
  if (approverEmails()) {
    console.warn('APPROVER_EMAILS is set, so it decides who is an approver: this change is undone at their next sign-in. Edit APPROVER_EMAILS instead.');
  }
} catch (err) {
  console.error(err.name === 'ZodError'
    ? 'Provide a valid email and one of these roles: Approver, Student.'
    : err.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
