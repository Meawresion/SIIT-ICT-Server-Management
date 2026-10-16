import AppLayout from '../components/AppLayout.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { STATUSES, STATUS_HELP } from '../constants.js';

// Set VITE_CONTACT_EMAIL to the ICT helpdesk address before deploying.
const CONTACT_EMAIL = import.meta.env.VITE_CONTACT_EMAIL;

const FAQ = [
  { q: 'How long does a decision take?', a: 'It depends on the approver for that resource. You can see the status of every request on your home page, and the bell shows when a decision is made.' },
  { q: 'Can I change a request after sending it?', a: 'Yes, while it is still Pending. Open it from your home page and press Edit. Once it has been reviewed it is locked.' },
  { q: 'Where are my drafts stored?', a: 'In the browser you saved them from. They won’t appear on another computer.' },
  { q: 'My request was rejected. What now?', a: 'Read the approver’s comment, adjust the request, and submit a new one.' },
];

export default function ContactPage() {
  return (
    <AppLayout>
      <section className="section contact">
        <div className="section-head">
          <h1>Contact Us</h1>
        </div>

        <div className="contact-grid">
          <div className="card">
            <h2>SIIT ICT</h2>
            <p>For questions about a resource, your account, or a request that seems stuck, contact the ICT team.</p>
            {CONTACT_EMAIL ? (
              <a className="btn btn-primary" href={`mailto:${CONTACT_EMAIL}`}>Email {CONTACT_EMAIL}</a>
            ) : (
              <p className="muted small">Helpdesk e-mail not configured (set VITE_CONTACT_EMAIL).</p>
            )}
          </div>

          <div className="card">
            <h2>What the statuses mean</h2>
            <ul className="status-legend">
              {STATUSES.map((s) => (
                <li key={s}><StatusBadge status={s} /> <span>{STATUS_HELP[s]}</span></li>
              ))}
            </ul>
          </div>
        </div>

        <div className="card">
          <h2>Common questions</h2>
          <dl className="faq">
            {FAQ.map((f) => (
              <div key={f.q}>
                <dt>{f.q}</dt>
                <dd>{f.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </AppLayout>
  );
}
