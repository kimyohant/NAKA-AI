/**
 * SSRF 安全的出站 HTTP GET — 供「商品链接导入」等抓取用户提供 URL 的场景使用
 *
 * 防护点：
 * - 只允许 http/https，拒绝带账号密码的 URL
 * - 目标地址必须是公网 IP：IP 字面量直接校验；域名在「实际建连时」的 DNS 解析结果上校验
 *   （自定义 lookup 注入 http.request，校验与连接用的是同一次解析，防 DNS rebinding）
 * - 重定向手动跟随（上限 5 跳），每一跳重新走同样的校验
 * - 整体超时（跨重定向共用一个 deadline）+ 响应体大小上限（按解压后字节计，防 gzip 炸弹）
 */
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import dns from 'node:dns'
import zlib from 'node:zlib'
import type { Readable } from 'node:stream'

export class SafeFetchError extends Error {}

export interface SafeFetchOptions {
  /** 整体超时（毫秒），默认 15s */
  timeoutMs?: number
  /** 响应体上限（解压后字节） */
  maxBytes: number
  /** 超过上限时：true = 截断返回已读部分（HTML 场景），false = 报错（图片等二进制场景） */
  truncate?: boolean
  maxRedirects?: number
  headers?: Record<string, string>
}

export interface SafeFetchResult {
  url: string
  status: number
  contentType: string
  body: Buffer
  truncated: boolean
}

// 非公网 IPv4 段（RFC 6890 特殊用途地址：本机/私网/CGNAT/链路本地/文档/基准测试/组播/保留）
const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]
// 非公网 IPv6 段（唯一本地/链路本地/站点本地/组播/文档/丢弃前缀/Teredo/6to4/本地 NAT64）
const BLOCKED_V6: Array<[string, number]> = [
  ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8], ['2001:db8::', 32],
  ['100::', 64], ['2001::', 32], ['2002::', 16], ['64:ff9b:1::', 48],
]

const blockList = new net.BlockList()
for (const [addr, prefix] of BLOCKED_V4) blockList.addSubnet(addr, prefix, 'ipv4')
for (const [addr, prefix] of BLOCKED_V6) blockList.addSubnet(addr, prefix, 'ipv6')

/** IPv6 文本 → 16 字节；非法返回 null（支持 :: 压缩与末尾点分 IPv4） */
function ipv6ToBytes(addr: string): number[] | null {
  let s = addr
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (v4) {
    const parts = v4[1].split('.').map(Number)
    if (parts.some(p => p > 255)) return null
    s = s.slice(0, -v4[1].length)
      + ((parts[0] << 8) | parts[1]).toString(16) + ':' + ((parts[2] << 8) | parts[3]).toString(16)
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail]
  const bytes: number[] = []
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null
    const v = parseInt(g, 16)
    bytes.push(v >> 8, v & 0xff)
  }
  return bytes.length === 16 ? bytes : null
}

/** 是否为不允许访问的地址（私网/回环/链路本地/保留等）；无法识别的输入一律视为拒绝 */
export function isBlockedAddress(ip: string): boolean {
  const addr = ip.replace(/^\[|\]$/g, '').replace(/%.*$/, '')
  const family = net.isIP(addr)
  if (family === 4) return blockList.check(addr, 'ipv4')
  if (family !== 6) return true
  const b = ipv6ToBytes(addr)
  if (!b) return true
  const embeddedV4 = `${b[12]}.${b[13]}.${b[14]}.${b[15]}`
  // ::ffff:a.b.c.d（IPv4 映射）与 64:ff9b::a.b.c.d（NAT64）按内嵌 IPv4 判定
  if (b.slice(0, 10).every(x => x === 0) && b[10] === 0xff && b[11] === 0xff) return isBlockedAddress(embeddedV4)
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every(x => x === 0)) {
    return isBlockedAddress(embeddedV4)
  }
  // ::/96（未指定、回环 ::1、已废弃的 IPv4 兼容地址）
  if (b.slice(0, 12).every(x => x === 0)) return true
  return blockList.check(addr, 'ipv6')
}

/** 建连时的 DNS 解析：任一解析结果落在禁止网段即拒绝（兼容 autoSelectFamily 的 all:true 调用） */
const safeLookup = ((hostname: string, options: dns.LookupOptions, callback: (...args: any[]) => void) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err)
    const list = addresses as dns.LookupAddress[]
    if (!list.length) return callback(new SafeFetchError(`DNS returned no address for ${hostname}`))
    const blocked = list.find(a => isBlockedAddress(a.address))
    if (blocked) return callback(new SafeFetchError(`Blocked non-public address for ${hostname}`))
    if (options?.all) return callback(null, list)
    callback(null, list[0].address, list[0].family)
  })
}) as unknown as net.LookupFunction

/** 校验单个 URL：协议、凭据、IP 字面量 */
export function assertPublicHttpUrl(raw: string | URL): URL {
  let url: URL
  try { url = new URL(String(raw)) } catch { throw new SafeFetchError('Invalid URL') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new SafeFetchError('Only http/https URLs are allowed')
  if (url.username || url.password) throw new SafeFetchError('URLs with credentials are not allowed')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (!host) throw new SafeFetchError('Invalid URL host')
  if (net.isIP(host) && isBlockedAddress(host)) throw new SafeFetchError('Blocked non-public address')
  return url
}

function decodeStream(res: http.IncomingMessage): Readable {
  const enc = String(res.headers['content-encoding'] || '').trim().toLowerCase()
  if (enc === 'gzip' || enc === 'x-gzip') return res.pipe(zlib.createGunzip())
  if (enc === 'deflate') return res.pipe(zlib.createInflate())
  if (enc === 'br') return res.pipe(zlib.createBrotliDecompress())
  return res
}

function requestOnce(url: URL, opts: SafeFetchOptions, signal: AbortSignal): Promise<SafeFetchResult & { location?: string }> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http
    const req = mod.request(url, {
      method: 'GET',
      agent: false,
      lookup: safeLookup,
      signal,
      headers: {
        'Accept-Encoding': 'gzip, deflate, br',
        ...opts.headers,
      },
    }, (res) => {
      const status = res.statusCode || 0
      const contentType = String(res.headers['content-type'] || '')
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        resolve({ url: url.toString(), status, contentType, body: Buffer.alloc(0), truncated: false, location: res.headers.location })
        return
      }
      const declared = Number(res.headers['content-length'] || 0)
      const encoded = Boolean(res.headers['content-encoding'])
      if (!opts.truncate && !encoded && declared > opts.maxBytes) {
        res.destroy()
        reject(new SafeFetchError(`Response too large (${declared} bytes)`))
        return
      }
      const stream = decodeStream(res)
      const chunks: Buffer[] = []
      let size = 0
      let done = false
      const finish = (truncated: boolean) => {
        if (done) return
        done = true
        resolve({ url: url.toString(), status, contentType, body: Buffer.concat(chunks), truncated })
      }
      stream.on('data', (chunk: Buffer) => {
        if (done) return
        size += chunk.length
        if (size > opts.maxBytes) {
          if (opts.truncate) {
            chunks.push(chunk.subarray(0, chunk.length - (size - opts.maxBytes)))
            finish(true)
          } else {
            done = true
            reject(new SafeFetchError(`Response exceeds ${opts.maxBytes} bytes`))
          }
          res.destroy()
          stream.destroy()
          return
        }
        chunks.push(chunk)
      })
      stream.on('end', () => finish(false))
      stream.on('error', (err) => { if (!done) { done = true; reject(err) } })
      res.on('error', (err) => { if (!done) { done = true; reject(err) } })
    })
    req.on('error', reject)
    req.end()
  })
}

/** 安全 GET：跟随重定向（逐跳校验），超时与大小上限见 SafeFetchOptions */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? 15_000
  const maxRedirects = opts.maxRedirects ?? 5
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new SafeFetchError(`Request timed out after ${timeoutMs}ms`)), timeoutMs)
  try {
    let url = assertPublicHttpUrl(rawUrl)
    for (let hop = 0; ; hop++) {
      let res: Awaited<ReturnType<typeof requestOnce>>
      try {
        res = await requestOnce(url, opts, controller.signal)
      } catch (err: any) {
        if (controller.signal.aborted) throw controller.signal.reason instanceof Error ? controller.signal.reason : new SafeFetchError('Request timed out')
        throw err instanceof SafeFetchError ? err : new SafeFetchError(err?.message || 'Request failed')
      }
      if (!res.location) return res
      if (hop >= maxRedirects) throw new SafeFetchError('Too many redirects')
      url = assertPublicHttpUrl(new URL(res.location, url))
    }
  } finally {
    clearTimeout(timer)
  }
}
