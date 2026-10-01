import type { Env } from '../types';
import { appOrigin, AuthError } from './common';

export interface EmailProvider { send(to: string, subject: string, text: string): Promise<void> }

const NOT_READY = 'ระบบส่งอีเมลยังไม่พร้อมใช้งาน กรุณาติดต่อทีมงาน';

export function emailProvider(env: Env): EmailProvider {
  if (env.EMAIL_PROVIDER === 'mock') {
    if (appOrigin(env).protocol !== 'http:') throw new AuthError(503, NOT_READY);
    return { async send(to, subject, text) { console.log(`[auth:mock-email] ${to}: ${subject}\n${text}`); } };
  }
  if (env.EMAIL_PROVIDER !== 'resend' || !env.RESEND_API_KEY?.trim() || !env.EMAIL_FROM?.trim()) {
    throw new AuthError(503, NOT_READY);
  }
  return {
    async send(to, subject, text) {
      // Verified 2026-09-30: https://resend.com/docs/api-reference/emails/send-email
      // POST /emails accepts Bearer auth and a plain-text message in the text field.
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text }),
      });
      if (!response.ok) throw new Error('Email delivery failed');
    },
  };
}
