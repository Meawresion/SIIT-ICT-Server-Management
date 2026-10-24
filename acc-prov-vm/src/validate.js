// Input checks shared by every provisioner (pfSense, Linux, HUE).

// st = Undergraduate, stm = Master, std = PhD, followed by the student ID.
// Anything else (bare IDs, admins, `stuadmin`) is out of scope and must never be touched.
export const USERNAME_RE = /^st[md]?\d{1,12}$/;

export function assertUsername(username) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    throw new Error(`username out of scope: ${JSON.stringify(username)}`);
  }
}

// 'YYYY-MM-DD' that is a real calendar date (no 11/31 rollover).
export function assertIsoDate(iso) {
  const m = typeof iso === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!d || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
    throw new Error(`invalid date: ${JSON.stringify(iso)}`);
  }
}

export function assertNonEmpty(name, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required`);
  }
}
