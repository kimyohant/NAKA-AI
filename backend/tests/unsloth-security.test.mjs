/**
 * Security guard (docs/unsloth/AGENT-A-backend.md Task 7 / PLAN.md ข้อ 4)
 * ห้ามมี API key ของ Unsloth (sk-unsloth-…) หรือ IP สาธารณะ หลุดลงไฟล์ใด ๆ ใน backend/**
 * — credentials จริงต้องอยู่ใน env (UNSLOTH_BASE_URL / UNSLOTH_API_KEY) เท่านั้น
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const backendRoot = path.resolve(import.meta.dirname, '..')
const SKIP_DIRS = new Set(['node_modules', '.git', 'data', 'workspace', 'dist', 'build', 'coverage', 'release'])
const SKIP_EXT = new Set(['.sqlite3', '.sqlite3-wal', '.sqlite3-shm', '.log', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.zip', '.exe', '.node', '.wasm', '.ico'])

function listFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    let stats
    try {
      stats = statSync(full)
    } catch {
      continue
    }
    if (stats.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) out.push(...listFiles(full))
    } else if (!SKIP_EXT.has(path.extname(entry).toLowerCase())) {
      out.push(full)
    }
  }
  return out
}

/** IP ที่ไม่ใช่สาธารณะ: loopback / private / link-local / CGNAT / reserved + documentation ranges */
function isPrivateOrReserved(ip) {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 192 && b === 0) return true // 192.0.0.0/24
  if (a === 192 && b === 0 && parts[2] === 2) return true // TEST-NET-1
  if (a === 192 && b === 88 && parts[2] === 99) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a === 198 && b === 51 && parts[2] === 100) return true // TEST-NET-2
  if (a === 203 && b === 0 && parts[2] === 113) return true // TEST-NET-3
  if (a >= 224) return true // multicast + reserved
  return false
}

const KEY_PATTERN = /sk-unsloth-[A-Za-z0-9]{6,}/
const IP_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g

/** fixture IP ที่อยู่ใน test เดิม (campaigns-migration.test.ts ทดสอบขอบเขต safe-fetch) — ไม่ใช่ค่า deployment */
const ALLOWED_PUBLIC_IPS = new Set(['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1'])

test('backend/** ไม่มี API key ของ Unsloth ฝังอยู่', () => {
  const offenders = []
  for (const file of listFiles(backendRoot)) {
    const text = readFileSync(file, 'utf8')
    if (KEY_PATTERN.test(text)) offenders.push(path.relative(backendRoot, file))
  }
  assert.deepEqual(offenders, [], `พบ key จริง/ตัวอย่าง key ในไฟล์: ${offenders.join(', ')} — ใช้ env UNSLOTH_API_KEY เท่านั้น`)
})

test('backend/** ไม่มี IP สาธารณะ (เฉพาะ loopback/private/reserved เท่านั้น)', () => {
  const offenders = []
  for (const file of listFiles(backendRoot)) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(IP_PATTERN)) {
      if (ALLOWED_PUBLIC_IPS.has(match[0])) continue
      if (!isPrivateOrReserved(match[0])) offenders.push(`${path.relative(backendRoot, file)}: ${match[0]}`)
    }
  }
  assert.deepEqual(offenders, [], `พบ IP สาธารณะ: ${offenders.join(', ')} — base URL ของ unsloth ต้องมาจาก config/env ไม่ฝังในโค้ด`)
})
