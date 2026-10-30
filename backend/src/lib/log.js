// Structured logs (NFR-4.2): one JSON line per event on stdout, { ts, level, event, ...fields }.
// On AWS, ECS sends stdout to CloudWatch Logs and the logs stack copies every line to S3, so these
// lines are the incident and audit record. Nothing secret may reach them: values under keys that
// look secret are replaced, and token-like strings anywhere are masked.

const SECRET_KEY = /pass(word)?|secret|token|authorization|cookie|credential|private|api[-_]?key|jwt|session|code_verifier/i;
// JWTs and the sealed message envelopes' long base64 fields.
const TOKEN_LIKE = /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}|[A-Za-z0-9+/_-]{120,}={0,2}/g;
// key=value or key: value inside a text, e.g. a connection string in an error message.
const SECRET_PAIR = /\b(pass(?:word)?|pwd|secret|token|api[-_]?key)(\s*[=:]\s*)[^\s,;&'"]+/gi;
const MAX_DEPTH = 6;
const MAX_STRING = 4000;

export function redact(value, depth = 0) {
  if (typeof value === 'string') {
    const s = value.replace(TOKEN_LIKE, '[redacted]').replace(SECRET_PAIR, '$1$2[redacted]');
    return s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}…` : s;
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[nested]';
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return errorFields(value, depth);
  if (Array.isArray(value)) return value.slice(0, 50).map(v => redact(v, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? '[redacted]' : redact(v, depth + 1)]));
}

// An error without its full object: name, message, code and the first stack frames.
export function errorFields(err, depth = 0) {
  return redact({
    name: err.name, message: err.message, code: err.code, statusCode: err.statusCode,
    stack: err.stack?.split('\n').slice(1, 9).map(l => l.trim()),
  }, depth + 1);
}

function write(level, event, fields) {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), level, event, ...redact(fields) })}\n`);
}

export const log = (event, fields = {}) => write('info', event, fields);
export const warn = (event, fields = {}) => write('warn', event, fields);
export const logError = (event, fields = {}) => write('error', event, fields);
