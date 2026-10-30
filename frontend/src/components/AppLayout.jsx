import { Link } from 'react-router-dom';
import Navbar from './Navbar.jsx';

export default function AppLayout({ children }) {
  return (
    <div className="app-shell">
      <Navbar />
      <main className="page">{children}</main>
      <footer className="app-footer">
        <span>SIIT-ICT Resource Management System</span>
        <Link to="/privacy">Privacy notice</Link>
      </footer>
    </div>
  );
}
