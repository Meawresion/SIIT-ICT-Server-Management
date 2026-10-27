// The backend reads only the process environment (D24): docker compose passes each key from the
// root .env, and ECS passes them from the task definition and Secrets Manager (D13).

const REQUIRED = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL', 'FRONTEND_URL', 'SESSION_SECRET'];
const DB_KEYS = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const MIN_SECRET_LENGTH = 32;

// Prisma reads DATABASE_URL. Build it from the DB_* keys, so the password is written once and may
// hold any character. Without DB_HOST, an explicit DATABASE_URL is used (e.g. for the Prisma CLI).
export function databaseUrl(source = process.env) {
  if (!source.DB_HOST) return source.DATABASE_URL;
  const user = encodeURIComponent(source.DB_USER ?? '');
  const password = encodeURIComponent(source.DB_PASSWORD ?? '');
  const port = source.DB_PORT || 3306;
  return `mysql://${user}:${password}@${source.DB_HOST}:${port}/${encodeURIComponent(source.DB_NAME ?? '')}`;
}

// Called once at start (server.js): no fallback secrets or URLs, so a missing key stops the server
// instead of running with a default (B7).
export function checkEnv(source = process.env) {
  const missing = REQUIRED.filter(key => !source[key]);
  if (source.DB_HOST) missing.push(...DB_KEYS.filter(key => !source[key]));
  else if (!source.DATABASE_URL) missing.push('DB_HOST (or DATABASE_URL)');
  if (missing.length) throw new Error(`Missing settings: ${missing.join(', ')}`);
  if (source.NODE_ENV === 'production' && source.SESSION_SECRET.length < MIN_SECRET_LENGTH) {
    throw new Error(`SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters in production`);
  }
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

  session_secret: process.env.SESSION_SECRET,
  frontend_url: process.env.FRONTEND_URL,
  trust_proxy: Number(process.env.TRUST_PROXY) || 0,

  is_production: process.env.NODE_ENV === 'production',
  is_development: process.env.NODE_ENV !== 'production',
};

export default env;
