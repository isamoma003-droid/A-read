import { env } from '../config/env.js';

const escapeHtml = (text = '') =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Sends through Brevo's transactional API. Tests swap this out with setEmailSender().
async function sendWithBrevo({ to, subject, html, text }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.brevoApiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: env.emailFrom, name: env.emailFromName },
      to: [{ email: to.email, name: to.name || undefined }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Brevo rejected the email (${res.status}): ${detail.slice(0, 300)}`);
  }
}

let sender = env.brevoApiKey && env.emailFrom ? sendWithBrevo : null;

export const emailEnabled = () => Boolean(sender);

export function setEmailSender(fake) {
  sender = fake;
}

export function sendEmail(message) {
  if (!sender) throw new Error('Email is not configured (BREVO_API_KEY and EMAIL_FROM)');
  return sender(message);
}

function layout({ heading, body, button, url, footer }) {
  return `<!doctype html><html><body style="margin:0;background:#faf7f2;font-family:Helvetica,Arial,sans-serif;color:#1f1d1a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e4ddd1;border-radius:14px;padding:32px">
<tr><td style="font-size:20px;font-weight:700;color:#2f5d50;padding-bottom:20px">📖 A-Read</td></tr>
<tr><td style="font-size:22px;font-weight:700;padding-bottom:12px">${escapeHtml(heading)}</td></tr>
<tr><td style="font-size:16px;line-height:1.55;color:#3a362f;padding-bottom:24px">${body}</td></tr>
<tr><td style="padding-bottom:24px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#2f5d50;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px">${escapeHtml(button)}</a></td></tr>
<tr><td style="font-size:13px;color:#6b645a;line-height:1.5">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

export function sendVerificationEmail(user, token) {
  const url = `${env.frontendUrl}/verify-email?token=${encodeURIComponent(token)}`;
  return sendEmail({
    to: { email: user.email, name: user.name },
    subject: 'Confirm your A-Read account',
    html: layout({
      heading: `Welcome, ${user.name}!`,
      body: 'Confirm your email address to start reading and listening on A-Read.',
      button: 'Confirm my email',
      url,
      footer: `The link works for 24 hours. If the button doesn't work, open this link:<br><a href="${escapeHtml(url)}" style="color:#2f5d50;word-break:break-all">${escapeHtml(url)}</a><br><br>If you didn't create an account, you can ignore this email.`,
    }),
    text: `Welcome to A-Read, ${user.name}!\n\nConfirm your email: ${url}\n\nThe link works for 24 hours. If you didn't sign up, ignore this email.`,
  });
}

export function sendAssignmentEmail(user, { book, dueDate, note }) {
  const url = `${env.frontendUrl}/books/${book._id}`;
  const due = dueDate ? new Date(dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  return sendEmail({
    to: { email: user.email, name: user.name },
    subject: `Required reading: ${book.title}`,
    html: layout({
      heading: 'You have new required reading',
      body: `<strong>${escapeHtml(book.title)}</strong>${book.author ? ` by ${escapeHtml(book.author)}` : ''}${due ? `<br>Due <strong>${escapeHtml(due)}</strong>` : ''}${note ? `<br><br>${escapeHtml(note)}` : ''}`,
      button: 'Start reading',
      url,
      footer: 'You can read it on screen or listen to it in A-Read.',
    }),
    text: `Required reading: ${book.title}${due ? ` (due ${due})` : ''}\n${note ? `\n${note}\n` : ''}\nStart reading: ${url}`,
  });
}
