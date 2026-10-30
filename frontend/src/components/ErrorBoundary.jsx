import { Component } from 'react';

// A crash while rendering shows a plain error page instead of a blank screen. No details are shown.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="error-page">
        <div className="error-card">
          <p className="error-code">Error</p>
          <h1>Something went wrong on this page</h1>
          <p className="muted">Reload the page to try again. If it keeps happening, contact SIIT ICT.</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.assign('/')}>Reload the portal</button>
        </div>
      </div>
    );
  }
}
