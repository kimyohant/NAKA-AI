/**
 * Style Gallery (คลังสไตล์เลขที่) — สัญญา docs/style-gallery/PLAN.md
 *
 * นำเข้าคลังสไตล์ลายมือ 305 แบบจาก yang0/handraw-style (license แบบ permissive
 * แนบ attribution — ดู docs/style-gallery/ATTRIBUTION.md) เป็น style_presets
 * source='builtin' แบบ idempotent (row ที่ผู้ใช้แก้/ลบไปแล้วจะไม่ถูกทับ)
 *
 * กติกาสำคัญจาก upstream SKILL.md: prompt ที่ส่งให้โมเดลสร้างภาพ**ห้ามมีเลขกำกับ**
 * (โมเดลจะวาดเลขลงในภาพ) — ใช้ชื่อสไตล์ (generation_name) + traits เท่านั้น
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'

export interface HandrawStyle {
  number: string
  group: string
  reference: string
  generation_name: string
  traits: string
}

const DATA_FILE = fileURLToPath(new URL('../data/handraw-styles.json', import.meta.url))

export const BUILTIN_VALUE_PREFIX = 'handraw-'

export function loadBuiltinStyles(): HandrawStyle[] {
  const raw = JSON.parse(readFileSync(DATA_FILE, 'utf8')) as HandrawStyle[]
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('handraw-styles.json is empty or invalid')
  return raw
}

/** 'FA 国际社论幽默 / Editorial & Humor Doodle' → 'FA' */
export function categoryCode(group: string): string {
  return group.split(' ')[0]?.trim() || group
}

/**
 * ประกอบ prompt สำหรับสร้างภาพ — ห้ามมีเลขสไตล์หลุดเข้าไป (กติกา upstream)
 * traits เป็นภาษาจีนจากต้นทาง (ผู้ใช้แก้ไขได้ในหน้าตั้งค่า) — ถ้าว่างใช้ชื่อสไตล์อย่างเดียว
 */
export function composeStylePrompt(generationName: string, traits: string): string {
  const name = generationName.trim()
  if (!name) throw new Error('generation_name is required')
  const t = (traits || '').trim()
  return t
    ? `${name} hand-drawn illustration style. Core style traits: ${t}`
    : `${name} hand-drawn illustration style`
}

/** ชื่อที่แสดงใน UI: เลขนำหน้าเพื่อค้นหาง่าย (เลขอยู่เฉพาะ name — ไม่เข้า prompt) */
export function builtinDisplayName(style: HandrawStyle): string {
  return `${style.number} · ${style.generation_name}`
}

/** นำเข้าคลัง builtin แบบ idempotent — ข้าม value ที่มีอยู่แล้วทั้งหมด (รวมถึงที่ผู้ใช้แก้ไป) */
export async function importBuiltinStyles(): Promise<{ imported: number; skipped: number }> {
  const styles = loadBuiltinStyles()
  const existing = await db.select({ value: schema.stylePresets.value }).from(schema.stylePresets)
  const known = new Set(existing.map(r => r.value))

  let imported = 0
  const ts = now()
  for (let i = 0; i < styles.length; i++) {
    const style = styles[i]
    const value = BUILTIN_VALUE_PREFIX + style.number.toLowerCase()
    if (known.has(value)) continue
    await db.insert(schema.stylePresets).values({
      name: builtinDisplayName(style),
      value,
      prompt: composeStylePrompt(style.generation_name, style.traits),
      description: style.reference || null,
      sortOrder: i + 1,
      isActive: true,
      category: categoryCode(style.group),
      source: 'builtin',
      createdAt: ts,
      updatedAt: ts,
    })
    imported++
  }
  return { imported, skipped: styles.length - imported }
}

/** prompt สำหรับสร้างรูปพรีวิวของสไตล์ — หัวข้อทดสอบคงที่เพื่อเทียบสไตล์ข้าม preset ได้ */
export function composePreviewPrompt(presetPrompt: string): string {
  return `${presetPrompt}. Preview sheet: half-body portrait of a friendly young woman holding a coffee cup, plain light background, no text`
}
