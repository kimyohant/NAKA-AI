// Every setting the system control panel (/admin/system/) may change. Only keys listed here are read
// from system_settings or accepted by the admin API; anything else (bindings, SESSION_SECRET,
// ADMIN_TOKEN, SETTINGS_KEY, SOCIAL_TOKEN_KEY, APP_ORIGIN) stays in wrangler config — see LOCKED.

export type SettingKind = 'secret' | 'text' | 'select' | 'number' | 'switch';
export type SettingGroup = 'features' | 'general' | 'payments' | 'ai' | 'video' | 'email' | 'login' | 'studio' | 'sms' | 'line_bot' | 'meta';

export interface SettingDef {
  key: string;
  group: SettingGroup;
  kind: SettingKind;
  label: string;
  help?: string;
  options?: readonly string[]; // select and switch values
  default?: string; // value used when neither D1 nor the Worker has one (switches only)
  max?: number; // text length, or the largest number
  pattern?: RegExp; // the trimmed value must match
}

const SWITCH = ['on', 'off'] as const;
const feature = (key: string, label: string, help: string, fallback: 'on' | 'off' = 'on'): SettingDef =>
  ({ key, group: 'features', kind: 'switch', label, help, options: SWITCH, default: fallback });

export const SETTINGS: readonly SettingDef[] = [
  feature('FEATURE_MAINTENANCE', 'โหมดปิดปรับปรุง', 'เปิดแล้ว API ของลูกค้าตอบ "ปิดปรับปรุงชั่วคราว" ทั้งหมด (หลังร้านและ webhook ยังทำงาน)', 'off'),
  // Off by default since 2026-10-06: naka-ai runs as a non-commercial study project (the AI video code it may use is CC BY-NC-SA).
  feature('FEATURE_PAYMENTS', 'ชำระเงินออนไลน์ (Stripe)', 'ปิดแล้วลูกค้าเริ่มจ่ายเงินใหม่ไม่ได้ รายการที่จ่ายไปแล้วยังเข้าระบบตามปกติ', 'off'),
  feature('FEATURE_CLIPS', 'สร้างคลิปรีวิว', 'ปิดแล้วลูกค้าส่งงานสร้างคลิปใหม่ไม่ได้ งานที่อยู่ในคิวยังทำต่อจนเสร็จ'),
  feature('FEATURE_SOCIAL', 'โพสต์โซเชียลอัตโนมัติ', 'ปิดแล้วหยุดโพสต์ตามเวลาและปิดหน้าเชื่อมเพจ'),
  feature('FEATURE_INBOX', 'AI Inbox', 'ปิดแล้วหยุดตอบแชตเพจอัตโนมัติ ข้อความใหม่ยังถูกเก็บไว้'),
  feature('FEATURE_MARKETER', 'นักการตลาด AI (สตูดิโอ 05)', 'ปิดแล้วหน้าเมนูนักการตลาด AI และคลิปมาแรงใช้งานไม่ได้'),
  feature('FEATURE_LINE_BOT', 'บอทขายของใน LINE OA', 'ปิดแล้วบอทไม่ตอบลูกค้าใน LINE'),
  feature('FEATURE_GOOGLE_LOGIN', 'ล็อกอินด้วย Google', 'ต้องตั้ง Google Client ID/Secret ด้วยจึงจะแสดงปุ่ม'),
  feature('FEATURE_LINE_LOGIN', 'ล็อกอินด้วย LINE', 'ต้องตั้ง LINE Login Channel ID/Secret ด้วยจึงจะแสดงปุ่ม'),
  feature('FEATURE_TURNSTILE', 'กันบอท (Turnstile)', 'ต้องตั้ง Turnstile site key/secret ด้วยจึงจะทำงาน'),

  { key: 'SIGNUP_CREDITS', group: 'general', kind: 'number', label: 'เครดิตฟรีตอนสมัคร', help: '0 = ไม่แจก · แจกครั้งเดียวต่อบัญชีใหม่', max: 1000 },
  { key: 'RECEIPT_SELLER_NAME', group: 'general', kind: 'text', label: 'ชื่อผู้ขายในใบเสร็จ', help: 'ว่าง = ยังไม่ออกใบเสร็จ', max: 120 },
  { key: 'RECEIPT_SELLER_ADDRESS', group: 'general', kind: 'text', label: 'ที่อยู่ผู้ขายในใบเสร็จ', max: 300 },
  { key: 'RECEIPT_SELLER_TAX_ID', group: 'general', kind: 'text', label: 'เลขประจำตัวผู้เสียภาษี', pattern: /^\d{13}$/, max: 13 },
  { key: 'RECEIPT_VAT_REGISTERED', group: 'general', kind: 'select', label: 'จดทะเบียน VAT', help: '1 = ออกใบกำกับภาษีอย่างย่อพร้อม VAT 7%', options: ['0', '1'] },

  { key: 'STRIPE_SECRET_KEY', group: 'payments', kind: 'secret', label: 'Stripe secret key', help: 'restricted key rk_… (หรือ sk_…)', pattern: /^(rk|sk)_(live|test)_[A-Za-z0-9]{10,}$/ },
  { key: 'STRIPE_WEBHOOK_SECRET', group: 'payments', kind: 'secret', label: 'Stripe webhook secret', help: 'whsec_… ของ endpoint /webhook/stripe', pattern: /^whsec_[A-Za-z0-9]{10,}$/ },

  { key: 'ANTHROPIC_API_KEY', group: 'ai', kind: 'secret', label: 'Anthropic API key', help: 'ใช้เขียนสคริปต์คลิป แชตบอท และ AI Inbox', pattern: /^sk-ant-[A-Za-z0-9_-]{10,}$/ },
  { key: 'GOOGLE_TTS_API_KEY', group: 'ai', kind: 'secret', label: 'Google Text-to-Speech API key', help: 'เสียงพากย์คลิปรีวิว', pattern: /^[A-Za-z0-9_-]{20,}$/ },
  { key: 'GOOGLE_TTS_VOICE', group: 'ai', kind: 'text', label: 'เสียงพากย์', help: 'เช่น th-TH-Standard-A · ว่าง = ค่าเริ่มต้น', pattern: /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9-]{1,40}$/, max: 60 },

  { key: 'TRENDING_API_URL', group: 'ai', kind: 'text', label: 'API คลิปมาแรง (FastMoss / Kalodata)', help: 'https ที่ตอบ JSON รายการคลิป · ระบบดึงทุกชั่วโมง · ว่าง = ใช้เฉพาะคลิปที่คัดเองและไฟล์นำเข้า', pattern: /^https:\/\/[^\s]+$/, max: 500 },
  { key: 'TRENDING_API_KEY', group: 'ai', kind: 'secret', label: 'คีย์ API คลิปมาแรง', help: 'ส่งเป็น Authorization: Bearer' },
  { key: 'TRENDING_API_USD_RATE', group: 'ai', kind: 'number', label: 'อัตราแลกเปลี่ยน USD → บาท ของ API คลิปมาแรง', help: 'ใส่เมื่อ API ส่งยอดขายเป็นดอลลาร์ · ว่าง = เป็นบาทอยู่แล้ว', max: 1000 },
  { key: 'VIDEO_PROVIDER', group: 'video', kind: 'select', label: 'ผู้ให้บริการวิดีโอ AI', help: 'สำหรับทำซ้ำคลิปไวรัล เปลี่ยนคน/สินค้า และโฆษณาหลายแบบ · ต้องเปิด R2 ด้วย', options: ['off', 'seedance', 'wan', 'minimax'] },
  { key: 'VIDEO_API_KEY', group: 'video', kind: 'secret', label: 'คีย์ผู้ให้บริการวิดีโอ AI' },
  { key: 'VIDEO_BASE_URL', group: 'video', kind: 'text', label: 'Base URL', help: 'ว่าง = ค่าเริ่มต้นของผู้ให้บริการ (ภูมิภาคสากล)', pattern: /^https:\/\/[^\s]+$/, max: 200 },
  { key: 'VIDEO_MODEL', group: 'video', kind: 'text', label: 'รุ่นโมเดล', help: 'ว่าง = รุ่นเริ่มต้นของผู้ให้บริการ', pattern: /^[\w.:-]{2,80}$/, max: 80 },
  { key: 'VIDEO_RESOLUTION', group: 'video', kind: 'select', label: 'ความละเอียด', help: '720p คมกว่า แต่ต้นทุนสูงกว่า 480p ราว 2 เท่า', options: ['720p', '480p'] },
  { key: 'AI_VIDEO_CREDITS', group: 'general', kind: 'number', label: 'เครดิตต่อวิดีโอ AI', help: 'ว่าง = 5 · ตั้งตามต้นทุนจริงของผู้ให้บริการ', max: 100 },
  { key: 'EMAIL_PROVIDER', group: 'email', kind: 'select', label: 'ระบบส่งอีเมล (ลืมรหัสผ่าน)', help: 'resend = เปิดลืมรหัสผ่านทางอีเมล', options: ['off', 'resend'] },
  { key: 'RESEND_API_KEY', group: 'email', kind: 'secret', label: 'Resend API key', pattern: /^re_[A-Za-z0-9_]{10,}$/ },
  { key: 'EMAIL_FROM', group: 'email', kind: 'text', label: 'อีเมลผู้ส่ง', help: 'เช่น naka-ai <no-reply@naka-ai.com>', max: 120,
    pattern: /^(?:[^<>\r\n]{1,60} <)?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>?$/ },

  { key: 'GOOGLE_CLIENT_ID', group: 'login', kind: 'text', label: 'Google Client ID', pattern: /^[\w.-]+\.apps\.googleusercontent\.com$/, max: 200 },
  { key: 'GOOGLE_CLIENT_SECRET', group: 'login', kind: 'secret', label: 'Google Client Secret' },
  { key: 'LINE_LOGIN_CHANNEL_ID', group: 'login', kind: 'text', label: 'LINE Login Channel ID', pattern: /^\d{6,20}$/, max: 20 },
  { key: 'LINE_LOGIN_CHANNEL_SECRET', group: 'login', kind: 'secret', label: 'LINE Login Channel Secret', pattern: /^[0-9a-f]{32}$/ },
  { key: 'TURNSTILE_SITE_KEY', group: 'login', kind: 'text', label: 'Turnstile site key', pattern: /^[\w-]{10,100}$/, max: 100 },
  { key: 'TURNSTILE_SECRET_KEY', group: 'login', kind: 'secret', label: 'Turnstile secret key' },

  // naka-studio signs members in through naka-ai (src/auth/studio.ts, docs/studio-sso.md)
  { key: 'STUDIO_URL', group: 'studio', kind: 'text', label: 'ที่อยู่ naka-studio', help: 'เช่น https://studio.naka-ai.com · ว่าง = ปิดการเชื่อมต่อ', max: 200,
    pattern: /^https:\/\/[a-z0-9.-]+(?::\d{2,5})?\/?$/i },
  { key: 'STUDIO_ACCESS', group: 'studio', kind: 'select', label: 'ใครเข้า naka-studio ได้',
    help: 'admins = เฉพาะอีเมลผู้ดูแล (แนะนำจนกว่า studio จะแยกข้อมูลรายบัญชี) · members = สมาชิกทุกคน · off = ปิด', options: ['admins', 'members', 'off'] },
  { key: 'STUDIO_SSO_SECRET', group: 'studio', kind: 'secret', label: 'รหัสลับเชื่อม naka-studio',
    help: 'ค่าเดียวกับ NAKA_SSO_SECRET ของ naka-studio · อย่างน้อย 32 ตัวอักษร', pattern: /^[A-Za-z0-9_-]{32,128}$/ },
  // the back office's "ระบบ Studio" page reads naka-studio server to server (src/admin/studio-system.ts)
  { key: 'STUDIO_INTERNAL_URL', group: 'studio', kind: 'text', label: 'ที่อยู่ภายในของ naka-studio',
    help: 'ที่อยู่ที่เซิร์ฟเวอร์ naka-ai เรียก studio ได้ตรง ๆ เช่น http://studio:5679 ใน Docker · ว่าง = ปิดหน้า ระบบ Studio', max: 200,
    pattern: /^https?:\/\/[a-z0-9.-]+(?::\d{2,5})?\/?$/i },
  { key: 'STUDIO_ADMIN_TOKEN', group: 'studio', kind: 'secret', label: 'โทเคนแอดมินของ naka-studio',
    help: 'ค่าเดียวกับ ADMIN_TOKEN ของ naka-studio · อย่างน้อย 16 ตัวอักษร', pattern: /^[\x21-\x7e]{16,256}$/ },

  { key: 'SMS_PROVIDER', group: 'sms', kind: 'select', label: 'ล็อกอินด้วยเบอร์โทร (OTP)', help: 'off = ซ่อนฟอร์มเบอร์โทร', options: ['off', 'thaibulksms', 'android_gateway'] },
  { key: 'SMS_API_KEY', group: 'sms', kind: 'secret', label: 'ThaiBulkSMS API key' },
  { key: 'SMS_API_SECRET', group: 'sms', kind: 'secret', label: 'ThaiBulkSMS API secret' },
  { key: 'SMS_SENDER', group: 'sms', kind: 'text', label: 'ชื่อผู้ส่ง SMS', help: 'ต้องตรงกับที่อนุมัติใน ThaiBulkSMS (ตัวพิมพ์เล็ก-ใหญ่มีผล)', max: 11 },
  { key: 'SMS_GATEWAY_URL', group: 'sms', kind: 'text', label: 'SMS Gateway URL', help: 'https เท่านั้น · ว่าง = cloud server ของโปรเจกต์', pattern: /^https:\/\/[^\s]+$/, max: 200 },
  { key: 'SMS_GATEWAY_USERNAME', group: 'sms', kind: 'text', label: 'SMS Gateway username', max: 100 },
  { key: 'SMS_GATEWAY_PASSWORD', group: 'sms', kind: 'secret', label: 'SMS Gateway password' },

  { key: 'LINE_CHANNEL_SECRET', group: 'line_bot', kind: 'secret', label: 'LINE OA Channel Secret', pattern: /^[0-9a-f]{32}$/ },
  { key: 'LINE_CHANNEL_ACCESS_TOKEN', group: 'line_bot', kind: 'secret', label: 'LINE OA Channel Access Token' },

  { key: 'META_APP_ID', group: 'meta', kind: 'text', label: 'Meta App ID', pattern: /^\d{5,20}$/, max: 20 },
  { key: 'META_APP_SECRET', group: 'meta', kind: 'secret', label: 'Meta App Secret', pattern: /^[0-9a-f]{32}$/ },
  { key: 'META_WEBHOOK_VERIFY_TOKEN', group: 'meta', kind: 'secret', label: 'Meta webhook verify token' },
];

export const SETTING_BY_KEY: ReadonlyMap<string, SettingDef> = new Map(SETTINGS.map(def => [def.key, def]));

/** Shown read-only: changing them needs wrangler, and doing it from the web would hand the panel its own keys. */
export const LOCKED: readonly { key: string; label: string; binding?: boolean }[] = [
  { key: 'ADMIN_EMAILS', label: 'อีเมล Google ของผู้ดูแล' },
  { key: 'ADMIN_TOKEN', label: 'โทเคนฉุกเฉินเข้าหลังร้าน' },
  { key: 'SETTINGS_KEY', label: 'กุญแจเข้ารหัสค่าตั้งค่า' },
  { key: 'SESSION_SECRET', label: 'กุญแจเซสชันผู้ใช้' },
  { key: 'SOCIAL_TOKEN_KEY', label: 'กุญแจเข้ารหัสโทเคนเพจ' },
  { key: 'APP_ORIGIN', label: 'โดเมนหลัก' },
  { key: 'MEDIA', label: 'R2 bucket (คลิปรอโพสต์)', binding: true },
];

const MAX_SECRET = 4096;

/** The value to store, or an error message in Thai. Empty means "use nothing": callers clear instead. */
export function normalizeSetting(def: SettingDef, raw: unknown): { value: string } | { error: string } {
  if (typeof raw !== 'string' && typeof raw !== 'number') return { error: 'ค่าที่ส่งมาไม่ถูกต้อง' };
  const value = String(raw).trim();
  if (!value) return { error: 'กรุณากรอกค่า หรือกด "ล้างค่า" ถ้าต้องการลบ' };
  if (/[\u0000-\u001f\u007f]/.test(value)) return { error: 'ค่าต้องไม่มีอักขระควบคุมหรือขึ้นบรรทัดใหม่' };
  switch (def.kind) {
    case 'switch':
    case 'select':
      return def.options!.includes(value) ? { value } : { error: `ต้องเป็นหนึ่งใน ${def.options!.join(', ')}` };
    case 'number': {
      const n = Number(value);
      return /^\d+$/.test(value) && n <= (def.max ?? 1_000_000) ? { value: String(n) } : { error: `ต้องเป็นจำนวนเต็ม 0 ถึง ${def.max}` };
    }
    case 'secret':
      if (value.length > MAX_SECRET) return { error: 'ค่ายาวเกินไป' };
      break;
    case 'text':
      if (value.length > (def.max ?? 200)) return { error: `ต้องยาวไม่เกิน ${def.max ?? 200} ตัวอักษร` };
  }
  if (def.pattern && !def.pattern.test(value)) return { error: `รูปแบบ${def.label}ไม่ถูกต้อง` };
  return { value };
}

/** Last four characters for recognising a secret, or none when that would reveal too much of it. */
export function secretHint(value: string): string | null {
  return value.length >= 16 ? value.slice(-4) : null;
}
