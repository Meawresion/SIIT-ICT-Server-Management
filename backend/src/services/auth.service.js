import prisma from '../lib/prisma.js';
import { verifyIdToken } from '../auth/google.js';

export async function findOrCreateAccount(google_data) {
  const account = await prisma.account.findUnique({
    where: { google_sub: google_data.sub },
  });

  if (account) {
    return account;
  }

  // Create new account
  const new_account = await prisma.account.create({
    data: {
      google_sub: google_data.sub,
      primary_email: google_data.email,
      full_name: google_data.name,
      phone_number: '', // Will be updated during profile completion
      active: true,
    },
  });

  return new_account;
}

export async function getAccountById(account_id) {
  return prisma.account.findUnique({
    where: { id: account_id },
    include: { user: true },
  });
}

export async function updateAccount(account_id, data) {
  return prisma.account.update({
    where: { id: account_id },
    data,
  });
}

export async function verifyTokenAndGetAccount(id_token) {
  const google_data = await verifyIdToken(id_token);
  const account = await findOrCreateAccount(google_data);
  return account;
}
