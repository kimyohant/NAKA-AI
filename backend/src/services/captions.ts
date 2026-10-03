/**
 * Captions — ซับฝังวิดีโอของ Product Studio (docs/product-studio/PHASE2.md ข้อ 2)
 * - cues จากบทพูด/onScreenText ต่อช็อต · เวลา = ความยาวจริงของคลิป (ffprobe) สะสม — ห้ามใช้ durationSec จากบท
 * - ตัดบรรทัดด้วย Intl.Segmenter (libass ตัดเฉพาะช่องว่าง → ไทย/จีน/ญี่ปุ่นจะล้นจอ)
 * - เขียน .srt + .ass (สไตล์ clean/bold/boxed, วางล่างกลางเว้นขอบล่าง ~15%) + ป้าย AI-generated (เลือกได้)
 * - ฟอนต์ OFL bundle ใน backend/assets/fonts (หรือ CAPTION_FONT_DIR) — ภาษาที่ไม่มีฟอนต์ครอบคลุม → E_CAPTION_FONT_MISSING
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { AppError } from '../utils/response.js'
import { ffmpeg, getFfmpegBinPaths, checkFfmpegSuite } from '../utils/ffmpeg.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const CAPTION_FONT_DIR = process.env.CAPTION_FONT_DIR
  ? path.resolve(process.env.CAPTION_FONT_DIR)
  : path.resolve(__dirname, '../../assets/fonts')

export type CaptionStyle = 'clean' | 'bold' | 'boxed'

export interface CaptionCue {
  start: number
  end: number
  lines: string[]
}

/** ภาษา → ฟอนต์หลัก (ชื่อ family ต้องตรงกับไฟล์ใน fontsdir; libass เติม fallback จากฟอนต์อื่นใน dir เอง) */
const LANGUAGE_FONTS: Record<string, { family: string; files: string[] }> = {
  th: { family: 'Noto Sans Thai', files: ['NotoSansThai-Regular.ttf', 'NotoSansThai-Bold.ttf', 'NotoSans-Regular.ttf', 'NotoSans-Bold.ttf'] },
  ar: { family: 'Noto Sans Arabic', files: ['NotoSansArabic-Regular.ttf', 'NotoSans-Regular.ttf'] },
  zh: { family: 'Noto Sans SC', files: ['NotoSansSC-Variable.ttf', 'NotoSans-Regular.ttf'] },
  ja: { family: 'Noto Sans JP', files: ['NotoSansJP-Variable.ttf', 'NotoSans-Regular.ttf'] },
  ko: { family: 'Noto Sans KR', files: ['NotoSansKR-Variable.ttf', 'NotoSans-Regular.ttf'] },
}
const DEFAULT_FONT = { family: 'Noto Sans', files: ['NotoSans-Regular.ttf', 'NotoSans-Bold.ttf'] }

/** ตรวจว่าฟอนต์สำหรับภาษานี้ถูก bundle มาแล้ว — ไม่มี ⇒ E_CAPTION_FONT_MISSING (merge ต้อง fail ชัด ไม่ใช่ได้ตัวสี่เหลี่ยม) */
export function assertCaptionFontAvailable(language: string, fontDir: string = CAPTION_FONT_DIR): void {
  const font = LANGUAGE_FONTS[language] ?? DEFAULT_FONT
  const primary = path.join(fontDir, font.files[0])
  if (!fs.existsSync(primary)) {
    throw new AppError(`ไม่มีฟอนต์สำหรับภาษา ${language} ในแอป (${font.files[0]})`, 'E_CAPTION_FONT_MISSING')
  }
}

/** ความยาวจริงของคลิป (วินาที) ด้วย ffprobe */
export function probeDurationSec(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg(filePath).ffprobe((err, data) => {
      if (err) return reject(err)
      const duration = Number(data?.format?.duration)
      resolve(Number.isFinite(duration) ? duration : 0)
    })
  })
}

/**
 * ตัดบรรทัด: Intl.Segmenter (word) — แพ็กตามลำดับเดิม ไม่เกิน maxCharsPerLine ต่อบรรทัด
 * เก็บ whitespace segments ตามเดิม → ไทย/จีน (ไม่มีช่องว่าง) เชื่อมคำติดกันถูกต้อง, ภาษาเว้นวรรคคงช่องว่าง
 */
export function splitCaptionLines(text: string, language: string, maxCharsPerLine: number): string[] {
  const segmenter = new Intl.Segmenter(language, { granularity: 'word' })
  const segments = [...segmenter.segment(text)].map(s => s.segment)
  const lines: string[] = []
  let current = ''
  for (const seg of segments) {
    const candidate = current + seg
    if (current && candidate.trimEnd().length > maxCharsPerLine) {
      lines.push(current.trimEnd())
      current = seg.trimStart()
    } else {
      current = candidate
    }
  }
  if (current.trim()) lines.push(current.trimEnd())
  return lines.filter(l => l.length > 0)
}

/**
 * สร้าง cues จากช็อต: ข้อความ = dialogue ?? onScreenText (ไม่มี ⇒ ข้ามช่วงนั้น)
 * เวลาสะสมจากความยาวจริงของคลิป · ข้อความยาวเกิน 2 บรรทัด → แบ่งหลาย cue กระจายเวลาตามสัดส่วนตัวอักษร
 */
export async function buildCaptionCues(
  shots: { text: string | null; clipPath: string | null }[],
  language: string,
  aspectRatio: string,
  opts: { probe?: (clipPath: string) => Promise<number> } = {},
): Promise<CaptionCue[]> {
  const maxCharsPerLine = aspectRatio === '16:9' ? 32 : aspectRatio === '1:1' ? 24 : 18
  const maxLines = 2
  const probe = opts.probe ?? (async (clip: string) => fs.existsSync(clip) ? probeDurationSec(clip) : 0)
  const cues: CaptionCue[] = []
  let cursor = 0
  for (const shot of shots) {
    let duration = 0
    if (shot.clipPath) {
      duration = await probe(shot.clipPath)
    }
    const text = (shot.text || '').trim()
    if (text && duration > 0.2) {
      const lines = splitCaptionLines(text, language, maxCharsPerLine)
      if (lines.length <= maxLines) {
        cues.push({ start: cursor, end: cursor + duration, lines })
      } else {
        // แบ่งเป็นหลาย cue (กลุ่มละ 2 บรรทัด) กระจายเวลาตามสัดส่วนจำนวนตัวอักษร
        const groups: string[][] = []
        for (let i = 0; i < lines.length; i += maxLines) groups.push(lines.slice(i, i + maxLines))
        const sizes = groups.map(g => g.join('').length)
        const totalChars = sizes.reduce((a, b) => a + b, 0) || 1
        let groupStart = cursor
        for (let i = 0; i < groups.length; i++) {
          const share = duration * (sizes[i] / totalChars)
          cues.push({ start: groupStart, end: groupStart + share, lines: groups[i] })
          groupStart += share
        }
      }
    }
    cursor += duration
  }
  return cues
}

function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const milli = ms % 1000
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(milli).padStart(3, '0')}`
}

function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100))
  const h = Math.floor(cs / 360_000)
  const m = Math.floor((cs % 360_000) / 6_000)
  const s = Math.floor((cs % 6_000) / 100)
  const centi = cs % 100
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(centi).padStart(2, '0')}`
}

/** .srt คู่กันเสมอเมื่อมีข้อความ */
export function toSrt(cues: CaptionCue[]): string {
  return cues.map((cue, i) =>
    `${i + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.lines.join('\n')}`,
  ).join('\n\n') + '\n'
}

/** ป้าย AI-generated ตามภาษาโปรเจกต์ (ภาษาอื่น fallback อังกฤษ) */
export function aiLabelText(language: string): string {
  const map: Record<string, string> = {
    th: 'สร้างด้วย AI',
    en: 'AI-generated',
    id: 'Dibuat dengan AI',
    vi: 'Tạo bằng AI',
    ms: 'Dijana oleh AI',
    fil: 'Gawa ng AI',
    zh: 'AI 生成',
    ja: 'AI生成',
    ko: 'AI 생성',
    es: 'Generado con IA',
    pt: 'Gerado por IA',
    ar: 'تم الإنشاء بواسطة الذكاء الاصطناعي',
  }
  return map[language] ?? 'AI-generated'
}

function assStyleBlock(style: CaptionStyle, fontFamily: string, playResY: number): string {
  const marginV = Math.round(playResY * 0.15)
  const fontSize = Math.round(playResY * 0.045)
  // BorderStyle: 1 = outline+shadow · 3 = opaque box (ใช้ OutlineColour เป็นสีกล่อง)
  if (style === 'clean') {
    return `Style: Caption,${fontFamily},${fontSize},&H00FFFFFF,&H00FFFFFF,&H00101010,&H7F000000,0,0,0,0,100,100,0,0,1,1.2,0,2,40,40,${marginV},1`
  }
  if (style === 'boxed') {
    return `Style: Caption,${fontFamily},${fontSize},&H00FFFFFF,&H00FFFFFF,&H66000000,&H66000000,1,0,0,0,100,100,0,0,3,2,0,2,40,40,${marginV},1`
  }
  // bold (default ขายของ): ตัวหนาขอบหนา
  return `Style: Caption,${fontFamily},${fontSize},&H00FFFFFF,&H00FFFFFF,&H00101010,&H7F000000,1,0,0,0,100,100,0,0,1,3,0,2,40,40,${marginV},1`
}

/** .ass สไตล์ clean/bold/boxed — วางล่างกลาง เว้นขอบล่างให้พ้น UI ของ TikTok/Reels (~15% ความสูง) */
export function toAss(cues: CaptionCue[], options: {
  style: CaptionStyle
  language: string
  aspectRatio: string
  aiLabelText?: string | null
  totalDurationSec: number
}): string {
  const playRes = options.aspectRatio === '16:9'
    ? { x: 1280, y: 720 }
    : options.aspectRatio === '1:1'
      ? { x: 1080, y: 1080 }
      : { x: 720, y: 1280 }
  const font = LANGUAGE_FONTS[options.language] ?? DEFAULT_FONT
  const marginV = Math.round(playRes.y * 0.15)
  const labelFontSize = Math.round(playRes.y * 0.025)

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${playRes.x}`,
    `PlayResY: ${playRes.y}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    assStyleBlock(options.style, font.family, playRes.y),
    `Style: AILabel,${font.family},${labelFontSize},&H50FFFFFF,&H50FFFFFF,&H70000000,&H70000000,0,0,0,0,100,100,0,0,1,1,0,9,30,30,${Math.round(playRes.y * 0.03)},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]

  const events = cues.map(cue =>
    `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Caption,,0,0,0,,${cue.lines.join('\\N')}`,
  )
  if (options.aiLabelText && options.totalDurationSec > 0) {
    // ป้ายเล็กมุมจอตลอดความยาว
    events.push(`Dialogue: 1,0:00:00.00,${assTime(options.totalDurationSec)},AILabel,,0,0,0,,${options.aiLabelText}`)
  }
  return [...header, ...events, ''].join('\n')
}

/** escape path สำหรับ filter subtitles/ass (Windows drive colon + backslash) */
function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

/**
 * ฝังซับ (re-encode หลัง concat, CRF ใกล้เคียงต้นฉบับ) ด้วย ffmpeg filter `ass` + fontsdir
 * — ไม่พึ่งฟอนต์ของเครื่อง
 */
export async function burnSubtitles(inputVideo: string, assPath: string, outputVideo: string): Promise<void> {
  const suite = await checkFfmpegSuite()
  if (!suite.ffmpeg) throw new Error('ffmpeg 不可用，无法烧录字幕')
  const { ffmpegPath } = getFfmpegBinPaths()
  if (!ffmpegPath) throw new Error('ffmpeg 不可用，无法烧录字幕')
  const filter = `ass='${escapeFilterPath(assPath)}':fontsdir='${escapeFilterPath(CAPTION_FONT_DIR)}'`
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, [
      '-y',
      '-i', inputVideo,
      '-vf', filter,
      '-c:v', 'libx264', '-crf', '18', '-preset', 'medium',
      '-c:a', 'copy',
      outputVideo,
    ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    let stderr = ''
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); if (stderr.length > 8000) stderr = stderr.slice(-8000) })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg caption burn-in failed (code ${code}): ${stderr.slice(-400)}`))
    })
  })
}
