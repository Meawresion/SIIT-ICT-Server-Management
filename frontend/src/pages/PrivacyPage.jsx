import { Link } from 'react-router-dom';

// NFR-7.2: the privacy notice (Thailand PDPA), shown before sign-in and linked from the profile
// form and every page footer. Set VITE_CONTACT_EMAIL to the ICT helpdesk address.
const CONTACT_EMAIL = import.meta.env.VITE_CONTACT_EMAIL;
const UPDATED = '30 October 2026';

export default function PrivacyPage() {
  return (
    <div className="privacy">
      <article className="privacy-card">
        <p className="eyebrow">SIIT-ICT Resource Management System</p>
        <h1>Privacy notice</h1>
        <p className="muted small">Last updated {UPDATED}</p>

        <h2>Who is responsible</h2>
        <p>
          The ICT unit of the Sirindhorn International Institute of Technology (SIIT), Thammasat University, runs this
          portal and decides how the personal data in it is used, under the Personal Data Protection Act B.E. 2562 (PDPA).
        </p>

        <h2>What we collect</h2>
        <ul>
          <li><b>From your Google sign-in:</b> your name and SIIT email address. For students, the student ID and degree come from that address.</li>
          <li><b>From your profile:</b> program, phone number and supervising faculty member.</li>
          <li><b>From your requests:</b> the project, purpose, period, supervisor’s name, technical requirements and justification, and the approvers’ decisions and comments.</li>
          <li><b>Technical records:</b> what was done in the portal and when (the request history), and server logs with the time, the page or action, and your network address.</li>
        </ul>

        <h2>Why we use it</h2>
        <ul>
          <li>To review your requests and give you access to SIIT ICT resources, which is the service you ask for.</li>
          <li>To create your accounts on the resource you were approved for (VPN, GPU server, Big Data platform) and email you how to use them.</li>
          <li>To email you when your request changes status or is about to end.</li>
          <li>To keep the service secure, investigate problems, and keep the audit record the university needs.</li>
        </ul>
        <p>We do not use your data for marketing and do not sell it.</p>

        <h2>Who can see it</h2>
        <ul>
          <li>SIIT ICT approvers and technicians.</li>
          <li>The account system at the SIIT site, which receives only your username, name, email and access period to create your accounts.</li>
          <li>Amazon Web Services (AWS), which hosts the portal in data centres outside Thailand. The data is encrypted in transit, and only SIIT ICT can access it.</li>
        </ul>

        <h2>How long we keep it</h2>
        <ul>
          <li>Your profile, for as long as you use the portal.</li>
          <li>Requests and their history, for at least one academic year after they end, as the university’s audit record.</li>
          <li>Server logs, about 13 months; then they are deleted.</li>
          <li>Accounts on the resources are turned off when your access ends.</li>
        </ul>

        <h2>Your rights</h2>
        <p>
          You can ask to see or get a copy of your data, to correct it, to delete it or limit its use, or object to its use,
          unless the university must keep it (for example, the audit record).
          {' '}You can correct your profile yourself on the Account page.
        </p>
        <p>
          {CONTACT_EMAIL
            ? <>Contact SIIT ICT at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</>
            : 'Contact the SIIT ICT office.'}
        </p>

        <Link className="btn btn-secondary" to="/">Back to the start page</Link>
      </article>
    </div>
  );
}
