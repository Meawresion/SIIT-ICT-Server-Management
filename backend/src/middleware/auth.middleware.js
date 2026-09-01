export function requireAuth(req, res, next) {
  if (!req.session || !req.session.account_id) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  next();
}

export function requireUser(req, res, next) {
  if (!req.session || !req.session.account_id) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  
  if (!req.session.user_id) {
    return res.status(403).json({ message: 'Forbidden: User profile required' });
  }
  
  next();
}

export function requireReviewer(req, res, next) {
  if (!req.session || !req.session.account_id) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  
  // For development, check if user is in reviewer role
  // In production, this would call an external authorization service
  const is_reviewer = req.session.role === 'reviewer' || req.session.role === 'admin';
  
  if (!is_reviewer) {
    return res.status(403).json({ message: 'Forbidden: Reviewer access required' });
  }
  
  next();
}

export function getCurrentAccount(req) {
  return {
    id: req.session?.account_id,
    user_id: req.session?.user_id,
    role: req.session?.role || 'user',
  };
}
