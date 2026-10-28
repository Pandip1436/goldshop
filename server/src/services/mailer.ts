import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../lib/logger';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

let transport: Transporter | null = null;

/** Messages "sent" while running tests, for assertions. */
export const testOutbox: MailMessage[] = [];

function getTransport(): Transporter | null {
  if (!env.smtp.enabled) return null;
  if (!transport) {
    transport = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    });
  }
  return transport;
}

/**
 * Sends an email if SMTP is configured. Failures are logged, never thrown: a notification
 * problem must not break checkout or an admin action.
 */
export async function sendMail(msg: MailMessage): Promise<boolean> {
  if (env.isTest) {
    testOutbox.push(msg);
    return true;
  }
  const t = getTransport();
  if (!t) {
    logger.info({ to: msg.to, subject: msg.subject }, 'Email not sent: SMTP is not configured');
    return false;
  }
  try {
    await t.sendMail({ from: env.smtp.from, ...msg });
    return true;
  } catch (err) {
    logger.error({ err, to: msg.to, subject: msg.subject }, 'Email delivery failed');
    return false;
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Minimal, widely compatible branded email layout. */
export function layout(storeName: string, title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f6f1e7;font-family:Arial,Helvetica,sans-serif;color:#231c15">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f1e7;padding:32px 12px">
<tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffdf8;border:1px solid #e7dcc8">
<tr><td style="padding:28px 32px 8px;text-align:center;font-family:Georgia,serif;font-size:24px;letter-spacing:4px;text-transform:uppercase;color:#7a5a1e">${escapeHtml(storeName)}</td></tr>
<tr><td style="padding:8px 32px 0;text-align:center;font-family:Georgia,serif;font-size:22px;color:#231c15">${escapeHtml(title)}</td></tr>
<tr><td style="padding:20px 32px 32px;font-size:14px;line-height:1.6">${bodyHtml}</td></tr>
</table></td></tr></table></body></html>`;
}

export { escapeHtml };
