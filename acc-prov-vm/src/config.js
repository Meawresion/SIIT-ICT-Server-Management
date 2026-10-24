// Reads acc-prov-vm settings from the environment (.env on the acc-prov-vm host).
// Nothing site-specific is hard-coded. Credentials only ever come from here; they are never part
// of a job message.

function requireEnv(env, keys) {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) throw new Error(`missing environment variables: ${missing.join(', ')}`);
}

export function loadPfSenseConfig(env = process.env) {
  requireEnv(env, [
    'PFSENSE_URL', 'PFSENSE_USER', 'PFSENSE_PASSWORD', 'PFSENSE_CA_NAME',
    'PFSENSE_CERT_KEY_TYPE', 'PFSENSE_CERT_KEY_LENGTH', 'PFSENSE_CERT_DIGEST', 'PFSENSE_CERT_LIFETIME_DAYS',
  ]);
  if (new URL(env.PFSENSE_URL).protocol !== 'https:') throw new Error('PFSENSE_URL must use https');
  if (!/^\d+$/.test(env.PFSENSE_CERT_LIFETIME_DAYS)) throw new Error('PFSENSE_CERT_LIFETIME_DAYS must be a number');

  return {
    baseUrl: env.PFSENSE_URL.replace(/\/+$/, ''),
    username: env.PFSENSE_USER,
    password: env.PFSENSE_PASSWORD,
    caName: env.PFSENSE_CA_NAME,
    cert: {
      keytype: env.PFSENSE_CERT_KEY_TYPE,
      keylen: env.PFSENSE_CERT_KEY_LENGTH,
      digest: env.PFSENSE_CERT_DIGEST,
      lifetimeDays: env.PFSENSE_CERT_LIFETIME_DAYS,
    },
    headless: env.HEADLESS !== 'false',
  };
}
