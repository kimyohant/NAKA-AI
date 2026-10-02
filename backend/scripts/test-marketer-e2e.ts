/**
 * AI Marketer E2E — ทดสอบสินค้าไทยจริง: ingest → research → strategy → creatives → produce → extract → storyboard
 *
 * ใช้งาน:
 *   npx tsx scripts/test-marketer-e2e.ts                # flow เต็ม (ต้องมี text config ใน DB ก่อน)
 *   npx tsx scripts/test-marketer-e2e.ts --ingest-only  # ทดสอบเฉพาะ URL ingest (ไม่ต้องมี key)
 *   npx tsx scripts/test-marketer-e2e.ts --products=2   # จำกัดจำนวนสินค้า
 *
 * - แคมเปญทดสอบตั้งชื่อนำหน้า [E2E] เพื่อให้เจอ/ลบง่ายในหน้า UI
 * - รายงานเขียนที่ data/e2e/marketer-e2e-report-<ts>.json
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { and, eq } from 'drizzle-orm'
import { db, schema } from '../src/db/index.js'
import { getTextConfig } from '../src/services/ai.js'
import { ingestProductUrl } from '../src/services/product-ingest.js'
import {
  createCampaign, startResearch, startStrategy, startCreatives,
  getCampaignDetail, produceCreative,
} from '../src/services/marketer.js'
import { startExtraction, getExtractionStatus } from '../src/services/extraction.js'
import { mastra } from '../src/mastra/index.js'
import { buildAgentRequestContext } from '../src/agents/context.js'
import { buildDramaCreativeContext } from '../src/services/drama-context.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const ingestOnly = args.includes('--ingest-only')
const limitArg = args.find(a => a.startsWith('--products='))
const productLimit = limitArg ? Number(limitArg.split('=')[1]) : 5

/** สินค้าไทยจริง — url ให้ ingest เมื่อทำได้, ฟิลด์มือเป็นค่า fallback (ระบุตามของจริง) */
const PRODUCTS = [
  {
    name: 'NaRaYa Wallet',
    url: 'https://www.naraya.com/products/naraya-wallet-1',
    brandNotes: 'สินค้างานเย็บผ้าไทย โทนเป็นมิตร ห้ามโอเวอร์คลเมม',
    notes: 'รีวิวลูกค้า: ตะเข็บเรียบร้อย ผ้าทน ราคาไม่แพง ของฝากคนไทยยอดนิยม',
  },
  {
    name: 'NaRaYa Cosmetic Bag',
    url: 'https://www.naraya.com/products/ถุงเครื่องสำอาง-naraya-1',
    brandNotes: 'กลุ่มเป้าหมายผู้หญิงไทย-นักท่องเที่ยว ห้ามใช้คำเกินจริง',
    notes: 'รีวิว: ใส่เครื่องสำอางได้เยอะ ซักง่าย สีสด มีลายให้เลือกเยอะ',
  },
  {
    name: 'NaRaYa Bubble Up Bundle',
    url: 'https://www.naraya.com/products/bubble-up-online-exclusive-bundle',
    brandNotes: 'ขายออนไลน์เท่านั้น เน้นของครบเซ็ต ราคาคุ้ม',
    notes: 'รีวิว: ซื้อเป็นเซ็ตถูกกว่าซื้อแยก แพ็กสวย ส่งไว',
  },
  {
    // ร้านค้าใหญ่มี bot wall (HTTP 403) → ทดสอบเส้นทาง E_INGEST_FAILED → ผู้ใช้กรอกมือ
    name: 'Watsons Serum',
    url: 'https://www.watsons.co.th/en/skincare/serum/c/010305',
    brandNotes: 'ร้านยา/เครื่องสำอาง โปรโมชันราคาดี',
    notes: 'เซรั่มบำรุงผิวหน้า ราคา 149-590 บาท มีส่วนลดบ่อย',
  },
  {
    // ไม่มี URL (เว็บผู้ผลิตเป็น placeholder) → สร้างแคมเปญแบบกรอกมือล้วน
    name: 'ยาดมโป่งเย็นตราเย็นจิตรลักษณ์',
    brandNotes: 'ของใช้ประจำบ้านคนไทย กลิ่นเย็นซ่า ห้ามพูดถึงสรรพคุณทางยาเกินจริง',
    notes: 'แก้วินัดหมาย ปวดศีรษะ เวียนศีรษะ กลิ่นหอมเย็น ขวดกระปุกเล็กพกพาสะดวก',
  },
]

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface Check { pass: boolean; detail?: string }

async function waitCampaignStatus(campaignId: number, target: string, timeoutMs: number): Promise<void> {
  const start = Date.now()
  for (;;) {
    const detail = await getCampaignDetail(campaignId)
    if (detail && detail.status === target) return
    if (detail && detail.status === 'failed') throw new Error(`campaign failed: ${detail.errorMsg}`)
    if (Date.now() - start > timeoutMs) throw new Error(`timeout (${Math.round(timeoutMs / 1000)}s) waiting for ${target}, last=${detail?.status}`)
    await sleep(5000)
  }
}

/** ตรวจ formatted script ว่าผ่านจุดรับของ extractor/storyboard */
function checkScript(script: string, productName: string): Record<string, Check> {
  const sceneHeaders = script.match(/## S\d+ \| (?:内景|外景) · [^|]+ \| (白天|傍晚|夜晚)/g) || []
  const sceneCount = sceneHeaders.length
  const spokenLines = script.match(/[^\n：]+：（[^）]*）[^\n]+/g) || []
  const tail = script.trimEnd().slice(-160)
  return {
    sceneHeaderFormat: { pass: sceneCount > 0, detail: `${sceneCount} scene(s)` },
    sceneCountFitsDuration: { pass: sceneCount >= 1 && sceneCount <= 2, detail: `${sceneCount} scene(s)` },
    productNameExact: { pass: script.includes(productName), detail: productName },
    dialogueFormat: { pass: spokenLines.length > 0, detail: `${spokenLines.length} line(s)` },
    noMetaText: { pass: !/本片|本广告|此处展示/.test(script) },
    noExtraMarkdown: { pass: !/^## (?!S\d)/m.test(script) && !/\*\*/.test(script) && !/^[-*] /m.test(script) },
    ctaNearEnd: { pass: true, detail: '(soft check)' },
    tailPreview: { pass: true, detail: tail.replace(/\n+/g, ' ⏎ ').slice(0, 140) },
  }
}

interface ProductResult {
  product: string
  campaignId?: number
  ingest?: { ok: boolean; name?: string; images?: number; price?: string | null; error?: string }
  status?: string
  checks?: Record<string, unknown>
  extraction?: Record<string, unknown>
  storyboard?: Record<string, unknown>
  error?: string
  pass?: boolean
}

async function runProduct(p: (typeof PRODUCTS)[number]): Promise<ProductResult> {
  const result: ProductResult = { product: p.name }

  // 1) ingest (มี url เท่านั้น) — ล้มเหลว (bot wall ฯลฯ) ก็ไปต่อด้วยฟิลด์มือ
  if (p.url) {
    try {
      const ing = await ingestProductUrl(p.url)
      result.ingest = { ok: true, name: ing.productName, images: ing.images.length, price: ing.price }
      console.log(`  ingest OK: "${ing.productName}" images=${ing.images.length} price=${ing.price ?? '-'}`)
    } catch (err: any) {
      result.ingest = { ok: false, error: `${err?.errorCode || ''} ${err?.message}`.trim() }
      console.log(`  ingest failed (ใช้ฟิลด์มือแทน): ${result.ingest.error}`)
    }
  }

  // 2) campaign + research → strategy → creatives
  const campaign = await createCampaign({
    title: `[E2E] ${p.name}`,
    productName: p.name,
    productUrl: p.url,
    platforms: ['tiktok', 'shopee'],
    goal: 'สร้างการรู้จัก + ยอดขาย',
    brandNotes: p.brandNotes,
    aspectRatio: '9:16',
  })
  result.campaignId = campaign!.id
  console.log(`  campaign #${campaign!.id} created → research`)
  await startResearch(campaign!.id, p.notes)
  await waitCampaignStatus(campaign!.id, 'research_ready', 360_000)
  console.log('  research_ready → strategy')
  await startStrategy(campaign!.id)
  await waitCampaignStatus(campaign!.id, 'strategy_ready', 480_000)
  console.log('  strategy_ready → creatives')
  await startCreatives(campaign!.id, { count: 2 })
  await waitCampaignStatus(campaign!.id, 'creatives_ready', 480_000)
  console.log('  creatives_ready')

  const detail = await getCampaignDetail(campaign!.id)
  result.status = detail!.status
  const kinds = detail!.docs.map(d => d.kind)
  const marketResearch = detail!.docs.find(d => d.kind === 'market_research')
  const contentBrief = detail!.docs.find(d => d.kind === 'content_brief')
  result.checks = {
    docs: {
      productBrief: kinds.includes('product_brief'),
      marketResearch: kinds.includes('market_research'),
      evidenceAssumptionLabels: marketResearch ? /Evidence/.test(marketResearch.content) && /Assumption/.test(marketResearch.content) : false,
      fourStrategyDocs: ['audience_insight', 'message_map', 'campaign_plan', 'content_brief'].every(k => kinds.includes(k)),
      briefRestatesProductName: contentBrief ? contentBrief.content.includes(p.name) : false,
    },
    creatives: detail!.creatives.map(cr => ({ id: cr.id, format: cr.format, platform: cr.platform, durationSec: cr.durationSec, checks: checkScript(cr.script, p.name) })),
  }

  // 3) produce → extract (props + characters) → storyboard
  const produced = await produceCreative(campaign!.id, detail!.creatives[0].id)
  const [ep] = await db.select().from(schema.episodes)
    .where(and(eq(schema.episodes.dramaId, produced.dramaId), eq(schema.episodes.episodeNumber, produced.episodeNumber)))
  console.log(`  produced → drama ${produced.dramaId} ep ${produced.episodeNumber} (episodeId=${ep.id}) → extract`)

  await startExtraction(ep.id, produced.dramaId, 'props')
  await startExtraction(ep.id, produced.dramaId, 'characters')
  const extractStart = Date.now()
  for (;;) {
    const st = await getExtractionStatus(ep.id)
    const done = ['props', 'characters'].every(t => ['done', 'error', 'cancelled'].includes(st[t]?.status || ''))
    if (done) {
      result.extraction = {
        props: st.props?.status,
        characters: st.characters?.status,
        errors: [st.props?.error, st.characters?.error].filter(Boolean),
      }
      break
    }
    if (Date.now() - extractStart > 300_000) { result.extraction = { timeout: true }; break }
    await sleep(5000)
  }
  const dramaProps = await db.select().from(schema.props).where(eq(schema.props.dramaId, produced.dramaId))
  const productProp = dramaProps.find(pr => !pr.deletedAt && pr.name === p.name)
  const epCharacters = await db.select().from(schema.episodeCharacters).where(eq(schema.episodeCharacters.episodeId, ep.id))
  result.extraction = {
    ...result.extraction,
    propCount: dramaProps.filter(pr => !pr.deletedAt).length,
    productPropExtracted: !!productProp,
    referenceImagesKept: productProp ? !!productProp.referenceImages : false,
    characterCount: epCharacters.length,
  }

  console.log('  extraction done → storyboard')
  try {
    const agent = mastra.getAgent('storyboard_breaker')
    if (!agent) throw new Error('storyboard_breaker agent unavailable')
    const requestContext = buildAgentRequestContext({ episodeId: ep.id, dramaId: produced.dramaId })
    const creativeContext = await buildDramaCreativeContext(produced.dramaId, ep.id)
    await agent.generate([{
      role: 'user',
      content: `${creativeContext ? creativeContext + '\n\n' : ''}请读取当前集剧本（read_storyboard_context），把整集广告脚本完整拆解为分镜段落并保存：第一批调用 save_storyboards 带 replace_existing: true，全部段落保存完成后再结束。`,
    }], { maxSteps: 24, requestContext })
  } catch (err: any) {
    result.storyboard = { error: err?.message }
  }
  const sbs = await db.select().from(schema.storyboards).where(eq(schema.storyboards.episodeId, ep.id))
  const sbLinks = await db.select().from(schema.storyboardProps)
  const productPropBound = !!productProp && sbLinks.some(l => sbs.some(s => s.id === l.storyboardId) && l.propId === productProp.id)
  result.storyboard = {
    ...(result.storyboard || {}),
    count: sbs.length,
    allHaveVideoPrompt: sbs.length > 0 && sbs.every(s => !!s.videoPrompt),
    durationsOk: sbs.length > 0 && sbs.every(s => (s.duration || 0) >= 8 && (s.duration || 0) <= 15),
    productPropBound,
    mentionsProduct: sbs.some(s => (s.description || '').includes(p.name)),
  }

  // สรุป pass/fail
  const creativeChecks = (result.checks as any)?.creatives?.map((c: any) => c.checks) || []
  result.pass = creativeChecks.length > 0
    && creativeChecks.every((c: any) => c.sceneHeaderFormat.pass && c.productNameExact.pass && c.dialogueFormat.pass)
    && !!result.extraction?.productPropExtracted
    && (result.storyboard?.count || 0) > 0
    && (result.storyboard?.allHaveVideoPrompt === true)
  return result
}

async function main() {
  console.log(`AI Marketer E2E — ${ingestOnly ? 'INGEST ONLY' : 'FULL FLOW'} — ${Math.min(productLimit, PRODUCTS.length)} products`)

  if (ingestOnly) {
    for (const p of PRODUCTS.slice(0, productLimit)) {
      if (!p.url) { console.log(`[skip] ${p.name}: no url (manual product)`); continue }
      try {
        const ing = await ingestProductUrl(p.url)
        console.log(`[OK]   ${p.name}\n       name="${ing.productName}" price="${ing.price ?? '-'}" brand="${ing.brand ?? '-'}" images=${ing.images.length}`)
      } catch (err: any) {
        console.log(`[FAIL] ${p.name}: ${err?.errorCode || ''} ${err?.message}`)
      }
    }
    return
  }

  // flow เต็มต้องมี text model
  const textConfig = await getTextConfig().catch(() => null)
  if (!textConfig) {
    console.error('❌ ยังไม่มี text model — ไปที่หน้า Settings เพิ่ม/เปิดใช้ AI service (text) แล้วรันใหม่')
    process.exit(2)
  }
  console.log(`text model: ${textConfig.provider} / ${textConfig.model}`)

  const results: ProductResult[] = []
  for (const p of PRODUCTS.slice(0, productLimit)) {
    console.log(`\n=== ${p.name} ===`)
    try {
      results.push(await runProduct(p))
    } catch (err: any) {
      console.log(`  ❌ ${err?.message}`)
      results.push({ product: p.name, error: err?.message, pass: false })
    }
  }

  const passed = results.filter(r => r.pass).length
  console.log('\n========== SUMMARY ==========')
  for (const r of results) console.log(`${r.pass ? '✅ PASS' : '❌ FAIL'}  ${r.product}${r.campaignId ? ` (campaign #${r.campaignId})` : ''}${r.error ? ` — ${r.error}` : ''}`)
  console.log(`${passed}/${results.length} products passed`)

  const outDir = path.resolve(__dirname, '../../data/e2e')
  fs.mkdirSync(outDir, { recursive: true })
  const report = path.join(outDir, `marketer-e2e-report-${Date.now()}.json`)
  fs.writeFileSync(report, JSON.stringify({ testedAt: new Date().toISOString(), passed, total: results.length, results }, null, 2))
  console.log(`report: ${report}`)
  process.exitCode = passed === results.length ? 0 : 1
}

main().catch(err => { console.error(err); process.exit(1) })
