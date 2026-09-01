import prisma from '../lib/prisma.js';

export async function getUserByAccountId(account_id) {
  return prisma.user.findUnique({
    where: { account_id },
  });
}

export async function getUserById(user_id) {
  return prisma.user.findUnique({
    where: { id: user_id },
    include: { account: true },
  });
}

export async function createUserProfile(account_id, data) {
  const user = await prisma.user.create({
    data: {
      account_id,
      student_id: data.student_id,
      degree: data.degree,
      program: data.program,
      advisor_name: data.advisor_name,
    },
  });

  // Update account with phone number
  await prisma.account.update({
    where: { id: account_id },
    data: { phone_number: data.phone_number },
  });

  return user;
}

export async function updateUserProfile(user_id, account_id, data) {
  const user = await prisma.user.update({
    where: { id: user_id },
    data: {
      student_id: data.student_id,
      degree: data.degree,
      program: data.program,
      advisor_name: data.advisor_name,
    },
  });

  // Update account if phone number is provided
  if (data.phone_number) {
    await prisma.account.update({
      where: { id: account_id },
      data: { phone_number: data.phone_number },
    });
  }

  return user;
}
