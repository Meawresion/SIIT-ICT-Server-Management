import { z } from 'zod';
import prisma from '../lib/prisma.js';

const EmailSchema = z.string().trim().toLowerCase().email().max(100);
const RoleSchema = z.enum(['Approver', 'Student']);

// Administrative operation available only through the server CLI, not the API.
export async function setUserRoleByEmail(email, role, db = prisma) {
  const siitemail = EmailSchema.parse(email);
  const validatedRole = RoleSchema.parse(role);
  const result = await db.user.updateMany({
    where: { siitemail },
    data: { role: validatedRole },
  });
  if (!result.count) {
    throw new Error('No account found for this email. Ask the person to sign in with Google first.');
  }
  return { email: siitemail, role: validatedRole };
}
