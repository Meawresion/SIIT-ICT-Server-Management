// Status emails from the backend (S2, FR-4.3): the student hears about every status change and
// before the end date (FR-8.2), and approvers hear about a failed setup (FR-6.7) and about an ended
// request they must turn off by hand; extensions (FR-8.3) are asked of the approvers and answered
// to the student. acc-prov-vm still sends the login details itself (S1), so
// these emails never carry credentials.
//
// Sent after the change is committed, best effort: a mail failure is logged and never undoes or
// blocks the decision. Without SMTP settings the emails are only logged.

import nodemailer from 'nodemailer';
import prisma from '../lib/prisma.js';
import env from '../config/env.js';
import { loadMailConfig } from '../config/mail.js';
import { AUTOMATED_RESOURCES } from './provisioning.service.js';
import { log } from '../lib/log.js';

// Plain addresses only: quotes, ; < > ( ) and spaces are rejected, so a recipient can never be
// re-parsed into extra recipients (nodemailer addressparser advisories, fixed in 10.1.4).
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const RESOURCE_LABEL = {
  GPU_SERVER: 'GPU server', BIG_DATA: 'Big Data cluster', VM: 'virtual machine', LAB_EQUIPMENT: 'lab equipment',
  AWS_LAB: 'AWS Learner Lab', AWS_SKILL: 'AWS Skill Builder',
};
const FAILURE_KIND = { PROVISION_FAILED: 'Setup', REVOKE_FAILED: 'Removing access', EXTEND_FAILED: 'Extending access' };
const STATUS_ACTIONS = new Set(['APPROVED', 'REJECTED', 'ACTIVATED', 'COMPLETED', 'PROVISIONED', 'REVOKED']);

const formatId = (id) => `#${String(id).padStart(7, '0')}`;
const day = (date) => date.toISOString().slice(0, 10);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function assertRecipient(to, allowedDomains) {
  if (typeof to !== 'string' || !EMAIL_RE.test(to)) throw new Error('invalid recipient address');
  if (!allowedDomains.includes(to.split('@')[1].toLowerCase())) throw new Error('recipient domain not allowed');
}

// -> { subject, lines } for the student, or null when this event needs no student email.
export function studentEmail({ action, from, to, comment, details, request, firstFailure }) {
  const what = `your ${RESOURCE_LABEL[request.resource_type] ?? 'resource'} request ${formatId(request.rid)} (${day(request.start_date)} to ${day(request.end_date)})`;
  const automated = AUTOMATED_RESOURCES.includes(request.resource_type);
  const note = comment ? [`Approver's comment: ${comment}`] : [];
  // A REVOKED that only follows a Completed the approver already sent is not a new status.
  if (STATUS_ACTIONS.has(action) && from === to) return null;
  switch (to !== from ? to : action) {
    case 'Approved':
      return { subject: `Request ${formatId(request.rid)} approved`, lines: [
        `Good news: ${what} was approved.`, ...note,
        automated
          ? 'Your access is being set up now. You will get two emails from SIIT ICT with your login details: the instructions, then the password.'
          : 'SIIT ICT will prepare the resource and tell you when it is ready.',
      ] };
    case 'Rejected':
      return { subject: `Request ${formatId(request.rid)} not approved`, lines: [`Sorry, ${what} was not approved.`, ...note] };
    case 'On_Use':
      return { subject: `Request ${formatId(request.rid)}: access ready`, lines: [
        `Your access for ${what} is ready.`,
        ...(automated ? ['Your login details were sent in two separate emails from SIIT ICT. Check your inbox and spam folder.'] : []),
      ] };
    case 'Completed':
      return { subject: `Request ${formatId(request.rid)} completed`, lines: [
        `${what[0].toUpperCase()}${what.slice(1)} is completed.`,
        ...(automated ? ['Your access to this resource has been turned off. Your files are kept.'] : []),
      ] };
    case 'REMINDED':
      return { subject: `Request ${formatId(request.rid)}: access ends on ${day(request.end_date)}`, lines: [
        `Your access for ${what} ends at the end of ${day(request.end_date)}.`,
        automated
          ? 'After that day your login is turned off. Your files are kept, but copy anything you need before then.'
          : 'SIIT ICT will turn off the access after that day.',
        'If you need more time, ask for it on the request in the portal before then.',
      ] };
    case 'EXTENSION_APPROVED':
      return { subject: `Request ${formatId(request.rid)}: extended until ${day(request.end_date)}`, lines: [
        `Your ${RESOURCE_LABEL[request.resource_type] ?? 'resource'} request ${formatId(request.rid)} now ends on ${day(request.end_date)}.`, ...note,
      ] };
    case 'EXTENSION_REJECTED':
      return { subject: `Request ${formatId(request.rid)}: extension not approved`, lines: [
        `Your request to keep ${what} until ${details?.end_date} was not approved. It still ends on ${day(request.end_date)}.`, ...note,
      ] };
    case 'PROVISION_FAILED':
      // Once per request; retries don't send it again.
      return firstFailure ? { subject: `Request ${formatId(request.rid)}: setup delayed`, lines: [
        `Setting up your access for ${what} is taking longer than expected.`,
        'SIIT ICT has been told and is looking into it. You don’t need to do anything.',
      ] } : null;
    default:
      return null;
  }
}

function render({ fullName, lines, link }) {
  const text = [`Dear ${fullName},`, '', ...lines, '', `See the request: ${link}`, '', 'SIIT ICT Server Management'].join('\n');
  const html = `<p>Dear ${escapeHtml(fullName)},</p>${lines.map(l => `<p>${escapeHtml(l)}</p>`).join('')}`
    + `<p><a href="${escapeHtml(link)}">See the request</a></p><p>SIIT ICT Server Management</p>`;
  return { text, html };
}

// config: loadMailConfig() or null. transport: optional nodemailer transport (tests).
export function createNotifier(config, { transport, log = () => {}, portalUrl = env.frontend_url } = {}) {
  const transporter = config ? nodemailer.createTransport(transport ?? config.smtp) : null;

  async function send({ to, fullName, subject, lines, path }) {
    const { text, html } = render({ fullName, lines, link: new URL(path, portalUrl).toString() });
    assertRecipient(to, config.allowedRecipientDomains);
    const info = await transporter.sendMail({ from: config.from, replyTo: config.replyTo, to: { name: '', address: to }, subject, text, html });
    log('mail.sent', { subject, messageId: info.messageId });
  }

  // event: { rid, action, from, to, comment, details? } (statuses as stored, e.g. 'On_Use').
  async function requestEvent({ rid, action, from, to, comment, details }) {
    if (!transporter) {
      log('mail.skipped', { rid, action, reason: 'SMTP is not configured' });
      return;
    }
    const request = await prisma.request.findUnique({ where: { rid }, include: { user_request_student_uidTouser: true } });
    const student = request.user_request_student_uidTouser;
    const firstFailure = action === 'PROVISION_FAILED'
      && (await prisma.request_event.count({ where: { rid, action: 'PROVISION_FAILED' } })) === 1;
    const mail = studentEmail({ action, from, to, comment: action === 'PROVISION_FAILED' ? null : comment, details, request, firstFailure });
    if (mail) await send({ to: student.siitemail, fullName: student.fullname, ...mail, path: '/history' });
    if (FAILURE_KIND[action]) {
      // FR-6.7: tell the approvers, with the site's error.
      const approvers = await prisma.user.findMany({ where: { role: 'Approver' } });
      const kind = FAILURE_KIND[action];
      for (const a of approvers) {
        await send({ to: a.siitemail, fullName: a.fullname, subject: `${kind} failed for request ${formatId(rid)}`, path: '/history', lines: [
          `${kind} failed for ${student.fullname}'s request ${formatId(rid)} (${RESOURCE_LABEL[request.resource_type]}).`,
          `Error: ${comment ?? 'not given'}`,
          'Open the request to retry, or set it up by hand.',
        ] });
      }
    }
    if (action === 'EXTENSION_REQUESTED') {
      const approvers = await prisma.user.findMany({ where: { role: 'Approver' } });
      for (const a of approvers) {
        await send({ to: a.siitemail, fullName: a.fullname, subject: `Request ${formatId(rid)}: more time asked`, path: '/history', lines: [
          `${student.fullname} asks to keep request ${formatId(rid)} (${RESOURCE_LABEL[request.resource_type]}) until ${details?.end_date} instead of ${day(request.end_date)}.`,
          `Reason: ${comment}`,
          'Open the request to approve or reject it.',
        ] });
      }
    }
    if (action === 'EXPIRED' && details?.by_hand) {
      // D7 for a request set up by hand (S8): the system can't turn it off.
      const approvers = await prisma.user.findMany({ where: { role: 'Approver' } });
      for (const a of approvers) {
        await send({ to: a.siitemail, fullName: a.fullname, subject: `Request ${formatId(rid)} ended: turn off the access`, path: '/history', lines: [
          `${student.fullname}'s request ${formatId(rid)} (${RESOURCE_LABEL[request.resource_type]}) ended on ${day(request.end_date)}.`,
          'It was set up by hand: turn off the access, then mark the request Completed.',
        ] });
      }
    }
  }

  return {
    // Never throws: the change it reports is already committed.
    notify(event) {
      return requestEvent(event).catch(err => log('mail.failed', { rid: event.rid, action: event.action, error: err.message }));
    },
    close: () => transporter?.close(),
  };
}

let notifier;
// The running server's notifier (settings read on first use; server.js checks them at start).
export function notifyRequestEvent(event) {
  notifier ??= createNotifier(loadMailConfig(), { log });
  return notifier.notify(event);
}
