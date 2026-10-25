import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/context.js';
import { getGoogleAuthUrl } from '../api/auth.js';
import { GoogleIcon } from '../components/Icons.jsx';

const STEPS = [
  { n: '1', title: 'Sign in once', body: 'Use your SIIT Google account and fill in your profile the first time. It pre-fills every request after that.' },
  { n: '2', title: 'Submit a request', body: 'Choose a resource, describe the project and the period you need it. Save a draft if you’re not ready.' },
  { n: '3', title: 'Track the decision', body: 'An approver reviews it. Status and comments show up here instead of in an email thread.' },
];

const RESOURCES = ['HPC / GPU cluster', 'Big data platform', 'Virtual machines', 'Lab equipment', 'AWS Learner Lab', 'AWS Skill Builder'];

// The backend sends a refused sign-in back here with ?signin=not-allowed.
const signinError = () =>
  new URLSearchParams(window.location.search).get('signin') === 'not-allowed'
    ? 'This Google account can’t sign in. Use your SIIT student or staff Google account.'
    : '';

export default function LandingPage() {
  const auth = useAuth();
  const [error, setError] = useState(signinError);
  const [busy, setBusy] = useState(false);

  if (auth.status === 'ready') return <Navigate to={auth.needsProfile ? '/profile' : '/dashboard'} replace />;

  const signIn = async () => {
    setBusy(true);
    setError('');
    try {
      window.location.href = await getGoogleAuthUrl();
    } catch {
      setError('Couldn’t reach the sign-in service. Please try again.');
      setBusy(false);
    }
  };

  return (
    <div className="landing">
      <section className="hero">
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-content">
          <p className="hero-kicker">SIIT · Thammasat University</p>
          <h1>SIIT-ICT Resource Management System</h1>
          <p className="hero-sub">Request GPU, big data and lab resources in one place, and see where your request stands.</p>

          <div className="hero-actions">
            <button type="button" className="btn btn-light btn-google" onClick={signIn} disabled={busy || auth.status === 'loading'}>
              <GoogleIcon /> {busy ? 'Redirecting…' : 'Sign in with Google Account'}
            </button>
          </div>
          {error && <p className="hero-error" role="alert">{error}</p>}
        </div>
      </section>

      <section className="about">
        <div className="about-inner">
          <h2>About this page</h2>
          <p className="about-lead">
            Borrowing ICT resources used to mean an email, a Google Form and a few days of waiting for a reply.
            This portal puts the whole request in one place, from submission to the approver’s decision.
          </p>
          <ol className="steps">
            {STEPS.map((s) => (
              <li key={s.n}>
                <span className="step-n">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
          <div className="resource-chips">
            <span className="muted">Available to request:</span>
            {RESOURCES.map((r) => <span key={r} className="chip">{r}</span>)}
          </div>
        </div>
      </section>
    </div>
  );
}
