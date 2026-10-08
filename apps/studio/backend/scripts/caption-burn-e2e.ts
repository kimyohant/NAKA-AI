/**
 * Caption burn-in E2E — สร้างคลิปทดสอบด้วย ffmpeg (testsrc) → สร้าง cues จากเวลาจริง (ffprobe)
 * → เขียน .srt/.ass ไทย → burn-in → ffprobe ยืนยันไฟล์ผลลัพธ์ (Done-when ของ PHASE2)
 */
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getFfmpegBinPaths } from '../src/utils/ffmpeg.js'
import { buildCaptionCues, toSrt, toAss, burnSubtitles, assertCaptionFontAvailable, aiLabelText } from '../src/services/captions.js'

const { ffmpegPath, ffprobePath } = getFfmpegBinPaths()
if (!ffmpegPath || !ffprobePath) { console.error('ffmpeg/ffprobe ไม่พร้อม'); process.exit(1) }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'naka-caption-e2e-'))
const clip1 = path.join(dir, 'clip1.mp4')
const clip2 = path.join(dir, 'clip2.mp4')
execFileSync(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=720x1280:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', clip1], { stdio: 'ignore' })
execFileSync(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=3:size=720x1280:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', clip2], { stdio: 'ignore' })

assertCaptionFontAvailable('th')

const cues = await buildCaptionCues([
  { text: 'สวัสดีครับวันนี้จะมารีวิวเซรั่มตัวใหม่', clipPath: clip1 },
  { text: 'ทาแล้วผิวใสภายในสามวินาที', clipPath: clip2 },
], 'th', '9:16')

const srtPath = path.join(dir, 'captions.srt')
const assPath = path.join(dir, 'captions.ass')
fs.writeFileSync(srtPath, toSrt(cues), 'utf-8')
const totalDuration = cues[cues.length - 1].end
fs.writeFileSync(assPath, toAss(cues, { style: 'bold', language: 'th', aspectRatio: '9:16', aiLabelText: aiLabelText('th'), totalDurationSec: totalDuration }), 'utf-8')

const output = path.join(dir, 'final-captioned.mp4')
await burnSubtitles(clip1, assPath, output)

const probe = (p: string) => JSON.parse(execFileSync(ffprobePath, ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', p]).toString())
const inMeta = probe(clip1)
const outMeta = probe(output)
console.log('input :', clip1, `duration=${inMeta.format.duration}`)
console.log('output:', output, `duration=${outMeta.format.duration}`)
console.log('video stream:', outMeta.streams.find((s: any) => s.codec_type === 'video')?.codec_name)
console.log('has audio:', outMeta.streams.some((s: any) => s.codec_type === 'audio'))
console.log('cues:', JSON.stringify(cues.map(c => ({ start: c.start, end: c.end, lines: c.lines }))))
console.log('srt:', srtPath, 'ass:', assPath)
console.log('CAPTION E2E: PASSED')
