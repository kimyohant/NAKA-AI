import type { Env } from '../types';
import { appOrigin, AuthError } from './common';

export interface SmsProvider { send(phone: string, text: string): Promise<void> }

const NOT_READY = 'ระบบส่งรหัสยังไม่พร้อมใช้งาน';
const SEND_FAILED = 'ส่งรหัสไม่สำเร็จ กรุณาลองอีกครั้งภายหลัง';
const GATEWAY_CLOUD = 'https://api.sms-gate.app/3rdparty/v1';

export function smsProvider(env: Env): SmsProvider {
  if (env.SMS_PROVIDER === 'mock') {
    if (appOrigin(env).protocol !== 'http:') throw new AuthError(503, NOT_READY);
    return { async send(phone, text) { console.log(`[auth:mock-sms] ${phone}: ${text}`); } };
  }
  if (env.SMS_PROVIDER === 'android_gateway') return androidGateway(env);
  if (env.SMS_PROVIDER !== 'thaibulksms' || !env.SMS_API_KEY || !env.SMS_API_SECRET || !env.SMS_SENDER?.trim()) {
    throw new AuthError(503, NOT_READY);
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
      } catch { throw new AuthError(502, SEND_FAILED); }
    },
  };
}

// SMS Gateway for Android (github.com/capcom6/android-sms-gateway, Apache-2.0): the shop's own
// Android phone and SIM send the SMS, reached through the project's cloud server so the phone
// needs no public address. Verified 2026-09-30 against the project docs at docs.sms-gate.app
// (Features → "Sending Messages" and "Status Tracking").
//   POST {base}/messages, Basic auth (username:password from the app), JSON
//   { textMessage: { text }, phoneNumbers: ["+66…"] (E.164), ttl, priority } → { id, state: "Pending", … }
// The API only queues the message for the phone; success here means "accepted", not "delivered".
function androidGateway(env: Env): SmsProvider {
  const base = (env.SMS_GATEWAY_URL?.trim() || GATEWAY_CLOUD).replace(/\/+$/, '');
  let url: URL;
  try { url = new URL(`${base}/messages`); } catch { throw new AuthError(503, NOT_READY); }
  const username = env.SMS_GATEWAY_USERNAME?.trim();
  const password = env.SMS_GATEWAY_PASSWORD;
  if (url.protocol !== 'https:' || url.username || url.password || !username || !password) throw new AuthError(503, NOT_READY);
  // Only phones seen in the last hour: an offline phone fails fast instead of queueing a code nobody gets.
  url.searchParams.set('deviceActiveWithin', '1');
  return {
    async send(phone, text) {
      try {
        const response = await fetch(url, {
          method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
          headers: { Authorization: `Basic ${btoa(`${username}:${password}`)}`, 'Content-Type': 'application/json' },
          // The OTP expires in 5 minutes (src/auth/otp.ts), so the phone must not send it later than that.
          body: JSON.stringify({ textMessage: { text }, phoneNumbers: [phone], ttl: 300, priority: 100 }),
        });
        if (!response.ok) throw new Error();
        const data = await response.json() as { id?: unknown; state?: unknown };
        if (typeof data?.id !== 'string' || !data.id || data.state === 'Failed') throw new Error();
      } catch { throw new AuthError(502, SEND_FAILED); }
    },
  };
}
