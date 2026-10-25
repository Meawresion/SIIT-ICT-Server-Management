import { getGoogleAuthUrl, exchangeCodeForToken } from '../auth/google.js';
import { verifyTokenAndGetAccount } from '../services/auth.service.js';
import { getUserByAccountId } from '../services/user.service.js';
import env from '../config/env.js';
import { classifyEmail, loadIdentityRules } from '../config/identity.js';
import crypto from 'crypto';

export async function initiateGoogleAuth(req, res, next) {
  try {
    // Generate state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');
    req.session.oauth_state = state;
    await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));

    const auth_url = getGoogleAuthUrl(state);
    res.json({ auth_url });
  } catch (err) {
    next(err);
  }
}

export async function handleGoogleCallback(req, res, next) {
  try {
    const { code, state } = req.query;

    // Verify state
    if (!code || !state || !req.session.oauth_state || state !== req.session.oauth_state) {
      return res.status(400).json({ message: 'Invalid state' });
    }

    delete req.session.oauth_state;

    // Exchange code for token
    const tokens = await exchangeCodeForToken(code);
    
    // Verify ID token and get account
    const account = await verifyTokenAndGetAccount(tokens.id_token);

    // Check if user profile exists
    const user = await getUserByAccountId(account.id);

    await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
    // Set session
    req.session.account_id = account.id;
    if (user) {
      req.session.user_id = user.id.toString();  // ← Convert to string
    }
    req.session.role = account.role === 'Approver' ? 'reviewer' : 'user';
    await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));

    // Redirect to frontend: /dashboard sends each role to its home page (approvers to /admin).
    const redirect_url = account.role === 'Approver' || user
      ? `${env.frontend_url}/dashboard`
      : `${env.frontend_url}/profile`;

    res.redirect(redirect_url);
  } catch (err) {
    // Back to the landing page with a message instead of a raw JSON error.
    if (err.code === 'SIGNIN_NOT_ALLOWED') return res.redirect(`${env.frontend_url}/?signin=not-allowed`);
    console.error('Google callback error:', err);
    next(err);
  }
}

// kind is 'student' or 'staff'; a student also gets the ID and degree from the address (D25).
function identityFields(email) {
  const identity = classifyEmail(email, loadIdentityRules());
  if (identity?.kind === 'student') return { kind: 'student', student_id: identity.studentId, degree: identity.degree };
  return { kind: identity?.kind ?? null };
}

export async function getCurrentUser(req, res, next) {
  try {
    if (!req.session.account_id) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    res.json({
      account_id: req.session.account_id,
      user_id: req.session.user_id || null,
      role: req.session.role,
      // For the profile form: the name is editable; the email, student ID and degree are read-only.
      full_name: req.account.full_name,
      email: req.account.primary_email,
      ...identityFields(req.account.primary_email),
    });
  } catch (err) {
    next(err);
  }
}

export async function logout(req, res, next) {
  try {
    req.session.destroy((err) => {
      if (err) {
        return next(err);
      }
      res.clearCookie('connect.sid');
      res.json({ message: 'Logged out' });
    });
  } catch (err) {
    next(err);
  }
}
