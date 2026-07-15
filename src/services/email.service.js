/**
 * Transactional email via Resend.
 * When RESEND_API_KEY is missing, logs the message (dev/test) instead of sending.
 */

import { Resend } from 'resend';
import { logInfo, logWarn, logError } from '../utils/logger.js';

const resendApiKey = process.env.RESEND_API_KEY || '';
const emailFrom = process.env.EMAIL_FROM || 'onboarding@resend.dev';

let resendClient = null;

function getClient() {
  if (!resendApiKey) return null;
  if (!resendClient) resendClient = new Resend(resendApiKey);
  return resendClient;
}

/**
 * @param {{ to: string, subject: string, html: string, text?: string }} opts
 * @returns {Promise<{ ok: boolean, id?: string, logged?: boolean }>}
 */
export async function sendEmail({ to, subject, html, text }) {
  const client = getClient();

  if (!client) {
    logInfo('Email', 'RESEND_API_KEY not set; logging message instead of sending', {
      to,
      subject,
      text: text || null,
    });
    return { ok: true, logged: true };
  }

  try {
    const { data, error } = await client.emails.send({
      from: emailFrom,
      to: [to],
      subject,
      html,
      text,
    });

    if (error) {
      logWarn('Email', 'Resend send failed', { to, subject, error });
      return { ok: false };
    }

    logInfo('Email', 'Email sent', { to, subject, id: data?.id || null });
    return { ok: true, id: data?.id };
  } catch (err) {
    logError('Email', 'Resend send error', { to, subject, error: err.message });
    return { ok: false };
  }
}

/**
 * @param {{ to: string, name: string, resetUrl: string }} opts
 */
export async function sendPasswordResetEmail({ to, name, resetUrl }) {
  const safeName = name || 'there';
  const subject = 'Reset your password';
  const text = [
    `Hi ${safeName},`,
    '',
    'We received a request to reset your password.',
    `Open this link to choose a new password (expires soon):`,
    resetUrl,
    '',
    'If you did not request this, you can ignore this email.',
  ].join('\n');

  const html = `
    <p>Hi ${escapeHtml(safeName)},</p>
    <p>We received a request to reset your password.</p>
    <p><a href="${escapeHtml(resetUrl)}">Reset your password</a></p>
    <p>This link expires soon. If you did not request this, you can ignore this email.</p>
  `.trim();

  return sendEmail({ to, subject, html, text });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
