/**
 * 产品页抓取（URL ingest）— SSRF 安全（校验实现在 utils/safe-fetch.ts）：
 * - 仅 http/https；IP 字面量与「实际建连时」的 DNS 解析结果均须为公网地址（防 DNS rebinding）
 * - 重定向手动跟随逐跳复检；整体超时；响应体积上限（解压后字节计，防 gzip 炸弹）
 * - 解析 JSON-LD Product / OpenGraph / <title>·meta description，图片下载到 storage 后返回 /static/... 路径
 * - 失败统一 AppError('E_INGEST_FAILED')——Shopee/Lazada 类站点可能反爬，前端提示用户手填
 */
import { safeFetch, SafeFetchError } from '../utils/safe-fetch.js'
import { AppError } from '../http/response.js'
import { saveUploadedFile } from '../utils/storage.js'

const PAGE_TIMEOUT_MS = 15_000
const IMAGE_TIMEOUT_MS = 20_000
const MAX_PAGE_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_IMAGES = 6
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

function ingestFail(reason: string): AppError {
  return new AppError(`产品页抓取失败: ${reason}`, 'E_INGEST_FAILED')
}

function toIngestError(err: unknown): AppError {
  if (err instanceof AppError) return err
  const message = err instanceof SafeFetchError ? err.message : '网络错误'
  return ingestFail(message)
}

// ---------- HTML 解析（无 DOM 依赖，正则 + JSON-LD） ----------

function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeFromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

function safeFromCodePoint(code: number): string {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
}

/** 提取全部 <meta> 标签里 property/name 等于 key 的 content（og:image 等可重复出现） */
function extractMetaContents(html: string, key: string): string[] {
  const out: string[] = []
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const prop = /(?:property|name)=["']([^"']+)["']/i.exec(tag)?.[1]
    if (!prop || prop.toLowerCase() !== key.toLowerCase()) continue
    const content = /content=["']([^"']*)["']/i.exec(tag)?.[1]
    if (content !== undefined) out.push(decodeEntities(content).trim())
  }
  return out
}

function extractTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : null
}

interface LdProduct {
  name?: string
  description?: string
  price?: string
  brand?: string
  images: string[]
}

function collectJsonLd(html: string): unknown[] {
  const blocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || []
  const out: unknown[] = []
  for (const block of blocks) {
    const inner = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>\s*$/i, '').trim()
    if (!inner) continue
    try {
      const parsed = JSON.parse(inner)
      if (Array.isArray(parsed)) out.push(...parsed)
      else out.push(parsed)
    } catch { /* 容忍非法 JSON-LD */ }
  }
  return out
}

function walkJsonLd(node: unknown, visit: (obj: Record<string, unknown>) => void): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach(n => walkJsonLd(n, visit))
    return
  }
  const obj = node as Record<string, unknown>
  visit(obj)
  if (obj['@graph']) walkJsonLd(obj['@graph'], visit)
}

/** 归一化 JSON-LD/OG 的图片字段：string | string[] | ImageObject | 数组混合 → 绝对 URL 列表 */
function normalizeLdImages(value: unknown, baseUrl: string): string[] {
  const out: string[] = []
  const visit = (v: unknown) => {
    if (typeof v === 'string') out.push(v)
    else if (Array.isArray(v)) v.forEach(visit)
    else if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>
      const url = obj.url ?? obj.contentUrl
      if (typeof url === 'string') out.push(url)
    }
  }
  visit(value)
  return out
    .map(src => { try { return new URL(src, baseUrl).toString() } catch { return '' } })
    .filter(src => /^https?:/.test(src))
}

function parseProduct(html: string, baseUrl: string): LdProduct & { ogImages: string[] } {
  const result: LdProduct & { ogImages: string[] } = { images: [], ogImages: [] }

  for (const node of collectJsonLd(html)) {
    walkJsonLd(node, (obj) => {
      const type = obj['@type']
      const isProduct = typeof type === 'string' && type.toLowerCase() === 'product'
      if (!isProduct || result.name) return
      if (typeof obj.name === 'string') result.name = decodeEntities(obj.name).trim()
      if (typeof obj.description === 'string') result.description = decodeEntities(obj.description).trim()
      const brand = obj.brand
      if (typeof brand === 'string') result.brand = brand.trim()
      else if (brand && typeof brand === 'object') {
        const name = (brand as Record<string, unknown>).name
        if (typeof name === 'string') result.brand = name.trim()
      }
      const offers = obj.offers
      const offerList = Array.isArray(offers) ? offers : offers ? [offers] : []
      for (const offer of offerList) {
        if (!offer || typeof offer !== 'object') continue
        const o = offer as Record<string, unknown>
        const price = o.price ?? o.lowPrice
        if ((typeof price === 'string' || typeof price === 'number') && result.price === undefined) {
          result.price = String(price)
          const currency = typeof o.priceCurrency === 'string' ? o.priceCurrency : ''
          if (currency) result.price = `${result.price} ${currency}`
          break
        }
      }
      if (obj.image) result.images.push(...normalizeLdImages(obj.image, baseUrl))
    })
  }

  result.ogImages = [
    ...extractMetaContents(html, 'og:image'),
    ...extractMetaContents(html, 'og:image:secure_url'),
    ...extractMetaContents(html, 'og:image:url'),
  ]
    .flatMap(src => normalizeLdImages(src, baseUrl))

  if (!result.name) {
    const ogTitle = extractMetaContents(html, 'og:title')[0]
    if (ogTitle) result.name = ogTitle
  }
  if (!result.description) {
    const ogDesc = extractMetaContents(html, 'og:description')[0]
      || extractMetaContents(html, 'description')[0]
    if (ogDesc) result.description = ogDesc
  }
  if (!result.price) {
    const metaPrice = extractMetaContents(html, 'product:price:amount')[0]
    if (metaPrice) {
      const currency = extractMetaContents(html, 'product:price:currency')[0] || ''
      result.price = currency ? `${metaPrice} ${currency}` : metaPrice
    }
  }
  if (!result.brand) {
    result.brand = extractMetaContents(html, 'og:brand')[0]
      || extractMetaContents(html, 'product:brand')[0]
      || undefined
  }
  if (!result.name) result.name = extractTitle(html) || undefined
  return result
}

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|avif)(?:[?#]|$)/i

function imageExtFromUrl(url: string): string | null {
  const m = IMAGE_EXT_RE.exec(url)
  if (!m) return null
  const ext = m[1].toLowerCase()
  return ext === 'jpeg' ? '.jpg' : `.${ext}`
}

function imageExtFromContentType(contentType: string): string | null {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/avif': '.avif',
  }
  return map[contentType] || null
}

export interface IngestedProduct {
  productName: string
  productDescription: string | null
  price: string | null
  brand: string | null
  /** /static/products/... 路径（已落盘） */
  images: string[]
}

async function downloadProductImage(url: string, referer: string): Promise<string | null> {
  const res = await safeFetch(url, {
    maxBytes: MAX_IMAGE_BYTES,
    timeoutMs: IMAGE_TIMEOUT_MS,
    truncate: false, // 图片超限直接失败（跳过该图）
    headers: { 'user-agent': BROWSER_UA, referer },
  })
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`)
  const contentType = res.contentType.split(';')[0].trim().toLowerCase()
  if (contentType && !contentType.startsWith('image/')) return null
  const ext = imageExtFromUrl(url) || imageExtFromContentType(contentType) || '.png'
  const arrayBuffer = res.body.buffer.slice(res.body.byteOffset, res.body.byteOffset + res.body.byteLength) as ArrayBuffer
  return saveUploadedFile(arrayBuffer, 'products', `product${ext}`)
}

/** 抓取产品页并下载图片；解析不出商品名视为失败（E_INGEST_FAILED） */
export async function ingestProductUrl(rawUrl: string): Promise<IngestedProduct> {
  let html: string
  let finalUrl: string
  try {
    // HTML 超限截断（残留部分仍可解析 meta/JSON-LD），重定向逐跳由 safeFetch 复检
    const page = await safeFetch(rawUrl, {
      maxBytes: MAX_PAGE_BYTES,
      timeoutMs: PAGE_TIMEOUT_MS,
      truncate: true,
      headers: {
        'user-agent': BROWSER_UA,
        'accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        'accept-language': 'th,en;q=0.8,zh;q=0.6',
      },
    })
    if (page.status < 200 || page.status >= 300) throw ingestFail(`HTTP ${page.status}`)
    html = page.body.toString('utf8')
    finalUrl = page.url
  } catch (err) {
    throw toIngestError(err)
  }

  const parsed = parseProduct(html, finalUrl)
  if (!parsed.name) throw ingestFail('未能从页面解析出商品名（站点可能反爬，请手动填写）')

  const images: string[] = []
  const candidates = [...parsed.images, ...parsed.ogImages]
    .filter((src, i, arr) => arr.indexOf(src) === i) // 去重
  for (const candidate of candidates) {
    if (images.length >= MAX_IMAGES) break
    try {
      const saved = await downloadProductImage(candidate, finalUrl)
      if (saved) images.push(`/${saved}`)
    } catch { /* 单图失败跳过，不阻断整体 */ }
  }

  return {
    productName: parsed.name,
    productDescription: parsed.description || null,
    price: parsed.price || null,
    brand: parsed.brand || null,
    images,
  }
}
