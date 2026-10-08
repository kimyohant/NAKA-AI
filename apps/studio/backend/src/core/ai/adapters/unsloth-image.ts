/**
 * Unsloth (local) image adapter — reuse สัญญา OpenAI-compatible ของ openai-image
 * (POST {base}/v1/images/generations + Bearer key) เหมือนที่ unsloth text ใช้ /v1/chat/completions
 *
 * ข้อจำกัดที่รู้ตอนเขียน (docs/unsloth/PLAN.md ไม่ได้คลุมรูปภาพ):
 * - ต้องโหลด image model (GGUF) บน Unsloth server ก่อน — ปุ่มทดสอบจะรายงานสถานะ loaded จาก /v1/models
 * - ยังไม่ได้ probe spec จริงของ image inference (server ปิดตอนพัฒนา) — งานแรก/ปุ่มทดสอบ
 *   เป็นตัวยืนยัน; ถ้า build ของผู้ใช้มีเฉพาะ native endpoint จะต้องปรับ adapter นี้ตาม
 */
import { OpenAIImageAdapter } from './openai-image'

export class UnslothImageAdapter extends OpenAIImageAdapter {
  provider = 'unsloth'
}
