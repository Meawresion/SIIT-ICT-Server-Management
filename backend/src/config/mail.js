// SMTP settings for the status emails (S2, FR-4.3). Without SMTP_HOST the emails are off and only
// logged. Recipients are limited to the sign-in domains (STUDENT_EMAIL_DOMAIN and
// STAFF_EMAIL_DOMAINS), so a bad address in the database can never send mail elsewhere.
//   SMTP_HOST, SMTP_PORT, SMTP_SECURE (true = TLS from the start, false = STARTTLS required)
//   SMTP_USER, SMTP_APP_PASSWORD, MAIL_FROM, MAIL_REPLY_TO (optional)

import { loadIdentityRules } from './identity.js';

export function loadMailConfig(source = process.env) {
  if (!String(source.SMTP_HOST ?? '').trim()) return null;
  const problems = [];
  ['SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_APP_PASSWORD', 'MAIL_FROM'].filter(k => !source[k]).forEach(k => problems.push(`${k} is required`));
  const port = Number(source.SMTP_PORT);
  if (source.SMTP_PORT && (!Number.isInteger(port) || port < 1 || port > 65535)) problems.push('SMTP_PORT is invalid');
  if (source.SMTP_SECURE && !['true', 'false'].includes(source.SMTP_SECURE)) problems.push('SMTP_SECURE must be true or false');
  if (problems.length) throw new Error(`Mail settings: ${problems.join('; ')}`);
  const rules = loadIdentityRules(source);
  return {
    smtp: {
      host: source.SMTP_HOST, port, secure: source.SMTP_SECURE === 'true', requireTLS: source.SMTP_SECURE !== 'true',
      auth: { user: source.SMTP_USER, pass: source.SMTP_APP_PASSWORD },
    },
    from: source.MAIL_FROM,
    replyTo: source.MAIL_REPLY_TO || undefined,
    allowedRecipientDomains: [rules.studentDomain, ...rules.staffDomains],
  };
}
