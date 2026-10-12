import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/context.js';
import { initials } from '../utils/format.js';
import NotificationBell from './NotificationBell.jsx';
import { MenuIcon } from './Icons.jsx';

export default function Navbar() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDoc = (e) => {
      if (!menuRef.current?.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  const home = auth.role === 'reviewer' ? '/admin' : '/home';
  const handleLogout = async () => {
    await auth.logout();
    navigate('/', { replace: true });
  };

  const links = [
    { to: home, label: 'Home' },
    { to: '/history', label: 'Request History' },
    { to: '/account', label: 'Account' },
    { to: '/contact', label: 'Contact Us' },
  ];

  return (
    <header className="navbar">
      <div className="navbar-inner">
        <p className="welcome">
          Welcome, <strong>{auth.name}</strong>
          {auth.profile?.student_id && <span className="muted"> ({auth.profile.student_id})</span>}
          {auth.role === 'reviewer' && <span className="role-chip">Approver</span>}
        </p>

        <nav className={`nav-links ${navOpen ? 'is-open' : ''}`} aria-label="Main">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} onClick={() => setNavOpen(false)}>
              {l.label}
            </NavLink>
          ))}
        </nav>

        <div className="navbar-actions">
          <NotificationBell />
          <div className="popover-anchor" ref={menuRef}>
            <button type="button" className="avatar-button" onClick={() => setMenuOpen((o) => !o)} aria-label="Account menu" aria-expanded={menuOpen}>
              {initials(auth.name)}
            </button>
            {menuOpen && (
              <div className="popover menu-popover">
                <button type="button" onClick={() => { setMenuOpen(false); navigate('/account'); }}>My profile</button>
                <button type="button" onClick={handleLogout}>Sign out</button>
              </div>
            )}
          </div>
          <button type="button" className="icon-button nav-toggle" onClick={() => setNavOpen((o) => !o)} aria-label="Toggle navigation" aria-expanded={navOpen}>
            <MenuIcon />
          </button>
        </div>
      </div>
    </header>
  );
}
