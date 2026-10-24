// Student notification emails (D6), sent as two messages:
//   1/2 instructions and links (VPN profile, service URLs, manual), no password;
//   2/2 the password, as an inline image only (never as text, never in the logs).

import nodemailer from 'nodemailer';
import { assertIsoDate, assertNonEmpty, assertUsername } from './validate.js';

// Plain addresses only. Quotes, ; < > ( ) and spaces are rejected, so the recipient can never be
// re-parsed into extra recipients (nodemailer addressparser advisories fixed in 10.1.4).
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const PASSWORD_CID = 'password@acc-prov-vm';

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

// D15: which password the student uses for the VPN.
function passwordNote(vpnIsNew, serviceName) {
  return vpnIsNew
    ? `This password is for both the VPN and the ${serviceName}.`
    : `You already have VPN access. Keep using your existing VPN password. This password is only for the ${serviceName}.`;
}

// msg: {
//   to, fullName, username,
//   vpnIsNew: true  -> the new password covers the VPN and the service (D15)
//             false -> the student keeps the existing VPN password; the new one is for the service only
//   service: { name, links: [{ label, url }], manualUrl },   e.g. name 'GPU server gpu-01'
//   ovpnProfileUrl, period: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' },
// }
function assertMessage(msg) {
  const { to, fullName, username, vpnIsNew, service, ovpnProfileUrl, period } = msg;
  assertNonEmpty('to', to);
  assertNonEmpty('fullName', fullName);
  assertUsername(username);
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
}

// Email 1/2: instructions, no password.
export function buildInstructionsEmail(msg) {
  assertMessage(msg);
  const { to, fullName, username, vpnIsNew, service, ovpnProfileUrl, period } = msg;
  const note = passwordNote(vpnIsNew, service.name);
  const vpnLogin = vpnIsNew ? 'your username and the new password' : 'your username and your existing VPN password';

  const text = [
    `Dear ${fullName},`,
    '',
    `Your access to the ${service.name} is ready for ${period.start} to ${period.end}.`,
    '',
    `Username: ${username}`,
    'Password: sent in a separate email (2/2), as an image.',
    note,
    '',
    '1. Download the VPN profile (ICT_SIIT.ovpn) and import it into OpenVPN Connect:',
    `   ${ovpnProfileUrl}`,
    `2. Connect to the VPN with ${vpnLogin}.`,
    `3. Open the ${service.name}:`,
    ...service.links.map((l) => `   ${l.label}: ${l.url}`),
    '4. Follow the student manual:',
    `   ${service.manualUrl}`,
    '',
    'Access ends automatically at the end of the period.',
    '',
    'SIIT ICT Server Management',
  ].join('\n');

  const e = escapeHtml;
  const a = (url) => `<a href="${e(url)}">${e(url)}</a>`;
  const html = `<p>Dear ${e(fullName)},</p>
<p>Your access to the <b>${e(service.name)}</b> is ready for <b>${e(period.start)}</b> to <b>${e(period.end)}</b>.</p>
<table cellpadding="4">
<tr><td>Username</td><td><code>${e(username)}</code></td></tr>
<tr><td>Password</td><td>sent in a separate email (2/2), as an image</td></tr>
</table>
<p><b>${e(note)}</b></p>
<ol>
<li>Download the VPN profile (ICT_SIIT.ovpn) and import it into OpenVPN Connect: ${a(ovpnProfileUrl)}</li>
<li>Connect to the VPN with ${e(vpnLogin)}.</li>
<li>Open the ${e(service.name)}:<ul>${service.links.map((l) => `<li>${e(l.label)}: ${a(l.url)}</li>`).join('')}</ul></li>
<li>Follow the student manual: ${a(service.manualUrl)}</li>
</ol>
<p>Access ends automatically at the end of the period.</p>
<p>SIIT ICT Server Management</p>`;

  return { to, subject: `Your SIIT ICT ${service.name} access is ready (1/2)`, text, html };
}

// Email 2/2: the password as an inline PNG (passwordPng from renderPasswordImage). The text and
// HTML parts and the image's alt text never contain the password.
export function buildPasswordEmail(msg, passwordPng) {
  assertMessage(msg);
  if (!Buffer.isBuffer(passwordPng) || passwordPng.length === 0) throw new Error('passwordPng must be a PNG buffer');
  const { to, fullName, username, vpnIsNew, service } = msg;
  const note = passwordNote(vpnIsNew, service.name);
  const e = escapeHtml;

  const text = [
    `Dear ${fullName},`,
    '',
    `This is the password for ${username} (${service.name}). It is shown as an image in this email;`,
    'if you can\'t see it, allow images or open the email in a web or mobile mail app.',
    note,
    '',
    'Keep this password private and delete this email once you have saved it safely.',
    '',
    'SIIT ICT Server Management',
  ].join('\n');

  const html = `<p>Dear ${e(fullName)},</p>
<p>This is the password for <code>${e(username)}</code> (${e(service.name)}):</p>
<p><img src="cid:${PASSWORD_CID}" alt="password image (allow images to view)"></p>
<p><b>${e(note)}</b></p>
<p>Keep this password private and delete this email once you have saved it safely.</p>
<p>SIIT ICT Server Management</p>`;

  return {
    to,
    subject: `Your SIIT ICT ${service.name} password (2/2)`,
    text,
    html,
    attachments: [{
      filename: 'password.png', content: passwordPng, contentType: 'image/png', cid: PASSWORD_CID,
      contentDisposition: 'inline',
    }],
  };
}

// config: loadMailConfig(). transport: optional nodemailer transport (tests).
export function createMailer(config, { transport, log = () => {} } = {}) {
  const transporter = nodemailer.createTransport(transport ?? config.smtp);
  return {
    verify: () => transporter.verify(),
    async send({ to, subject, text, html, attachments }) {
      assertRecipient(to, config.allowedRecipientDomains);
      const info = await transporter.sendMail({
        from: config.from,
        replyTo: config.replyTo,
        to: { name: '', address: to },
        subject,
        text,
        html,
        attachments,
      });
      log('mail.sent', { to, subject, messageId: info.messageId });
      return { messageId: info.messageId };
    },
    close: () => transporter.close(),
  };
}

// Sends 1/2 (instructions) then 2/2 (password image). renderImage: (password) => PNG Buffer.
export async function sendProvisionEmails(mailer, msg, password, { renderImage }) {
  const png = await renderImage(password);
  const instructions = await mailer.send(buildInstructionsEmail(msg));
  const pw = await mailer.send(buildPasswordEmail(msg, png));
  return { instructionsId: instructions.messageId, passwordId: pw.messageId };
}
