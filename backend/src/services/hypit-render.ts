/**
 * Hypit render engine — ทางเลือก render ขั้นสุดท้ายของ Viral Clone Studio (แทน ffmpeg merge + burn ASS)
 * - Hypit (study/hypit, © Hypit.AI, Apache 2.0 + เงื่อนไข — ใช้ภายในองค์กรเท่านั้น ดู study/README.md)
 *   ถูกเรียกเป็น process แยกผ่าน CLI (`node bin/hypit.mjs build`) — backend ไม่ import โค้ด Hypit
 * - input: คลิปของแต่ละ beat (ไฟล์ mp4 ที่ pipeline เดิมสร้างแล้ว) + line ของ beat → SVML composition
 *   (media-track เรียงคลิป · audio-track เสียงของคลิป · typography-track ซับ) → render ผ่าน HyperFrames (headless Chromium)
 * - ไม่มี Hypit ในเครื่อง (desktop/Docker) → isHypitAvailable() = false และ clone.ts ใช้ engine เดิม
 */
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { v4 as uuid } from 'uuid'
import { DATA_ROOT, STORAGE_ROOT } from '../utils/paths.js'
import { ffmpeg, getFfmpegBinPaths } from '../utils/ffmpeg.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// src/services → ขึ้นสามระดับเป็นรากของ repo
const repoRoot = path.resolve(__dirname, '../../..')

export const HYPIT_FRAME_RATE = 30
const HYPIT_TIMEOUT_MS = Number(process.env.HYPIT_TIMEOUT_MS) || 30 * 60 * 1000

export type HypitCaptionStyle = 'clean' | 'bold' | 'boxed'

export interface HypitClip {
  /** path ของไฟล์วิดีโอ (absolute) */
  videoPath: string
  /** ความยาวจริงของคลิป (วินาที) */
  durationSec: number
  /** คลิปมีเสียงหรือไม่ */
  hasAudio: boolean
  /** ข้อความซับของช่วงนี้ (null = ไม่มีซับ) */
  caption: string | null
}

export interface HypitCompositionInput {
  clips: HypitClip[]
  language: string
  captions: { enabled: boolean; style: HypitCaptionStyle }
  width?: number
  height?: number
}

export function hypitRoot(): string {
  return path.resolve(process.env.HYPIT_ROOT || path.join(repoRoot, 'study', 'hypit'))
}

function hypitBin(): string {
  return path.join(hypitRoot(), 'bin', 'hypit.mjs')
}

export interface HypitStatus {
  available: boolean
  root: string
  /** เหตุผลที่ใช้ไม่ได้ (null เมื่อพร้อม) */
  reason: string | null
  chromePath: string | null
}

/** ตรวจว่ามี Hypit ที่ติดตั้ง dependency แล้ว (pnpm install) — ไม่รัน build */
export function getHypitStatus(): HypitStatus {
  const root = hypitRoot()
  const chromePath = process.env.HYPIT_CHROME_PATH || null
  if (!fs.existsSync(hypitBin())) {
    return { available: false, root, reason: `ไม่พบ Hypit ที่ ${root} (ตั้งค่า HYPIT_ROOT)`, chromePath }
  }
  if (!fs.existsSync(path.join(root, 'node_modules'))) {
    return { available: false, root, reason: `ยังไม่ได้ติดตั้ง dependency ของ Hypit — รัน pnpm install ใน ${root}`, chromePath }
  }
  if (chromePath && !fs.existsSync(chromePath)) {
    return { available: false, root, reason: `ไม่พบ Chromium ที่ HYPIT_CHROME_PATH=${chromePath}`, chromePath }
  }
  return { available: true, root, reason: null, chromePath }
}

export function isHypitAvailable(): boolean {
  return getHypitStatus().available
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** ความกว้างโดยประมาณของ grapheme (หน่วย em) — ใช้แค่ตัดบรรทัด; overflow: shrink กันกรณีประมาณต่ำไป */
function graphemeWidthEm(g: string): number {
  if (/^\s+$/u.test(g)) return 0.3
  if (/\p{Extended_Pictographic}/u.test(g)) return 1.2
  if (/[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/u.test(g)) return 1
  if (/[\u0E00-\u0EFF\u1780-\u17FF\u1000-\u109F]/u.test(g)) return 0.52
  if (/[A-Z0-9@%&#WMm]/.test(g)) return 0.66
  return 0.52
}

/**
 * ตัดซับเป็นบรรทัดตามคำ (Intl.Segmenter) — HyperFrames วาดทุก grapheme เป็น inline-grid แยกกัน
 * เบราว์เซอร์จึงตัดบรรทัดกลางคำได้ (เช่น "บรร|ทัด") → backend ตัดเองแล้วส่ง wrap: none
 */
export function wrapCaptionLines(text: string, language: string, maxEm: number): string[] {
  const graphemes = new Intl.Segmenter(language, { granularity: 'grapheme' })
  const width = (s: string) => [...graphemes.segment(s)].reduce((sum, g) => sum + graphemeWidthEm(g.segment), 0)
  const lines: string[] = []
  for (const paragraph of text.split(/\r?\n/)) {
    let line = ''
    let lineWidth = 0
    for (const seg of new Intl.Segmenter(language, { granularity: 'word' }).segment(paragraph.trim())) {
      const w = width(seg.segment)
      const blank = /^\s+$/u.test(seg.segment)
      if (line && !blank && lineWidth + w > maxEm) {
        lines.push(line.trimEnd())
        line = ''
        lineWidth = 0
      }
      if (!line && blank) continue
      line += seg.segment
      lineWidth += w
    }
    if (line.trim()) lines.push(line.trimEnd())
  }
  return lines
}

/** ฟอนต์ตามภาษา — Inter สำหรับละติน + Noto ของภาษานั้นเป็น fallback (ฟอนต์มากับ @hypit/fonts-open ไม่โหลดจากเครื่อง) */
function fontFallbackFor(language: string): string | null {
  const lang = language.toLowerCase()
  if (lang.startsWith('th')) return 'noto-sans-thai'
  if (lang === 'zh-tw' || lang === 'zh-hant') return 'noto-sans-tc'
  if (lang.startsWith('zh')) return 'noto-sans-sc'
  if (lang.startsWith('ja')) return 'noto-sans-jp'
  if (lang.startsWith('ko')) return 'noto-sans-kr'
  if (lang.startsWith('ar')) return 'noto-sans-arabic'
  if (lang.startsWith('he')) return 'noto-sans-hebrew'
  if (lang.startsWith('hi')) return 'noto-sans-devanagari'
  return null
}

/** Paint ของซับตามสไตล์เดียวกับ ASS เดิม (clean/bold/boxed) — ลำดับลูก = ลำดับวาด */
function captionPaints(style: HypitCaptionStyle): { size: number; recipe: string; paints: string } {
  if (style === 'clean') {
    return {
      size: 60,
      recipe: 'size: 60; line-height: 1.3;',
      paints: '<text:Shadow color="#000000CC" x="0" y="3" blur="10"/>\n    <text:Fill color="#FFFFFF"/>',
    }
  }
  if (style === 'boxed') {
    return {
      size: 58,
      recipe: 'size: 58; line-height: 1.3;',
      paints: '<text:Box target="line" color="#000000B3" padding="10 22" radius="14"/>\n    <text:Fill color="#FFFFFF"/>',
    }
  }
  return {
    size: 70,
    recipe: 'size: 70; line-height: 1.25;',
    paints: '<text:Stroke color="#000000" width="10" placement="outside"/>\n    <text:Fill color="#FFFFFF"/>',
  }
}

/** แบ่งช่วงเวลา (เป็นเฟรม) ของคลิปเรียงต่อกัน — ปัดลงเป็นเฟรมเต็มเพื่อไม่ให้ยาวเกินสื่อจริง */
export function layoutClipFrames(clips: Pick<HypitClip, 'durationSec'>[], frameRate = HYPIT_FRAME_RATE) {
  let cursor = 0
  return clips.map(clip => {
    const frames = Math.max(1, Math.floor(clip.durationSec * frameRate))
    const window = { start: cursor, end: cursor + frames }
    cursor += frames
    return window
  })
}

/** สร้างไฟล์ของโปรเจกต์ Hypit (SVML/SVS/SVRun) — clip path อ้างแบบ relative ใน assets/ */
export function buildHypitComposition(input: HypitCompositionInput, assetNames: string[]): { svml: string; svs: string; svrun: string } {
  if (!input.clips.length) throw new Error('ไม่มีคลิปสำหรับ render')
  if (assetNames.length !== input.clips.length) throw new Error('assetNames ต้องมีจำนวนเท่ากับคลิป')
  const width = input.width ?? 1080
  const height = input.height ?? 1920
  const windows = layoutClipFrames(input.clips)
  const totalFrames = windows[windows.length - 1].end
  const captionsOn = input.captions.enabled && input.clips.some(c => c.caption && c.caption.trim())
  const paints = captionPaints(input.captions.style)
  const fallback = fontFallbackFor(input.language)
  // กรอบซับกว้าง 86% ของ canvas; เผื่อขอบ/padding ของสไตล์ 8%
  const captionMaxEm = (width * 0.86 * 0.92) / paints.size
  const textLanguage = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/i.test(input.language) ? input.language : null

  const lines: string[] = []
  lines.push('<?svml using="@hypit/markup@1"?>')
  lines.push('<svml>')
  lines.push('  <import as="time" from="@hypit/timeline-author@1"/>')
  lines.push('  <import as="space" from="@hypit/spatial@1"/>')
  lines.push('  <import as="media" from="@hypit/media@1"/>')
  lines.push('  <import as="pipeline" from="@hypit/media-pipeline@1"/>')
  lines.push('  <import as="mt" from="@hypit/media-track@1"/>')
  lines.push('  <import as="audio" from="@hypit/audio-track@1"/>')
  if (captionsOn) {
    lines.push('  <import as="fonts" from="@hypit/fonts-open@1"/>')
    lines.push('  <import as="text" from="@hypit/typography-track@1"/>')
  }
  lines.push('  <import as="film" from="@hypit/film@1"/>')
  lines.push('  <import as="render" from="@hypit/render-hyperframes@1"/>')
  lines.push('  <import as="style" source="./recipes.svs"/>')
  lines.push('')
  lines.push(`  <time:Clock id="clock" frame-rate="${HYPIT_FRAME_RATE}"/>`)
  lines.push(`  <time:Timeline id="program" clock={clock} end="${totalFrames}f"/>`)
  lines.push(`  <space:Canvas id="canvas" width="${width}" height="${height}"/>`)
  lines.push('  <space:Frame id="full" within={canvas} left="0%" top="0%" right="100%" bottom="100%"/>')
  lines.push('')

  input.clips.forEach((clip, i) => {
    const n = i + 1
    lines.push(`  <media:Video id="clip-${n}" src="./assets/${assetNames[i]}"/>`)
    lines.push(`  <pipeline:Normalize id="clip-${n}-media" source={clip-${n}} video="primary-moving" audio="${clip.hasAudio ? 'default' : 'none'}" span-authority="video" clock={clock}/>`)
  })
  lines.push('')
  lines.push('  <mt:Track id="beats" timeline={program.timeline} canvas={canvas}>')
  input.clips.forEach((_clip, i) => {
    const w = windows[i]
    lines.push(`    <mt:Item media={clip-${i + 1}-media.media} frame={full} start="${w.start}f" end="${w.end}f" appearance={style.media.beat}/>`)
  })
  lines.push('  </mt:Track>')

  const withAudio = input.clips.map((clip, i) => ({ clip, i })).filter(({ clip }) => clip.hasAudio)
  if (withAudio.length) {
    lines.push('  <audio:Track id="voice" timeline={program.timeline}>')
    for (const { i } of withAudio) {
      const w = windows[i]
      lines.push(`    <audio:Item source={clip-${i + 1}-media.media} start="${w.start}f" end="${w.end}f"/>`)
    }
    lines.push('  </audio:Track>')
  }

  if (captionsOn) {
    lines.push('')
    lines.push(`  <fonts:Stack id="caption-font" family="inter" weight="700" style="normal" emoji="color">`)
    if (fallback) lines.push(`    <fonts:Fallback family="${fallback}" weight="700" style="normal"/>`)
    lines.push('  </fonts:Stack>')
    lines.push('  <text:Style id="caption-style" recipe={style.text.caption} font={caption-font}>')
    lines.push(`    ${paints.paints}`)
    lines.push('  </text:Style>')
    lines.push('  <space:Frame id="caption-frame" within={canvas} left="7%" top="60%" right="93%" bottom="82%"/>')
    lines.push('  <text:Track id="captions" timeline={program.timeline}>')
    input.clips.forEach((clip, i) => {
      const caption = clip.caption?.trim()
      if (!caption) return
      const w = windows[i]
      const body = `<text:P>${wrapCaptionLines(caption, input.language, captionMaxEm).map(escapeXml).join('<text:Break/>')}</text:P>`
      lines.push(`    <text:Area id="caption-${i + 1}" placement={caption-frame} style={caption-style} start="${w.start}f" end="${w.end}f">${body}</text:Area>`)
    })
    lines.push('  </text:Track>')
  }

  lines.push('')
  lines.push('  <film:Film id="main" canvas={canvas} timeline={program.timeline} appearance={style.film.main}>')
  lines.push('    <film:Track source={beats.visual}/>')
  if (withAudio.length) lines.push('    <film:Track source={voice.audio}/>')
  if (captionsOn) lines.push('    <film:Track source={captions.track}/>')
  lines.push('  </film:Film>')
  lines.push('  <render:Video id="final" composition={main.composition} timeline={program.timeline}/>')
  lines.push('</svml>')

  const svs = [
    '<?svml using="@hypit/svs@1"?>',
    '<sheet version="1">',
    '  film.main { background: #000000; }',
    '  media.beat { stack-order: 10; fit: cover; clip: frame; }',
    `  text.caption { stack-order: 70; ${paints.recipe} align: center; block-align: end; wrap: none; overflow: shrink; minimum-scale: 0.6;${textLanguage ? ` language: ${textLanguage};` : ''} }`,
    '</sheet>',
    '',
  ].join('\n')

  const svrun = [
    '<?svml using="@hypit/run-markup@1"?>',
    '<svrun version="1">',
    '  <author source="./main.svml"/>',
    '  <target output="final.video"/>',
    '</svrun>',
    '',
  ].join('\n')

  return { svml: `${lines.join('\n')}\n`, svs, svrun }
}

/** ความยาวจริง + มีเสียงหรือไม่ ของคลิป (Normalize ของ Hypit ต้องรู้ว่าจะเลือก audio stream หรือไม่) */
export function probeClip(filePath: string): Promise<{ durationSec: number; hasAudio: boolean }> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err)
      const video = data?.streams?.find(stream => stream.codec_type === 'video')
      const duration = Number(data?.format?.duration) || Number(video?.duration) || 0
      resolve({ durationSec: duration, hasAudio: Boolean(data?.streams?.some(stream => stream.codec_type === 'audio')) })
    })
  })
}

function runtimeProfile(): Record<string, unknown> {
  const { ffmpegPath, ffprobePath } = getFfmpegBinPaths()
  const tools: Record<string, string> = {}
  if (ffmpegPath) tools.ffmpegPath = ffmpegPath
  if (ffprobePath) tools.ffprobePath = ffprobePath
  const chromePath = process.env.HYPIT_CHROME_PATH
  const workers = Math.max(1, Number(process.env.HYPIT_WORKERS) || 2)
  return {
    format: 'hypit.runtime-local@1',
    dataRoot: '.hypit/runtimes/local',
    endpoints: {
      'media.local': { use: '@hypit/provider-media-local', config: { defaultConcurrency: 2, ...tools } },
      'hyperframes.local': {
        use: '@hypit/provider-hyperframes-local',
        config: { workers, defaultConcurrency: 1, ...tools, ...(chromePath ? { chromePath } : {}) },
      },
    },
  }
}

function runHypit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.HYPIT_NODE || 'node', [hypitBin(), ...args, '--color', 'never'], {
      cwd,
      env: { ...process.env, NO_COLOR: '1' },
    })
    let out = ''
    child.stdout.on('data', chunk => { out += chunk })
    child.stderr.on('data', chunk => { out += chunk })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`Hypit หมดเวลา (${Math.round(HYPIT_TIMEOUT_MS / 1000)}s)`))
    }, HYPIT_TIMEOUT_MS)
    child.on('error', err => { clearTimeout(timer); reject(err) })
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(`hypit ${args[0]} ล้มเหลว (exit ${code}): ${out.trim().slice(-800)}`))
    })
  })
}

/**
 * render คลิปของตัวแปรด้วย Hypit → static/merged/<uuid>.mp4 (path relative แบบเดียวกับ mergedUrl)
 * workdir ชั่วคราวอยู่ใต้ DATA_ROOT/hypit และถูกลบหลังเสร็จ (เก็บไว้เมื่อ HYPIT_KEEP_WORKDIR=1 เพื่อ debug)
 */
export async function renderWithHypit(input: HypitCompositionInput): Promise<string> {
  const status = getHypitStatus()
  if (!status.available) throw new Error(status.reason || 'Hypit ไม่พร้อมใช้งาน')

  const workdir = path.join(DATA_ROOT, 'hypit', uuid())
  const runtimePath = path.join(workdir, 'hypit.runtime.json')
  const common = ['--workspace', workdir]
  fs.mkdirSync(path.join(workdir, 'assets'), { recursive: true })
  try {
    const assetNames = input.clips.map((clip, i) => `beat-${i + 1}${path.extname(clip.videoPath) || '.mp4'}`)
    input.clips.forEach((clip, i) => fs.copyFileSync(clip.videoPath, path.join(workdir, 'assets', assetNames[i])))
    const files = buildHypitComposition(input, assetNames)
    fs.writeFileSync(path.join(workdir, 'package.json'), JSON.stringify({ name: 'naka-clone-render', private: true, type: 'module' }, null, 2))
    fs.writeFileSync(path.join(workdir, 'main.svml'), files.svml, 'utf-8')
    fs.writeFileSync(path.join(workdir, 'recipes.svs'), files.svs, 'utf-8')
    fs.writeFileSync(path.join(workdir, 'main.svrun'), files.svrun, 'utf-8')
    fs.writeFileSync(runtimePath, JSON.stringify(runtimeProfile(), null, 2))

    const buildOut = await runHypit(['build', path.join(workdir, 'main.svrun'), ...common, '--runtime', runtimePath, '--follow'], workdir)
    const buildId = buildOut.match(/bld_[0-9A-Za-z_]+/)?.[0]
    if (!buildId) throw new Error(`ไม่พบ Build id จาก Hypit: ${buildOut.trim().slice(-400)}`)

    const outputRel = `static/merged/${uuid()}.mp4`
    const outputAbs = path.join(STORAGE_ROOT, outputRel.replace(/^static\//, ''))
    fs.mkdirSync(path.dirname(outputAbs), { recursive: true })
    await runHypit(['get', buildId, '--output', 'final.video', ...common, '--to', outputAbs], workdir)
    if (!fs.existsSync(outputAbs)) throw new Error('Hypit build เสร็จแต่ไม่มีไฟล์วิดีโอ')
    return outputRel
  } finally {
    // build เปิด Build Worker ค้างไว้ต่อ workspace — ปิดทุกครั้ง ไม่งั้น process สะสมทีละตัวแปร
    await runHypit(['runtime', 'down', ...common, '--runtime', runtimePath], workdir).catch(() => undefined)
    if (process.env.HYPIT_KEEP_WORKDIR !== '1') fs.rmSync(workdir, { recursive: true, force: true })
  }
}
