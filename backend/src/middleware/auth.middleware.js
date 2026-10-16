import { getAccountById } from '../services/auth.service.js';
import { profileComplete } from '../utils/db-mapping.js';

export async function requireAuth(req, res, next) {
  try {
    if (!req.session?.account_id) return res.status(401).json({ message: 'Unauthorized' });
    const account = await getAccountById(req.session.account_id);
    if (!account) return res.status(401).json({ message: 'Unauthorized' });
    req.account = account;
    req.session.role = account.role === 'Approver' ? 'reviewer' : 'user';
    req.session.user_id = profileComplete(account) ? account.id : null;
    next();
  } catch (err) { next(err); }
}
export function requireUser(req, res, next) {
  return requireAuth(req, res, () => {
    if (!req.session.user_id) return res.status(403).json({ message: 'Forbidden: User profile required' });
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
  return { id: req.session?.account_id, user_id: req.session?.user_id, role: req.session?.role || 'user' };
}
