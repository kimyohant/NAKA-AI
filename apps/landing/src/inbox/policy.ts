import { byteLength, type Settings } from './common';
export const HANDOFF_REPLY = 'ขอส่งเรื่องให้ทีมงานช่วยตรวจสอบและตอบกลับนะคะ';
export const PRIVATE_REPLY = 'ขอบคุณที่ติดต่อค่ะ กรุณาทักแชทเพื่อให้ทีมงานช่วยดูแลต่อค่ะ';
const REQUIRED_WORDS = ['คืนเงิน', 'ร้องเรียน', 'ของเสีย', 'แพ้', 'ฟ้อง', 'refund', 'complaint', 'defective', 'allerg', 'lawsuit'];
export function escalation(body: string, config: Settings): string | null {
  let custom: unknown;
  try { custom = JSON.parse(config.escalate_keywords); } catch { return 'invalid_settings'; }
  const terms = [...REQUIRED_WORDS, ...(Array.isArray(custom) ? custom.filter((v): v is string => typeof v === 'string' && !!v.trim()) : [])];
  const normalized = body.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').toLowerCase();
  if (terms.some(word => normalized.includes(word.normalize('NFKC').toLowerCase()))) return 'escalation_keyword';
  if (/ignore.{0,30}(instruction|previous)|system\s*prompt|เปลี่ยนราคา|ไม่ต้องสนใจ.{0,30}คำสั่ง|คำสั่งระบบ|แกล้งทำเป็น|override.{0,30}(policy|price)/i.test(normalized)) return 'untrusted_instruction';
  return null;
}
export function publicSafe(value: string): boolean {
  const text = value.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '');
  return !/(?:\d[\s.()-]*){7,}|[\w.+-]+@[\w.-]+\.[a-z]{2,}|เบอร์|ที่อยู่|ยอดโอน|สลิป|เลขบัญชี|เลขบัตร|ข้อมูลส่วนตัว|โทรศัพท์|อีเมล|email|phone|address|bank\s*account|transfer\s*amount/i.test(text);
}
export function validReply(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim() && byteLength(value) <= 1000 && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value);
}
