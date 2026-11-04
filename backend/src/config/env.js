// The backend reads only the process environment (D24): docker compose passes each key from the
// root .env, and ECS passes them from the task definition and Secrets Manager (D13).

const REQUIRED = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL', 'FRONTEND_URL', 'JWT_SECRET'];
// SERVICE_ROLE (D34): all (one local process: every API route and the background work), api (every
// API route, no background work), identity (sign-in and profiles: /api/auth, /api/users), requests
// (requests and review: /api/requests, /api/reviewer; checks the sign-in token but needs no Google
// client) or worker (the provisioning service: no HTTP, no sign-in).
export const SERVICE_ROLES = ['all', 'api', 'identity', 'requests', 'worker'];
const ROLE_REQUIRED = { worker: ['FRONTEND_URL'], requests: ['FRONTEND_URL', 'JWT_SECRET'] };
// The routes each HTTP role serves.
export const servesIdentity = role => ['all', 'api', 'identity'].includes(role);
export const servesRequests = role => ['all', 'api', 'requests'].includes(role);
const DB_KEYS = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const MIN_SECRET_LENGTH = 32;

// DB_TLS (D31): how the connection to MySQL is protected. Prisma uses no TLS unless told to.
//   verify   TLS, the server certificate checked against the CA bundle DB_TLS_CA, host name
//            included (RDS; the backend image holds the RDS bundle and sets DB_TLS_CA)
//   encrypt  TLS without checking the certificate (the ECS MySQL's self-signed one, D31)
//   empty    no TLS (docker compose: the database is on the local container network)
const TLS_PARAMS = {
  verify: source => `sslcert=${source.DB_TLS_CA}&sslaccept=strict`,
  encrypt: () => 'sslaccept=accept_invalid_certs',
};

// Prisma reads DATABASE_URL. Build it from the DB_* keys, so the password is written once and may
// hold any character. Without DB_HOST, an explicit DATABASE_URL is used (e.g. for the Prisma CLI).
export function databaseUrl(source = process.env) {
  if (!source.DB_HOST) return source.DATABASE_URL;
  const user = encodeURIComponent(source.DB_USER ?? '');
  const password = encodeURIComponent(source.DB_PASSWORD ?? '');
  const port = source.DB_PORT || 3306;
  const url = `mysql://${user}:${password}@${source.DB_HOST}:${port}/${encodeURIComponent(source.DB_NAME ?? '')}`;
  if (!source.DB_TLS) return url;
  const tls = TLS_PARAMS[source.DB_TLS];
  if (!tls) throw new Error('DB_TLS must be verify, encrypt or empty');
  if (source.DB_TLS === 'verify' && !/^[\w./-]+$/.test(source.DB_TLS_CA ?? '')) {
    throw new Error('DB_TLS=verify needs DB_TLS_CA, the path of the CA bundle');
  }
  return `${url}?${tls(source)}`;
}

// Called once at start (server.js, worker.js): no fallback secrets or URLs, so a missing key stops
// the service instead of running with a default (B7).
export function checkEnv(source = process.env) {
  const role = serviceRole(source);
  const missing = (ROLE_REQUIRED[role] ?? REQUIRED).filter(key => !source[key]);
  if (source.DB_HOST) missing.push(...DB_KEYS.filter(key => !source[key]));
  else if (!source.DATABASE_URL) missing.push('DB_HOST (or DATABASE_URL)');
  if (missing.length) throw new Error(`Missing settings: ${missing.join(', ')}`);
  if (role !== 'worker' && source.NODE_ENV === 'production' && source.JWT_SECRET.length < MIN_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters in production`);
  }
}

export function serviceRole(source = process.env) {
  const role = source.SERVICE_ROLE || 'all';
  if (!SERVICE_ROLES.includes(role)) throw new Error(`SERVICE_ROLE must be one of ${SERVICE_ROLES.join(', ')}`);
  return role;
}

const database_url = databaseUrl();
if (database_url) process.env.DATABASE_URL = database_url;

const env = {
  node_env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000,

  database_url,
  google_client_id: process.env.GOOGLE_CLIENT_ID,
  google_client_secret: process.env.GOOGLE_CLIENT_SECRET,
  google_callback_url: process.env.GOOGLE_CALLBACK_URL,

  // Signs the sign-in token (D1). Sign-in ends after SESSION_IDLE_MINUTES without activity, and
  // SESSION_MAX_HOURS after sign-in at the latest (FR-1.4).
  jwt_secret: process.env.JWT_SECRET,
  session_idle_minutes: Number(process.env.SESSION_IDLE_MINUTES) || 30,
  session_max_hours: Number(process.env.SESSION_MAX_HOURS) || 12,
  frontend_url: process.env.FRONTEND_URL,
  trust_proxy: Number(process.env.TRUST_PROXY) || 0,

  is_production: process.env.NODE_ENV === 'production',
  is_development: process.env.NODE_ENV !== 'production',
};

export default env;
