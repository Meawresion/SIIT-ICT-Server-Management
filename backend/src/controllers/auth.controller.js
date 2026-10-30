import { getGoogleAuthUrl, exchangeCodeForToken } from '../auth/google.js';
import { verifyTokenAndGetAccount } from '../services/auth.service.js';
import { getUserByAccountId } from '../services/user.service.js';
import env from '../config/env.js';
import { classifyEmail, loadIdentityRules } from '../config/identity.js';
import { STATE_COOKIE, clearSession, cookieOptions, issueSession, readCookie, seconds } from '../auth/session.js';
import crypto from 'crypto';
import { errorFields, logError } from '../lib/log.js';

// The OAuth state lives in its own short cookie, only for the sign-in round trip.
const STATE_MAX_AGE_MS = 10 * 60 * 1000;
const stateCookieOptions = (maxAge) => ({ ...cookieOptions(maxAge), path: '/api/auth' });

export async function initiateGoogleAuth(req, res, next) {
  try {
    // Generate state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');
    res.cookie(STATE_COOKIE, state, stateCookieOptions(STATE_MAX_AGE_MS));

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
    const expected_state = readCookie(req, STATE_COOKIE);
    res.clearCookie(STATE_COOKIE, stateCookieOptions());
    if (!code || !state || !expected_state || state !== expected_state) {
      return res.status(400).json({ message: 'Invalid state' });
    }

    // Exchange code for token
    const tokens = await exchangeCodeForToken(code);
    
    // Verify ID token and get account
    const account = await verifyTokenAndGetAccount(tokens.id_token);

    // Check if user profile exists
    const user = await getUserByAccountId(account.id);

    // Signed in: the token holds only the account id (role and profile are read on each request).
    issueSession(res, account.id, seconds(Date.now()));

    // Redirect to frontend: /dashboard sends each role to its home page (approvers to /admin).
    const redirect_url = account.role === 'Approver' || user
      ? `${env.frontend_url}/dashboard`
      : `${env.frontend_url}/profile`;

    res.redirect(redirect_url);
  } catch (err) {
    // Back to the landing page with a message instead of a raw JSON error.
    if (err.code === 'SIGNIN_NOT_ALLOWED') return res.redirect(`${env.frontend_url}/?signin=not-allowed`);
    // Anything else: logged with the request's reference, and the landing page says sign-in failed.
    logError('auth.callback_failed', { request_id: req.id, error: errorFields(err) });
    res.redirect(`${env.frontend_url}/?signin=failed&reference=${encodeURIComponent(req.id)}`);
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
    res.json({
      account_id: req.auth.account_id,
      user_id: req.auth.user_id || null,
      role: req.auth.role,
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
    clearSession(res);
    res.json({ message: 'Logged out' });
  } catch (err) {
    next(err);
  }
}
