import { getUserByAccountId, createUserProfile, updateUserProfile } from '../services/user.service.js';
import { getAccountById, updateAccount } from '../services/auth.service.js';
import { ApproverProfileSchema, StaffProfileSchema, UserProfileSchema } from '../utils/validation.js';
import { classifyEmail, loadIdentityRules } from '../config/identity.js';

// A requester's profile fields. For a student, the ID and degree come from the SIIT email (D25),
// never from the client; a staff member has a department instead.
const profileView = (user) => ({
  id: user.id.toString(),
  kind: user.kind,
  student_id: user.student_id,
  degree: user.degree,
  program: user.program,
  department: user.department,
  advisor_name: user.advisor_name,
});

// Helper to convert BigInt
const convertBigInt = (obj) => {
  if (typeof obj === 'bigint') return obj.toString();
  if (obj && typeof obj === 'object') {
    return Object.keys(obj).reduce((acc, key) => {
      acc[key] = convertBigInt(obj[key]);
      return acc;
    }, {});
  }
  return obj;
};

// An approver's profile is their account row: name (editable), email (read-only) and phone.
const approverProfile = (account) => ({
  id: String(account.id),
  role: 'Approver',
  full_name: account.full_name,
  primary_email: account.primary_email,
  phone_number: account.phone_number,
});

export async function getUserProfile(req, res, next) {
  try {
    if (req.account?.role === 'Approver') return res.json(approverProfile(req.account));
    const account_id = req.auth.account_id;

    const user = await getUserByAccountId(account_id);
    const account = await getAccountById(account_id);

    if (!user) {
      return res.status(404).json({ message: 'User profile not found' });
    }

    res.json({
      ...profileView(user),
      primary_email: account.primary_email,
      full_name: account.full_name,
      phone_number: account.phone_number,
      created_at: user.created_at,
      updated_at: user.updated_at,
    });
  } catch (err) {
    next(err);
  }
}

// What a requester sends: a student the student profile (ID and degree from the address), a staff
// member the staff one (department). -> { data } or { status, body } to answer with.
function requesterInput(req) {
  const identity = classifyEmail(req.account?.primary_email, loadIdentityRules());
  if (!identity) return { status: 403, body: { message: 'This account cannot have a requester profile' } };
  const validation = (identity.kind === 'student' ? UserProfileSchema : StaffProfileSchema).safeParse(req.body);
  if (!validation.success) return { status: 400, body: { message: 'Validation error', errors: validation.error.errors } };
  const derived = identity.kind === 'student' ? { student_id: identity.studentId, degree: identity.degree } : {};
  return { data: { ...validation.data, ...derived } };
}

export async function createProfile(req, res, next) {
  try {
    const input = requesterInput(req);
    if (!input.data) return res.status(input.status).json(input.body);
    const account_id = req.auth.account_id;

    const existing = await getUserByAccountId(account_id);
    if (existing) {
      return res.status(409).json({
        message: 'User profile already exists',
      });
    }

    const user = await createUserProfile(account_id, input.data);
    res.status(201).json(profileView(user));
  } catch (err) {
    next(err);
  }
}

export async function updateProfile(req, res, next) {
  try {
    if (req.account?.role === 'Approver') {
      const approver = ApproverProfileSchema.safeParse(req.body);
      if (!approver.success) {
        return res.status(400).json({ message: 'Validation error', errors: approver.error.errors });
      }
      return res.json(approverProfile(await updateAccount(req.account.id, approver.data)));
    }

    const account_id = req.auth.account_id;
    const user_id = req.auth.user_id;

    if (!user_id) {
      return res.status(404).json({
        message: 'User profile not found',
      });
    }

    const input = requesterInput(req);
    if (!input.data) return res.status(input.status).json(input.body);
    const user = await updateUserProfile(user_id, account_id, input.data);
    res.json(profileView(user));
  } catch (err) {
    next(err);
  }
}
