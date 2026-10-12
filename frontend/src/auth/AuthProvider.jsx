import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCurrentUser, logout as apiLogout } from '../api/auth.js';
import { getUserProfile } from '../api/users.js';
import { getRequests as getReviewerRequests } from '../api/reviewer.js';
import { AuthContext } from './context.js';

// Works out who is signed in and what they are.
// /api/auth/me only returns ids, so the role is found by probing:
//   reviewer endpoint answers  -> reviewer
//   profile exists             -> student
//   neither                    -> student who still needs to complete a profile
async function resolveSession() {
  const me = await getCurrentUser();
  if (!me?.account_id) return { status: 'anon' };

  const [isReviewer, profile] = await Promise.all([
    getReviewerRequests({ status: 'PENDING' }).then(() => true, () => false),
    getUserProfile().catch(() => null),
  ]);

  return {
    status: 'ready',
    accountId: me.account_id,
    role: isReviewer ? 'reviewer' : 'student',
    profile,
    needsProfile: !isReviewer && !profile,
  };
}

export default function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading' });

  const refresh = useCallback(async () => {
    const next = await resolveSession();
    setState(next);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    resolveSession().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } finally {
      setState({ status: 'anon' });
    }
  }, []);

  const value = useMemo(() => {
    const name = state.profile?.full_name || (state.role === 'reviewer' ? 'Approver' : '');
    return { ...state, name, refresh, logout };
  }, [state, refresh, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
