import { getUserByAccountId, createUserProfile, updateUserProfile } from '../services/user.service.js';
import { getAccountById } from '../services/auth.service.js';
import { UserProfileSchema } from '../utils/validation.js';

export async function getUserProfile(req, res, next) {
  try {
    const account_id = req.session.account_id;
    
    const user = await getUserByAccountId(account_id);
    const account = await getAccountById(account_id);

    if (!user) {
      return res.status(404).json({ message: 'User profile not found' });
    }

    res.json({
      id: user.id,
      student_id: user.student_id,
      degree: user.degree,
      program: user.program,
      advisor_name: user.advisor_name,
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

export async function createProfile(req, res, next) {
  try {
    const validation = UserProfileSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        message: 'Validation error',
        errors: validation.error.errors,
      });
    }

    const account_id = req.session.account_id;

    // Check if profile already exists
    const existing = await getUserByAccountId(account_id);
    if (existing) {
      return res.status(409).json({
        message: 'User profile already exists',
      });
    }

    const user = await createUserProfile(account_id, validation.data);
    req.session.user_id = user.id;
    req.session.save();

    res.status(201).json({
      id: user.id,
      student_id: user.student_id,
      degree: user.degree,
      program: user.program,
      advisor_name: user.advisor_name,
    });
  } catch (err) {
    next(err);
  }
}

export async function updateProfile(req, res, next) {
  try {
    const validation = UserProfileSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        message: 'Validation error',
        errors: validation.error.errors,
      });
    }

    const account_id = req.session.account_id;
    const user_id = req.session.user_id;

    if (!user_id) {
      return res.status(404).json({
        message: 'User profile not found',
      });
    }

    const user = await updateUserProfile(user_id, account_id, validation.data);

    res.json({
      id: user.id,
      student_id: user.student_id,
      degree: user.degree,
      program: user.program,
      advisor_name: user.advisor_name,
    });
  } catch (err) {
    next(err);
  }
}
