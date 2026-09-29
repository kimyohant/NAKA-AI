import type { Env } from '../types';
import { appOrigin, AuthError } from './common';

export interface SmsProvider { send(phone: string, text: string): Promise<void> }
export function smsProvider(env: Env): SmsProvider {
  if (env.SMS_PROVIDER === 'mock') {
    if (appOrigin(env).protocol !== 'http:') throw new AuthError(503, 'ระบบส่งรหัสยังไม่พร้อมใช้งาน');
    return { async send(phone, text) { console.log(`[auth:mock-sms] ${phone}: ${text}`); } };
  }
  if (env.SMS_PROVIDER !== 'thaibulksms' || !env.SMS_API_KEY || !env.SMS_API_SECRET || !env.SMS_SENDER?.trim()) {
    throw new AuthError(503, 'ระบบส่งรหัสยังไม่พร้อมใช้งาน');
  }
  return {
    async send(phone, text) {
      // Verified 2026-09-29: https://developer.thaibulksms.com/ (SMS API).
      // POST /sms uses Basic auth and form fields sender, msisdn, message.
      // This sends our locally generated OTP; it is not the provider's OTP API.
      try {
        const response = await fetch('https://api-v2.thaibulksms.com/sms', {
          method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
          headers: { Authorization: `Basic ${btoa(`${env.SMS_API_KEY}:${env.SMS_API_SECRET}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ msisdn: phone, message: text, sender: env.SMS_SENDER! }),
        });
        if (!response.ok) throw new Error();
        const data = await response.json() as { phone_number_list?: { number?: string; message_id?: string }[]; bad_phone_number_list?: unknown[] };
        if (data.bad_phone_number_list?.length || !data.phone_number_list?.some(item =>
          item.number?.replace(/^\+/, '') === phone.slice(1) && typeof item.message_id === 'string' && item.message_id.length > 0)) throw new Error();
      } catch { throw new AuthError(502, 'ส่งรหัสไม่สำเร็จ กรุณาลองอีกครั้งภายหลัง'); }
    },
  };
}
