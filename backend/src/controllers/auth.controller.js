import { getGoogleAuthUrl, exchangeCodeForToken, verifyIdToken } from '../auth/google.js';
import { verifyTokenAndGetAccount } from '../services/auth.service.js';
import { getUserByAccountId } from '../services/user.service.js';
import env from '../config/env.js';
import crypto from 'crypto';

export async function initiateGoogleAuth(req, res, next) {
  try {
    // Generate state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');
    req.session.oauth_state = state;
    req.session.save();

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
    if (state !== req.session.oauth_state) {
      return res.status(400).json({ message: 'Invalid state' });
    }

    // Exchange code for token
    const tokens = await exchangeCodeForToken(code);
    
    // Verify ID token and get account
    const account = await verifyTokenAndGetAccount(tokens.id_token);

    // Check if user profile exists
    const user = await getUserByAccountId(account.id);

    // Set session
    req.session.account_id = account.id;
    if (user) {
      req.session.user_id = user.id;
    }
    req.session.save();

    // Redirect to frontend
    const redirect_url = user
      ? `${env.frontend_url}/dashboard`
      : `${env.frontend_url}/profile`;

    res.redirect(redirect_url);
  } catch (err) {
    console.error('Google callback error:', err);
    next(err);
  }
}

export async function getCurrentUser(req, res, next) {
  try {
    if (!req.session.account_id) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    res.json({
      account_id: req.session.account_id,
      user_id: req.session.user_id || null,
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
