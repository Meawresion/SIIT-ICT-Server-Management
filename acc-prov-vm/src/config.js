// Reads acc-prov-vm settings from the environment (.env on the acc-prov-vm host).
// Credentials only ever come from here; they are never part of a job message.

export function loadPfSenseConfig(env = process.env) {
  const missing = ['PFSENSE_USER', 'PFSENSE_PASSWORD'].filter((k) => !env[k]);
  if (missing.length) throw new Error(`missing environment variables: ${missing.join(', ')}`);

  const baseUrl = env.PFSENSE_URL ?? 'https://192.168.77.1:8443';
  if (new URL(baseUrl).protocol !== 'https:') throw new Error('PFSENSE_URL must use https');

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    username: env.PFSENSE_USER,
    password: env.PFSENSE_PASSWORD,
    caName: env.PFSENSE_CA_NAME ?? 'OpenVpn for remote access',
    headless: env.HEADLESS !== 'false',
  };
}
