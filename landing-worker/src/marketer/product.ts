// URL → video, step 1: read a product page's public details (Open Graph and schema.org Product),
// and hand back image links the review page can load through our signed proxy.
import type { Env } from "../types";
import { constantTimeEqual, hmac } from "../auth/common";

const MAX_PAGE_BYTES = 1_500_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_LINK_SECONDS = 3600;

export class ProductUrlError extends Error {}

/** Public https hosts only: no IP literals, ports, credentials or local names. */
export function publicHttpsUrl(raw: string): URL | null {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (!host.includes(".") || /^[\d.]+$/.test(host) || host.startsWith("[") ||
      /(^|\.)(localhost|local|internal|lan|home|corp|test|invalid|example)$/.test(host)) return null;
  return url;
}

/** fetch() that re-checks every redirect hop, so a public link cannot bounce us somewhere private. */
async function fetchPublic(start: URL, init: RequestInit & { accept: string }, hops = 4): Promise<Response> {
  let url = start;
  for (let i = 0; i <= hops; i++) {
    const response = await fetch(url.href, { redirect: "manual", signal: AbortSignal.timeout(8000),
      headers: { Accept: init.accept, "Accept-Language": "th-TH,th;q=0.9,en;q=0.6",
        "User-Agent": "Mozilla/5.0 (compatible; naka-ai-marketer/1.0; +https://naka-ai.com)" } });
    if (response.status < 300 || response.status >= 400) return response;
    const next = response.headers.get("Location");
    const resolved = next ? publicHttpsUrl(new URL(next, url).href) : null;
    if (!resolved) throw new ProductUrlError("ลิงก์นี้พาไปยังที่อยู่ที่เปิดไม่ได้");
    url = resolved;
  }
  throw new ProductUrlError("ลิงก์นี้เปลี่ยนเส้นทางหลายครั้งเกินไป");
}

async function readCapped(response: Response, max: number): Promise<Uint8Array | null> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) =>
  e[0] === "#" ? String.fromCodePoint(parseInt(e.slice(e[1] === "x" || e[1] === "X" ? 2 : 1), e[1] === "x" || e[1] === "X" ? 16 : 10)) : ENTITIES[e.toLowerCase()] ?? m)
  .replace(/\s+/g, " ").trim();

function metaTags(html: string): Map<string, string[]> {
  const tags = new Map<string, string[]>();
  for (const match of html.matchAll(/<meta\s[^>]*>/gi)) {
    const tag = match[0];
    const key = tag.match(/(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    const content = tag.match(/content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i);
    if (!key || !content) continue;
    const value = decode(content[1] ?? content[2] ?? "");
    if (value) tags.set(key, [...(tags.get(key) ?? []), value]);
  }
  return tags;
}

/** schema.org Product blocks in JSON-LD, which many shops include for Google. */
function jsonLdProducts(html: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const type = obj["@type"];
    if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) found.push(obj);
    if (obj["@graph"]) visit(obj["@graph"]);
  };
  for (const match of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1])); } catch { /* broken JSON-LD: skip */ }
  }
  return found;
}

export interface ProductDetails { url: string; site: string; productName: string; description: string; price: string; images: string[] }

export async function readProductPage(env: Env, raw: string): Promise<ProductDetails> {
  const url = publicHttpsUrl(raw);
  if (!url) throw new ProductUrlError("กรุณาใช้ลิงก์ https ของหน้าสินค้า");
  let response: Response;
  try { response = await fetchPublic(url, { accept: "text/html,application/xhtml+xml" }); }
  catch (error) { throw error instanceof ProductUrlError ? error : new ProductUrlError("เปิดหน้าสินค้าไม่สำเร็จ ลองใหม่หรือกรอกข้อมูลเอง"); }
  if (!response.ok || !/text\/html|xhtml/i.test(response.headers.get("Content-Type") ?? "")) {
    throw new ProductUrlError("หน้าสินค้านี้ไม่เปิดให้อ่านอัตโนมัติ กรอกข้อมูลเองได้เลย");
  }
  const bytes = await readCapped(response, MAX_PAGE_BYTES);
  if (!bytes) throw new ProductUrlError("หน้าสินค้าใหญ่เกินไป กรอกข้อมูลเองได้เลย");
  const html = new TextDecoder().decode(bytes);
  const meta = metaTags(html);
  const first = (...keys: string[]) => keys.map((k) => meta.get(k)?.[0]).find(Boolean) ?? "";
  const product = jsonLdProducts(html)[0] ?? {};
  const offers = (Array.isArray(product.offers) ? product.offers[0] : product.offers) as Record<string, unknown> | undefined;
  const ldImages = ([] as unknown[]).concat(product.image ?? []).map((i) => (typeof i === "string" ? i : (i as { url?: unknown })?.url))
    .filter((i): i is string => typeof i === "string");
  const title = decode(html.match(/<title[^>]*>([\s\S]{1,400}?)<\/title>/i)?.[1] ?? "");
  const priceValue = String(offers?.price ?? offers?.lowPrice ?? first("product:price:amount", "og:price:amount", "price") ?? "").trim();
  const currency = String(offers?.priceCurrency ?? first("product:price:currency", "og:price:currency") ?? "").toUpperCase();
  const images = [...new Set([...ldImages, ...(meta.get("og:image") ?? []), ...(meta.get("og:image:secure_url") ?? []), ...(meta.get("twitter:image") ?? [])]
    .map((i) => { try { return new URL(i, url).href; } catch { return ""; } }).filter((i) => publicHttpsUrl(i)))].slice(0, 6);
  const productName = String(product.name ?? first("og:title", "twitter:title") ?? title).replace(/\s*[|–-]\s*(Shopee|Lazada|TikTok).*$/i, "").slice(0, 160);
  if (!productName && !images.length) throw new ProductUrlError("ไม่พบข้อมูลสินค้าในหน้านี้ กรอกข้อมูลเองได้เลย");
  return {
    url: url.href, site: url.hostname.replace(/^www\./, ""), productName,
    description: String(product.description ?? first("og:description", "description", "twitter:description") ?? "").slice(0, 1500),
    price: priceValue && /^\d+(\.\d+)?$/.test(priceValue.replace(/,/g, "")) ? `${priceValue} ${currency === "THB" || !currency ? "บาท" : currency}` : "",
    images: await Promise.all(images.map((i) => signedImageUrl(env, i))),
  };
}

const signature = (env: Env, target: string, exp: number) => hmac(env, JSON.stringify(["marketer-image-v1", target, exp]));

export async function signedImageUrl(env: Env, target: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + IMAGE_LINK_SECONDS;
  const query = new URLSearchParams({ u: target, e: String(exp), s: await signature(env, target, exp) });
  return `/api/marketer/image?${query}`;
}

/** GET /api/marketer/image — only links this server signed, only images, at most 8 MB. */
export async function proxyImage(env: Env, url: URL): Promise<Response> {
  const target = url.searchParams.get("u") ?? "";
  const exp = Number(url.searchParams.get("e"));
  const sig = url.searchParams.get("s") ?? "";
  const valid = Number.isSafeInteger(exp) && exp > Date.now() / 1000 && sig.length > 20 && constantTimeEqual(sig, await signature(env, target, exp));
  const start = valid ? publicHttpsUrl(target) : null;
  if (!start) return new Response("forbidden", { status: 403 });
  try {
    const response = await fetchPublic(start, { accept: "image/avif,image/webp,image/jpeg,image/png" });
    const type = (response.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
    if (!response.ok || !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(type)) return new Response("not an image", { status: 415 });
    const bytes = await readCapped(response, MAX_IMAGE_BYTES);
    if (!bytes) return new Response("image too large", { status: 413 });
    return new Response(bytes, { headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" } });
  } catch { return new Response("image unavailable", { status: 502 }); }
}

