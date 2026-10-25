// Who may sign in, worked out from the Google account's email (plan D25). Every value comes
// from config; nothing about SIIT's addresses is written here.
//   STUDENT_EMAIL_DOMAIN   e.g. g.siit.tu.ac.th
//   STUDENT_ID_DIGITS      e.g. 10
//   DEGREE_EMAIL_PREFIXES  JSON, degree -> letters before the ID, e.g. {"UNDERGRADUATE":"","MASTER":"m","DOCTORAL":"d"}
//   STAFF_EMAIL_DOMAINS    comma-separated, e.g. siit.tu.ac.th
// A student address is <prefix><ID>@<student domain>; a staff address is <name>@<staff domain>.

const DEGREES = ['UNDERGRADUATE', 'MASTER', 'DOCTORAL'];
const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const STAFF_LOCAL_RE = /^[a-z0-9._%+-]+$/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Reads process.env each time (cheap), so tests and a restarted server see current values.
// Throws one error that lists every problem.
export function loadIdentityRules(source = process.env) {
  const problems = [];

  const studentDomain = String(source.STUDENT_EMAIL_DOMAIN ?? '').trim().toLowerCase();
  if (!DOMAIN_RE.test(studentDomain)) problems.push('STUDENT_EMAIL_DOMAIN must be a domain name');

  const digits = Number(source.STUDENT_ID_DIGITS);
  if (!Number.isInteger(digits) || digits < 1 || digits > 12) problems.push('STUDENT_ID_DIGITS must be a whole number from 1 to 12');

  let prefixes = null;
  try {
    prefixes = JSON.parse(source.DEGREE_EMAIL_PREFIXES ?? '');
  } catch {
    // reported below
  }
  const entries = prefixes && typeof prefixes === 'object' && !Array.isArray(prefixes) ? Object.entries(prefixes) : [];
  if (!entries.length || entries.some(([degree, prefix]) => !DEGREES.includes(degree) || typeof prefix !== 'string' || !/^[a-z]*$/.test(prefix))) {
    problems.push(`DEGREE_EMAIL_PREFIXES must be JSON mapping ${DEGREES.join('/')} to lowercase letters, e.g. {"UNDERGRADUATE":"","MASTER":"m","DOCTORAL":"d"}`);
  } else if (new Set(entries.map(([, prefix]) => prefix)).size !== entries.length) {
    problems.push('DEGREE_EMAIL_PREFIXES needs a different prefix for each degree');
  }

  const staffDomains = String(source.STAFF_EMAIL_DOMAINS ?? '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  if (!staffDomains.length || staffDomains.some((d) => !DOMAIN_RE.test(d))) problems.push('STAFF_EMAIL_DOMAINS must list one or more domain names, comma-separated');
  else if (staffDomains.includes(studentDomain)) problems.push('STAFF_EMAIL_DOMAINS must not include STUDENT_EMAIL_DOMAIN');

  if (problems.length) throw new Error(`Sign-in settings: ${problems.join('; ')}`);
  // Longest prefix first, so "m" is tried before "".
  const degreePatterns = entries
    .sort(([, a], [, b]) => b.length - a.length)
    .map(([degree, prefix]) => ({ degree, re: new RegExp(`^${escapeRe(prefix)}(\\d{${digits}})$`) }));
  return { studentDomain, digits, staffDomains, degreePatterns };
}

// -> { kind: 'student', studentId, degree, domain } | { kind: 'staff', domain } | null (not allowed)
export function classifyEmail(email, rules) {
  const value = String(email ?? '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at < 1) return null;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (domain === rules.studentDomain) {
    for (const { degree, re } of rules.degreePatterns) {
      const m = re.exec(local);
      if (m) return { kind: 'student', studentId: m[1], degree, domain };
    }
    return null;
  }
  if (rules.staffDomains.includes(domain) && STAFF_LOCAL_RE.test(local)) return { kind: 'staff', domain };
  return null;
}

// The Google `hd` claim is set only for Google Workspace accounts, so requiring it (and one of
// our domains) refuses a personal Google account that merely uses an SIIT address as its login.
export function allowedHostedDomain(hd, rules) {
  const value = String(hd ?? '').trim().toLowerCase();
  return value !== '' && (value === rules.studentDomain || rules.staffDomains.includes(value));
}
