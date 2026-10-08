import test from 'node:test'
import assert from 'node:assert/strict'
import { buildHypitComposition, layoutClipFrames, wrapCaptionLines } from '../src/services/hypit-render.ts'

test('layoutClipFrames places clips back to back on whole frames', () => {
  assert.deepEqual(layoutClipFrames([{ durationSec: 3 }, { durationSec: 2.51 }, { durationSec: 0.01 }]), [
    { start: 0, end: 90 },
    { start: 90, end: 165 },
    { start: 165, end: 166 },
  ])
})

test('wrapCaptionLines never splits a Thai word', () => {
  const text = 'ยาวมากๆ ให้ขึ้นบรรทัดใหม่ดูว่าตัดคำภาษาไทยได้หรือเปล่านะครับ'
  const lines = wrapCaptionLines(text, 'th', 10)
  assert.ok(lines.length > 1)
  assert.equal(lines.join('').replace(/\s/g, ''), text.replace(/\s/g, ''))
  const words = [...new Intl.Segmenter('th', { granularity: 'word' }).segment(text)]
    .filter(s => s.isWordLike).map(s => s.segment)
  for (const word of words) assert.ok(lines.some(line => line.includes(word)), `word "${word}" was split`)
})

test('wrapCaptionLines wraps spaced languages at spaces', () => {
  assert.deepEqual(wrapCaptionLines('one two three four', 'en', 6), ['one two', 'three four'])
})

test('buildHypitComposition emits clips, audio only for clips with sound, and escaped captions', () => {
  const { svml, svs, svrun } = buildHypitComposition({
    language: 'th',
    captions: { enabled: true, style: 'boxed' },
    clips: [
      { videoPath: '/x/a.mp4', durationSec: 3, hasAudio: true, caption: 'ลด <50%> & {ส่งฟรี}' },
      { videoPath: '/x/b.mp4', durationSec: 2, hasAudio: false, caption: null },
    ],
  }, ['beat-1.mp4', 'beat-2.mp4'])
  assert.match(svml, /<time:Timeline id="program" clock=\{clock\} end="150f"\/>/)
  assert.match(svml, /<media:Video id="clip-1" src="\.\/assets\/beat-1\.mp4"\/>/)
  assert.match(svml, /id="clip-1-media" source=\{clip-1\} video="primary-moving" audio="default"/)
  assert.match(svml, /id="clip-2-media" source=\{clip-2\} video="primary-moving" audio="none"/)
  assert.match(svml, /<audio:Item source=\{clip-1-media\.media\} start="0f" end="90f"\/>/)
  assert.doesNotMatch(svml, /<audio:Item source=\{clip-2-media/)
  assert.match(svml, /start="90f" end="150f" appearance=\{style\.media\.beat\}/)
  assert.match(svml, /ลด &lt;50%&gt; &amp; \{ส่งฟรี\}/)
  assert.doesNotMatch(svml, /id="caption-2"/)
  assert.match(svml, /<fonts:Fallback family="noto-sans-thai"/)
  assert.match(svml, /<text:Box target="line"/)
  assert.match(svs, /language: th;/)
  assert.match(svrun, /<target output="final\.video"\/>/)
})

test('buildHypitComposition omits caption track when captions are disabled', () => {
  const { svml } = buildHypitComposition({
    language: 'en',
    captions: { enabled: false, style: 'bold' },
    clips: [{ videoPath: '/x/a.mp4', durationSec: 1, hasAudio: false, caption: 'hi' }],
  }, ['beat-1.mp4'])
  assert.doesNotMatch(svml, /typography-track|captions\.track|audio:Track/)
})
