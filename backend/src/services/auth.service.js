import prisma from '../lib/prisma.js';
import { verifyIdToken } from '../auth/google.js';
import { accountView } from '../utils/db-mapping.js';

export async function findOrCreateAccount(google_data) {
  // Verified Google email is the identity key in the new User table.
  const email = google_data.email.trim().toLowerCase();
  const user = await prisma.user.upsert({
    where: { siitemail: email },
    update: {},
    create: { siitemail: email, fullname: (google_data.name || email).slice(0, 100), phone_number: '', role: 'Student' },
  });
  return accountView(user);
}
export async function getAccountById(account_id) {
  return accountView(await prisma.user.findUnique({ where: { uid: account_id } }));
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
