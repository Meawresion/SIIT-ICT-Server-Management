import env from '../config/env.js';
import { signToken, verifyToken } from './token.js';

// Stateless sign-in (D1): a signed token in an HttpOnly cookie, so any backend task can check any
// request and a deploy doesn't sign anyone out. The token holds only the account id; requireAuth
// reads the role from the database on every request.
export const AUTH_COOKIE = 'auth';
export const STATE_COOKIE = 'oauth_state';
// Re-issue at most once a minute, not on every request.
const REFRESH_AFTER_SECONDS = 60;

export const seconds = (ms) => Math.floor(ms / 1000);

export function cookieOptions(maxAge) {
  return { httpOnly: true, secure: env.is_production, sameSite: 'lax', path: '/', ...(maxAge !== undefined && { maxAge }) };
}

// Inactivity timeout (FR-1.4): each token lasts SESSION_IDLE_MINUTES and is re-issued on activity,
// but never runs past SESSION_MAX_HOURS after sign-in (auth_time). Returns false once that is over.
export function issueSession(res, account_id, auth_time, now = Date.now()) {
  const iat = seconds(now);
  const exp = Math.min(iat + env.session_idle_minutes * 60, auth_time + env.session_max_hours * 3600);
  if (exp <= iat) return false;
  const token = signToken({ sub: String(account_id), iat, exp, auth_time }, env.jwt_secret);
  res.cookie(AUTH_COOKIE, token, cookieOptions((exp - iat) * 1000));
  return true;
}

// The signed-in account id and token times, or null.
export function readSession(req, now = Date.now()) {
  const claims = verifyToken(readCookie(req, AUTH_COOKIE), env.jwt_secret, now);
  const account_id = Number(claims?.sub);
  if (!Number.isSafeInteger(account_id) || account_id <= 0 || typeof claims.auth_time !== 'number') return null;
  return { account_id, iat: claims.iat, auth_time: claims.auth_time };
}

export const shouldRefresh = (session, now = Date.now()) => seconds(now) - session.iat >= REFRESH_AFTER_SECONDS;

export function clearSession(res) {
  res.clearCookie(AUTH_COOKIE, cookieOptions());
}

export function readCookie(req, name) {
  for (const part of (req.headers?.cookie ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) {
      try {
        return decodeURIComponent(part.slice(at + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
