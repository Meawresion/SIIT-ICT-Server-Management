import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCurrentUser, logout as apiLogout } from '../api/auth.js';
import { getUserProfile } from '../api/users.js';
import { getRequests as getReviewerRequests } from '../api/reviewer.js';
import { AuthContext } from './context.js';

const mockAuthEnabled = import.meta.env.DEV && import.meta.env.VITE_MOCK_AUTH === 'true';
const mockRole = import.meta.env.VITE_MOCK_AUTH_ROLE === 'reviewer' ? 'reviewer' : 'student';

function getMockSession() {
  return {
    status: 'ready',
    accountId: `mock-${mockRole}-account`,
    role: mockRole,
    profile: {
      full_name: mockRole === 'reviewer' ? 'Demo Approver' : 'Demo Student',
      primary_email: mockRole === 'reviewer' ? 'approver@example.test' : 'student@example.test',
      student_id: mockRole === 'reviewer' ? null : 'DEMO0001',
      degree: 'Bachelor of Engineering',
      program: 'Computer Engineering',
      phone_number: '000-000-0000',
      advisor_name: 'Demo Advisor',
    },
    needsProfile: false,
  };
}

// Works out who is signed in and what they are.
// /api/auth/me only returns ids, so the role is found by probing:
//   reviewer endpoint answers  -> reviewer
//   profile exists             -> student
//   neither                    -> student who still needs to complete a profile
async function resolveSession() {
  if (mockAuthEnabled) return getMockSession();

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
    if (mockAuthEnabled) {
      setState({ status: 'anon' });
      return;
    }
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
