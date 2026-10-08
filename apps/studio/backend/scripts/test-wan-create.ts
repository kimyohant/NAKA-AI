/**
 * Wan Create adapter 冒烟测试（直接调用 adapter，不经过数据库/任务队列）
 *
 *   WAN_ACCESS_KEY=wan-sk.… npx tsx scripts/test-wan-create.ts [--image-ref <file>] [--video-submit]
 *
 * 默认：文生图 1 次（约 1 积分）；传 --image-ref 再测图生图（含 OSS 上传，约 1 积分）；
 * 视频默认只做上传 + 构建请求（不扣分），加 --video-submit 才真正提交。
 */
import fs from 'node:fs'
import path from 'node:path'
import { WanCreateImageAdapter, WanCreateVideoAdapter } from '../src/services/adapters/wan-create'
import type { AIConfig } from '../src/services/adapters/types'

const key = process.env.WAN_ACCESS_KEY || ''
if (!/^wan-sk\.[^.\s]+\.[^.\s]+$/.test(key)) throw new Error('set WAN_ACCESS_KEY=wan-sk.…')
const args = process.argv.slice(2)
const refFile = args.includes('--image-ref') ? args[args.indexOf('--image-ref') + 1] : ''
const videoSubmit = args.includes('--video-submit')

const config = (model: string): AIConfig => ({ provider: 'wancreate', baseUrl: process.env.WAN_BASE_URL || 'https://create.wan.video', apiKey: key, model })

async function send(req: { url: string; method: string; headers: Record<string, string>; body: any }) {
  const resp = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body === undefined ? undefined : JSON.stringify(req.body) })
  return resp.json() as Promise<any>
}

async function credits() {
  const r = await send({ url: `${config('').baseUrl}/wanx/api/common/imagineCount`, method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'x-platform': 'cli' }, body: {} })
  return r?.data?.availableCount
}

async function runImage(label: string, record: any) {
  const adapter = new WanCreateImageAdapter()
  const cfg = config('wan2.7-flash')
  const prepared = adapter.prepareRecord ? await adapter.prepareRecord(cfg, record) : record
  if ((prepared as any).wanUploads) console.log(`  [${label}] uploaded refs:`, (prepared as any).wanUploads.length)
  const req = adapter.buildGenerateRequest(cfg, prepared)
  console.log(`  [${label}] taskType:`, req.body.taskType)
  const { taskId } = adapter.parseGenerateResponse(await send(req))
  console.log(`  [${label}] taskId:`, taskId)
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 4000))
    const poll = adapter.parsePollResponse(await send(adapter.buildPollRequest(cfg, taskId!)))
    if (poll.status === 'completed') {
      const out = path.resolve(`../data/wan-test/adapter-${label}.png`)
      const img = await fetch(poll.imageUrl!)
      fs.writeFileSync(out, Buffer.from(await img.arrayBuffer()))
      console.log(`  [${label}] ✅ completed → ${out}`)
      return
    }
    if (poll.status === 'failed') throw new Error(`[${label}] failed: ${poll.error}`)
  }
  throw new Error(`[${label}] timeout`)
}

const before = await credits()
console.log('credits before:', before)

await runImage('t2i', { id: 1, prompt: 'A luxury modern-tropical Bangkok mansion courtyard at golden hour, marble floor, palm trees, cinematic drama still', size: '1080x1920' })

if (refFile) {
  const mime = refFile.endsWith('.webp') ? 'image/webp' : refFile.endsWith('.jpg') ? 'image/jpeg' : 'image/png'
  const dataUrl = `data:${mime};base64,${fs.readFileSync(refFile).toString('base64')}`
  await runImage('i2i', { id: 2, prompt: 'Same young woman in the maid uniform, now standing in a grand library with tall mahogany bookshelves, warm lamp light', size: '1080x1920', referenceImages: JSON.stringify([dataUrl]) })

  const vAdapter = new WanCreateVideoAdapter()
  const vcfg = config('wan3.0')
  const vPrepared = await vAdapter.prepareRecord!(vcfg, { id: 3, prompt: 'She slowly turns her head toward the camera, wind moves her ponytail', firstFrameUrl: dataUrl, duration: 5, aspectRatio: '9:16', resolution: '720p' })
  const vReq = vAdapter.buildGenerateRequest(vcfg, vPrepared)
  console.log('  [i2v] uploaded first frame:', !!(vPrepared as any).wanFirst, '| taskType:', vReq.body.taskType, '| model:', vReq.body.taskInput.modelVersion)
  if (videoSubmit) {
    const { taskId } = vAdapter.parseGenerateResponse(await send(vReq))
    console.log('  [i2v] submitted taskId:', taskId)
  } else {
    console.log('  [i2v] (not submitted — pass --video-submit to spend credits)')
  }
}

console.log('credits after:', await credits(), `(used ${before - (await credits())})`)
