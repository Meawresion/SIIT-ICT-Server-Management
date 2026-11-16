import prisma from '../lib/prisma.js';
import { verifyIdToken } from '../auth/google.js';
import { accountView } from '../utils/db-mapping.js';
import { allowedHostedDomain, classifyEmail, loadIdentityRules, roleFor } from '../config/identity.js';
import { serviceRole } from '../config/env.js';

// Only the services that own the user table may write it (the request service and the
// provisioning service can only read users).
const WRITES_USERS = ['all', 'api', 'identity'];

// The account with the role that counts (APPROVER_EMAILS, see roleFor). The identity service also
// brings the role column up to date, which the other services and the approver emails read.
export async function withCurrentRole(row) {
  if (!row) return null;
  const role = roleFor(row);
  if (role === row.role) return row;
  if (WRITES_USERS.includes(serviceRole())) return prisma.user.update({ where: { uid: row.uid }, data: { role } });
  return { ...row, role };
}

export async function findOrCreateAccount(google_data) {
  // Verified Google email is the identity key in the new User table.
  const email = google_data.email.trim().toLowerCase();
  // Only SIIT student and staff Workspace accounts may sign in. Checked before any row exists.
  const rules = loadIdentityRules();
  if (!classifyEmail(email, rules) || !allowedHostedDomain(google_data.hd, rules)) {
    throw Object.assign(new Error('This Google account is not allowed to sign in'), { statusCode: 403, code: 'SIGNIN_NOT_ALLOWED' });
  }
  const user = await prisma.user.upsert({
    where: { siitemail: email },
    update: {},
    create: { siitemail: email, fullname: (google_data.name || email).slice(0, 100), phone_number: '', role: 'Student' },
  });
  return accountView(await withCurrentRole(user));
}
export async function getAccountById(account_id) {
  return accountView(await withCurrentRole(await prisma.user.findUnique({ where: { uid: account_id } })));
}
export async function updateAccount(account_id, data) {
  return accountView(await prisma.user.update({ where: { uid: account_id }, data: {
    ...(data.phone_number !== undefined && { phone_number: data.phone_number }),
    ...(data.full_name !== undefined && { fullname: data.full_name }),
  } }));
}
export async function verifyTokenAndGetAccount(id_token) {
  return findOrCreateAccount(await verifyIdToken(id_token));
}
