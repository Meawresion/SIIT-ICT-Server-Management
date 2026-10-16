import prisma from '../src/lib/prisma.js';
import { setUserRoleByEmail } from '../src/services/role.service.js';

try {
  const [email, role, ...extra] = process.argv.slice(2);
  if (!email || !role || extra.length) {
    throw new Error('Usage: npm run user:role -- person@siit.tu.ac.th Approver|Student');
  }
  const result = await setUserRoleByEmail(email, role);
  console.log(`Set ${result.email} to ${result.role}. Access updates on their next request.`);
} catch (err) {
  console.error(err.name === 'ZodError'
    ? 'Provide a valid email and one of these roles: Approver, Student.'
    : err.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
