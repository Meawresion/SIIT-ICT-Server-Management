import prisma from '../lib/prisma.js';
import { degreeToDb, profileComplete, userView } from '../utils/db-mapping.js';

export async function getUserByAccountId(account_id) {
  const row = await prisma.user.findUnique({ where: { uid: account_id } });
  return profileComplete(row) ? userView(row) : null;
}
export async function getUserById(user_id) {
  return userView(await prisma.user.findUnique({ where: { uid: user_id } }));
}
function profileData(data) {
  return { s_id: data.student_id, study_degree: degreeToDb[data.degree], s_program: data.program, advisor_name: data.advisor_name, phone_number: data.phone_number };
}
export async function createUserProfile(account_id, data) {
  return userView(await prisma.user.update({ where: { uid: account_id, role: 'Student' }, data: profileData(data) }));
}
export async function updateUserProfile(user_id, account_id, data) {
  return userView(await prisma.user.update({ where: { uid: user_id, AND: { uid: account_id }, role: 'Student' }, data: profileData(data) }));
}
