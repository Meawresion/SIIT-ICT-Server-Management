// Request ids are shown zero-padded, e.g. #0011053, matching the mockup.
export const formatId = (id) => `#${String(id).padStart(7, '0')}`;

const pad = (n) => String(n).padStart(2, '0');

// DATE columns come back as midnight UTC; read them in UTC so they never shift a day.
export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

// Timestamps (created_at, reviewed_at) are shown in the viewer's local time.
export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatLocalDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// Value for <input type="date">.
export function toInputDate(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

export function formatPeriod(start, end) {
  if (!start && !end) return '—';
  return `${formatDate(start)} – ${formatDate(end)}`;
}

export function initials(name) {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}
