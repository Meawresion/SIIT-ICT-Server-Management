import { Link } from 'react-router-dom';

// The page for an unknown address and for a crash in the page itself. It never shows technical
// details; server errors carry a reference instead (see api/client.js).
export function ErrorPage({ code, title, children, homeLink = true }) {
  return (
    <div className="error-page">
      <div className="error-card">
        <p className="error-code">{code}</p>
        <h1>{title}</h1>
        {children}
        {homeLink && <Link className="btn btn-primary" to="/">Back to the start page</Link>}
      </div>
    </div>
  );
}

export default function NotFoundPage() {
  return (
    <ErrorPage code="404" title="Page not found">
      <p className="muted">This address doesn’t exist in the portal. Check the link, or start again from the start page.</p>
    </ErrorPage>
  );
}
