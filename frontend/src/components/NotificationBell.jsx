import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/context.js';
import { getMyRequests } from '../api/requests.js';
import { getRequests as getReviewerRequests } from '../api/reviewer.js';
import { STATUS_LABEL } from '../constants.js';
import { formatDateTime, formatId } from '../utils/format.js';
import { onRequestsChanged } from '../utils/requestEvents.js';
import { BellIcon } from './Icons.jsx';

// No notification API exists yet, so the bell is built from request data:
//   student  -> decisions on their requests (reviewed_at), unread since last opened
//   reviewer -> requests still waiting for review
// It reloads after any request change in this tab, when the tab regains focus, and every
// POLL_MS while visible, so changes made by other people show up without a page reload.
const seenKey = (id) => `siit-notif-seen-${id}`;
const POLL_MS = 60_000;
const SHOWN = 8;

function readSeen(accountId) {
  try {
    return localStorage.getItem(seenKey(accountId)) || '';
  } catch {
    return '';
  }
}

export default function NotificationBell() {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [seen, setSeen] = useState(() => readSeen(auth.accountId));
  const ref = useRef(null);
  const latest = useRef(0);

  // Only the newest call may set state, so a slow response can't overwrite a newer one.
  const load = useCallback(() => {
    const call = ++latest.current;
    const fetcher = auth.role === 'reviewer'
      ? getReviewerRequests({ status: 'PENDING' }).then((rows) =>
          rows
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map((r) => ({ id: r.id, at: r.created_at, text: `${r.student_name} submitted ${formatId(r.id)} — ${r.purpose}` })))
      : getMyRequests().then((rows) =>
          rows
            .filter((r) => r.reviewed_at)
            .sort((a, b) => b.reviewed_at.localeCompare(a.reviewed_at))
            .map((r) => ({ id: r.id, at: r.reviewed_at, text: `${formatId(r.id)} ${r.purpose} is now ${STATUS_LABEL[r.status]}` })));
    fetcher
      .then((rows) => call === latest.current && setItems(rows))
      .catch(() => call === latest.current && setItems([]));
  }, [auth.role]);

  useEffect(() => {
    load();
    const reloadIfVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    const timer = setInterval(reloadIfVisible, POLL_MS);
    const offChanged = onRequestsChanged(load);
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', reloadIfVisible);
    return () => {
      latest.current += 1;
      clearInterval(timer);
      offChanged();
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', reloadIfVisible);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Count every item, not only the ones shown, so the number matches the pages.
  const unread = auth.role === 'reviewer' ? items.length : items.filter((i) => i.at > seen).length;
  const shown = items.slice(0, SHOWN);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && auth.role !== 'reviewer' && items[0]) {
      try {
        localStorage.setItem(seenKey(auth.accountId), items[0].at);
      } catch {
        // ignore
      }
    }
    if (!next && items[0]) setSeen(items[0].at);
  };

  return (
    <div className="popover-anchor" ref={ref}>
      <button type="button" className="icon-button bell" onClick={toggle} aria-label={`Notifications${unread ? `, ${unread} new` : ''}`} aria-expanded={open}>
        <BellIcon />
        {unread > 0 && <span className="bell-dot">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="popover notif-popover">
          <p className="popover-title">{auth.role === 'reviewer' ? 'Waiting for review' : 'Updates on your requests'}</p>
          {shown.length === 0 ? (
            <p className="popover-empty">Nothing new.</p>
          ) : (
            <ul className="notif-list">
              {shown.map((i) => (
                <li key={i.id} className={auth.role !== 'reviewer' && i.at > seen ? 'is-new' : ''}>
                  <span>{i.text}</span>
                  <time>{formatDateTime(i.at)}</time>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
