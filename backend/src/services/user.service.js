import prisma from '../lib/prisma.js';
import { degreeToDb, profileComplete, userView } from '../utils/db-mapping.js';

export async function getUserByAccountId(account_id) {
  const row = await prisma.user.findUnique({ where: { uid: account_id } });
  return profileComplete(row) ? userView(row) : null;
}
export async function getUserById(user_id) {
  return userView(await prisma.user.findUnique({ where: { uid: user_id } }));
}
// A student profile, or a staff one (department, no student fields: they are cleared).
function profileData(data) {
  if (data.department !== undefined) {
    return { fullname: data.full_name, s_id: null, study_degree: null, s_program: data.department, advisor_name: null, phone_number: data.phone_number };
  }
  return { fullname: data.full_name, s_id: data.student_id, study_degree: degreeToDb[data.degree], s_program: data.program, advisor_name: data.advisor_name, phone_number: data.phone_number };
}
export async function createUserProfile(account_id, data) {
  return userView(await prisma.user.update({ where: { uid: account_id, role: 'Student' }, data: profileData(data) }));
}
export async function updateUserProfile(user_id, account_id, data) {
  return userView(await prisma.user.update({ where: { uid: user_id, AND: { uid: account_id }, role: 'Student' }, data: profileData(data) }));
}
