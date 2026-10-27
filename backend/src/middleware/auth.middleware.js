import { getAccountById } from '../services/auth.service.js';
import { profileComplete } from '../utils/db-mapping.js';
import { issueSession, readSession, shouldRefresh } from '../auth/session.js';

// The bell's timed poll sends this header: it reads data but isn't user activity, so it doesn't
// extend the session (FR-1.4).
const BACKGROUND_HEADER = 'X-Background';

export async function requireAuth(req, res, next) {
  try {
    const session = readSession(req);
    if (!session) return res.status(401).json({ message: 'Unauthorized' });
    const account = await getAccountById(session.account_id);
    if (!account) return res.status(401).json({ message: 'Unauthorized' });
    req.account = account;
    req.auth = {
      account_id: account.id,
      role: account.role === 'Approver' ? 'reviewer' : 'user',
      user_id: profileComplete(account) ? account.id : null,
    };
    if (req.get?.(BACKGROUND_HEADER) !== '1' && shouldRefresh(session)) {
      issueSession(res, account.id, session.auth_time);
    }
    next();
  } catch (err) { next(err); }
}
export function requireUser(req, res, next) {
  return requireAuth(req, res, () => {
    if (!req.auth.user_id) return res.status(403).json({ message: 'Forbidden: User profile required' });
    next();
  });
}
export function requireReviewer(req, res, next) {
  return requireAuth(req, res, () => {
    if (req.account.role !== 'Approver') return res.status(403).json({ message: 'Forbidden: Reviewer access required' });
    next();
  });
}
export function getCurrentAccount(req) {
  return { id: req.auth?.account_id, user_id: req.auth?.user_id, role: req.auth?.role || 'user' };
}
