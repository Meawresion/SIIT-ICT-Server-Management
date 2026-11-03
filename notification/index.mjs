// The notification service (D34): a Lambda that sends the status emails the other services ask
// for. The API and provisioning services put an "Email requested" event on the EventBridge bus; a
// rule copies it into this service's SQS queue, and Lambda hands the queue's messages to this
// handler. Only this service holds the SMTP settings (the mail secret).
//
// A message that is not a valid email request, or whose recipient is outside the allowed domains,
// is logged and dropped. A send that fails is reported back (batchItemFailures), so SQS retries it
// and, after maxReceiveCount, moves it to the dead-letter queue (an alarm watches it).
//
// Environment: MAIL_SECRET_ARN (SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_APP_PASSWORD,
// MAIL_FROM, MAIL_REPLY_TO; SMTP_HOST empty = emails off, only logged), ALLOWED_RECIPIENT_DOMAINS
// (comma-separated, the sign-in domains).

import nodemailer from 'nodemailer';

export const EVENT_SOURCE = 'siit.backend';
export const EMAIL_REQUESTED = 'Email requested';
// Plain addresses only, as in the backend: a recipient can never be re-parsed into several.
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const MAX_SUBJECT = 300;
const MAX_BODY = 200_000;
const SETTINGS_TTL_MS = 5 * 60_000;

// One JSON line per event, like the other services (no SMTP password or email body ever).
export const log = (event, fields = {}) => process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), level: event.endsWith('failed') ? 'error' : 'info', event, source: 'notification', ...fields })}\n`);

// -> { to, subject, text, html }. Throws for anything that is not a valid email request.
export function parseRecord(record, allowedDomains) {
  const event = JSON.parse(record.body);
  if (event.source !== EVENT_SOURCE || event['detail-type'] !== EMAIL_REQUESTED) throw new Error('not an email request');
  const { to, subject, text, html } = event.detail ?? {};
  if (typeof to !== 'string' || !EMAIL_RE.test(to)) throw new Error('recipient is not a plain address');
  const domain = to.slice(to.lastIndexOf('@') + 1).toLowerCase();
  if (!allowedDomains.includes(domain)) throw new Error(`recipient domain ${domain} is not allowed`);
  if (typeof subject !== 'string' || !subject || subject.length > MAX_SUBJECT || /[\r\n]/.test(subject)) throw new Error('bad subject');
  for (const [k, v] of [['text', text], ['html', html]]) {
    if (typeof v !== 'string' || !v || v.length > MAX_BODY) throw new Error(`bad ${k}`);
  }
  return { to, subject, text, html };
}

// The mail secret as nodemailer settings; smtp is null when SMTP_HOST is empty.
export function mailSettings(secret) {
  if (!String(secret.SMTP_HOST ?? '').trim()) return { smtp: null };
  const port = Number(secret.SMTP_PORT);
  const problems = ['SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_APP_PASSWORD', 'MAIL_FROM'].filter(k => !secret[k]).map(k => `${k} is required`);
  if (secret.SMTP_PORT && (!Number.isInteger(port) || port < 1 || port > 65535)) problems.push('SMTP_PORT is invalid');
  if (secret.SMTP_SECURE && !['true', 'false'].includes(secret.SMTP_SECURE)) problems.push('SMTP_SECURE must be true or false');
  if (problems.length) throw new Error(`Mail settings: ${problems.join('; ')}`);
  return {
    smtp: { host: secret.SMTP_HOST, port, secure: secret.SMTP_SECURE === 'true', requireTLS: secret.SMTP_SECURE !== 'true',
      auth: { user: secret.SMTP_USER, pass: secret.SMTP_APP_PASSWORD } },
    from: secret.MAIL_FROM,
    replyTo: secret.MAIL_REPLY_TO || undefined,
  };
}

export function createHandler({ loadSecret, allowedDomains, createTransport = nodemailer.createTransport, now = () => Date.now() }) {
  let settings = null;
  let loadedAt = 0;
  let transporter = null;
  return async (event) => {
    // Read again every few minutes, so set-secrets.sh takes effect without a deploy.
    if (!settings || now() - loadedAt > SETTINGS_TTL_MS) {
      const next = mailSettings(await loadSecret());
      if (JSON.stringify(next) !== JSON.stringify(settings)) {
        transporter?.close();
        transporter = next.smtp ? createTransport(next.smtp) : null;
      }
      settings = next;
      loadedAt = now();
    }
    const batchItemFailures = [];
    for (const record of event.Records ?? []) {
      let mail;
      try {
        mail = parseRecord(record, allowedDomains);
      } catch (err) {
        log('mail.rejected', { message_id: record.messageId, error: err.message });
        continue;
      }
      if (!transporter) {
        log('mail.skipped', { subject: mail.subject, reason: 'SMTP is not configured' });
        continue;
      }
      try {
        const info = await transporter.sendMail({ from: settings.from, replyTo: settings.replyTo, to: { name: '', address: mail.to }, subject: mail.subject, text: mail.text, html: mail.html });
        log('mail.sent', { subject: mail.subject, messageId: info.messageId });
      } catch (err) {
        log('mail.send_failed', { subject: mail.subject, error: err.message });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
}

async function loadSecretFromAws() {
  const { GetSecretValueCommand, SecretsManagerClient } = await import('@aws-sdk/client-secrets-manager');
  const res = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: process.env.MAIL_SECRET_ARN }));
  return JSON.parse(res.SecretString);
}

let handler;
export const lambdaHandler = (event) => {
  handler ??= createHandler({
    loadSecret: loadSecretFromAws,
    allowedDomains: String(process.env.ALLOWED_RECIPIENT_DOMAINS ?? '').split(',').map(d => d.trim().toLowerCase()).filter(Boolean),
  });
  return handler(event);
};
