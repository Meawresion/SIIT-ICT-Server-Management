// Student notification email (D6): instructions, credentials and links only, no attachments.
// The password appears in the message body only; it is never logged.

import nodemailer from 'nodemailer';
import { assertIsoDate, assertNonEmpty, assertUsername } from './validate.js';

// Plain addresses only. Quotes, ; < > ( ) and spaces are rejected, so the recipient can never be
// re-parsed into extra recipients (nodemailer addressparser advisories fixed in 10.1.4).
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

export function assertRecipient(to, allowedDomains = []) {
  if (typeof to !== 'string' || !EMAIL_RE.test(to)) throw new Error(`invalid recipient address: ${JSON.stringify(to)}`);
  const domain = to.split('@')[1].toLowerCase();
  if (allowedDomains.length && !allowedDomains.includes(domain)) {
    throw new Error(`recipient domain not allowed: ${domain}`);
  }
}

function assertUrl(name, value) {
  if (typeof value !== 'string' || !/^https?:\/\/\S+$/.test(value)) throw new Error(`${name} must be an http(s) URL`);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// msg: {
//   to, fullName, username, password,
//   vpnIsNew: true  -> the password covers the VPN and the service (D15)
//             false -> the student keeps the existing VPN password; this one is for the service only
//   service: { name, links: [{ label, url }], manualUrl },   e.g. name 'GPU server gpu-01'
//   ovpnProfileUrl, period: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' },
// }
export function buildProvisionEmail(msg) {
  const { to, fullName, username, password, vpnIsNew, service, ovpnProfileUrl, period } = msg;
  assertNonEmpty('to', to);
  assertNonEmpty('fullName', fullName);
  assertUsername(username);
  assertNonEmpty('password', password);
  if (typeof vpnIsNew !== 'boolean') throw new Error('vpnIsNew must be true or false');
  assertNonEmpty('service.name', service?.name);
  if (!Array.isArray(service.links) || !service.links.length) throw new Error('service.links must not be empty');
  for (const l of service.links) {
    assertNonEmpty('link label', l.label);
    assertUrl(`link ${l.label}`, l.url);
  }
  assertUrl('service.manualUrl', service.manualUrl);
  assertUrl('ovpnProfileUrl', ovpnProfileUrl);
  assertIsoDate(period?.start);
  assertIsoDate(period?.end);

  const passwordNote = vpnIsNew
    ? `This password is for both the VPN and the ${service.name}.`
    : `You already have VPN access. Keep using your existing VPN password. The password below is only for the ${service.name}.`;

  const subject = `Your SIIT ICT ${service.name} access is ready`;

  const text = [
    `Dear ${fullName},`,
    '',
    `Your access to the ${service.name} is ready for ${period.start} to ${period.end}.`,
    '',
    `Username: ${username}`,
    `Password: ${password}`,
    passwordNote,
    '',
    '1. Download the VPN profile (ICT_SIIT.ovpn) and import it into OpenVPN Connect:',
    `   ${ovpnProfileUrl}`,
    `2. Connect to the VPN with your username${vpnIsNew ? ' and the password above' : ' and your existing VPN password'}.`,
    `3. Open the ${service.name}:`,
    ...service.links.map((l) => `   ${l.label}: ${l.url}`),
    '4. Follow the student manual:',
    `   ${service.manualUrl}`,
    '',
    'Keep this password private. Access ends automatically at the end of the period.',
    '',
    'SIIT ICT Server Management',
  ].join('\n');

  const e = escapeHtml;
  const a = (url) => `<a href="${e(url)}">${e(url)}</a>`;
  const html = `<p>Dear ${e(fullName)},</p>
<p>Your access to the <b>${e(service.name)}</b> is ready for <b>${e(period.start)}</b> to <b>${e(period.end)}</b>.</p>
<table cellpadding="4">
<tr><td>Username</td><td><code>${e(username)}</code></td></tr>
<tr><td>Password</td><td><code>${e(password)}</code></td></tr>
</table>
<p><b>${e(passwordNote)}</b></p>
<ol>
<li>Download the VPN profile (ICT_SIIT.ovpn) and import it into OpenVPN Connect: ${a(ovpnProfileUrl)}</li>
<li>Connect to the VPN with your username ${vpnIsNew ? 'and the password above' : 'and your <b>existing</b> VPN password'}.</li>
<li>Open the ${e(service.name)}:<ul>${service.links.map((l) => `<li>${e(l.label)}: ${a(l.url)}</li>`).join('')}</ul></li>
<li>Follow the student manual: ${a(service.manualUrl)}</li>
</ol>
<p>Keep this password private. Access ends automatically at the end of the period.</p>
<p>SIIT ICT Server Management</p>`;

  return { to, subject, text, html };
}

// config: loadMailConfig(). transport: optional nodemailer transport (tests).
export function createMailer(config, { transport, log = () => {} } = {}) {
  const transporter = nodemailer.createTransport(transport ?? config.smtp);
  return {
    verify: () => transporter.verify(),
    async send({ to, subject, text, html }) {
      assertRecipient(to, config.allowedRecipientDomains);
      const info = await transporter.sendMail({
        from: config.from,
        replyTo: config.replyTo,
        to: { name: '', address: to },
        subject,
        text,
        html,
      });
      log('mail.sent', { to, subject, messageId: info.messageId });
      return { messageId: info.messageId };
    },
    close: () => transporter.close(),
  };
}

export async function sendProvisionEmail(mailer, msg) {
  return mailer.send(buildProvisionEmail(msg));
}
