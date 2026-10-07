// "Trending videos, ready to replicate": a Thai-first gallery of clips that sell.
// Rows are curated by an admin, imported from a FastMoss/Kalodata export, or pulled from a data
// provider's API (TRENDING_API_URL + TRENDING_API_KEY, set in /admin/system/).
import type { Env } from "../types";
import { CATEGORIES, isCategory, type Category } from "./catalog";

export interface TrendingRow {
  id: string; source: string; url: string; platform: string; region: string; category: string;
  title: string; author: string; product_name: string; thumbnail_url: string | null;
  views: number; likes: number; comments: number; shares: number; revenue_thb: number | null;
  published_at: number | null; active: number; added_by: string; created_at: number; updated_at: number;
}

export interface TrendingInput {
  url: string; platform: Platform; region: string; category: Category; title: string; author: string;
  productName: string; thumbnailUrl: string | null; views: number; likes: number; comments: number;
  shares: number; revenueThb: number | null; publishedAt: number | null;
}

const PLATFORM_HOSTS: Record<string, Platform> = {
  "tiktok.com": "tiktok", "vt.tiktok.com": "tiktok", "vm.tiktok.com": "tiktok",
  "facebook.com": "facebook", "fb.watch": "facebook", "instagram.com": "instagram",
  "youtube.com": "youtube", "youtu.be": "youtube",
};
type Platform = "tiktok" | "facebook" | "instagram" | "youtube";
const now = () => Math.floor(Date.now() / 1000);

/** The platform of a public video link, or null when it is not one we show. */
export function videoPlatform(raw: string): { url: string; platform: Platform } | null {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const platform = PLATFORM_HOSTS[host];
  if (!platform) return null;
  url.hash = "";
  // Tracking parameters make the same clip look like a new row.
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|is_from_webapp|sender_device|_r|_t|igsh|si)/i.test(key)) url.searchParams.delete(key);
  return { url: url.href.slice(0, 600), platform };
}

/** "13.84M", "$726K", "฿1,234", "2.1万" → a whole number; null when it is not a number. */
export function parseMetric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/[,\s฿$]|บาท|THB|USD/gi, "");
  const match = text.match(/^(\d+(?:\.\d+)?)([kmb]|万|ล้าน|พัน)?$/i);
  if (!match) return null;
  const scale = { k: 1e3, m: 1e6, b: 1e9, "万": 1e4, "ล้าน": 1e6, "พัน": 1e3 }[match[2]?.toLowerCase() as "k"] ?? 1;
  const n = Math.round(Number(match[1]) * scale);
  return Number.isSafeInteger(n) ? n : null;
}

function pick(row: Record<string, unknown>, names: readonly string[]): unknown {
  const keys = Object.keys(row);
  for (const name of names) {
    const key = keys.find((k) => k.toLowerCase().replace(/[\s_-]/g, "") === name);
    if (key !== undefined && row[key] !== "" && row[key] !== null && row[key] !== undefined) return row[key];
  }
  return undefined;
}
const str = (value: unknown, max: number) => (typeof value === "string" || typeof value === "number" ? String(value).trim().slice(0, max) : "");

/** Thai or English category names from export files → our category ids. */
const CATEGORY_WORDS: [RegExp, Category][] = [
  [/beauty|cosmetic|skin|makeup|personal care|ความงาม|เครื่องสำอาง|ผิว/i, "beauty"],
  [/health|supplement|สุขภาพ|อาหารเสริม|วิตามิน/i, "health"],
  [/fashion|cloth|apparel|shoe|bag|jewel|แฟชั่น|เสื้อ|กางเกง|รองเท้า|กระเป๋า/i, "fashion"],
  [/food|beverage|drink|snack|อาหาร|เครื่องดื่ม|ขนม/i, "food"],
  [/kitchen|cook|ครัว/i, "kitchen"],
  [/home|household|furniture|living|ของใช้|บ้าน|เฟอร์นิเจอร์/i, "home"],
  [/baby|mom|maternity|kid|แม่|เด็ก/i, "mom_baby"],
  [/phone|electronic|computer|gadget|มือถือ|อิเล็กทรอนิกส์|คอมพิวเตอร์/i, "electronics"],
  [/appliance|เครื่องใช้ไฟฟ้า/i, "appliances"],
  [/sport|outdoor|fitness|กีฬา/i, "sports"],
  [/auto|car|motor|vehicle|ยานยนต์|รถ/i, "auto"],
  [/pet|สัตว์เลี้ยง/i, "pets"],
  [/toy|hobby|game|ของเล่น/i, "toys"],
];
export function toCategory(value: unknown): Category {
  if (isCategory(value)) return value;
  const text = str(value, 200);
  return CATEGORY_WORDS.find(([pattern]) => pattern.test(text))?.[1] ?? "other";
}

function toTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value > 1e12 ? value / 1000 : value);
  if (typeof value !== "string" || !value.trim()) return null;
  if (/^\d{9,13}$/.test(value.trim())) return toTimestamp(Number(value.trim()));
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/**
 * One row from an admin form, an export file, or a provider API, whatever its column names.
 * Revenue is stored in baht; `usdRate` converts files whose revenue is in US dollars.
 */
export function normalizeTrending(raw: unknown, usdRate?: number): TrendingInput | { error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "ข้อมูลไม่ถูกต้อง" };
  const row = raw as Record<string, unknown>;
  const link = videoPlatform(str(pick(row, ["url", "videourl", "videolink", "link", "tiktokurl", "shareurl", "ลิงก์", "ลิงก์คลิป"]), 2000));
  if (!link) return { error: "ต้องเป็นลิงก์คลิป https จาก TikTok, Facebook, Instagram หรือ YouTube" };
  const metric = (names: string[]) => parseMetric(pick(row, names)) ?? 0;
  // A baht column wins; a dollar column needs a rate; an unlabelled one is in the file's currency.
  const thb = parseMetric(pick(row, ["revenuethb", "gmvthb", "ยอดขาย", "รายได้"]));
  const usd = parseMetric(pick(row, ["revenueusd", "gmvusd"]));
  const unlabelled = parseMetric(pick(row, ["revenue", "gmv", "salesamount", "estimatedrevenue", "videorevenue"]));
  const revenue = thb ?? (usd !== null ? (usdRate ? Math.round(usd * usdRate) : null)
    : unlabelled !== null ? (usdRate ? Math.round(unlabelled * usdRate) : unlabelled) : null);
  const thumb = str(pick(row, ["thumbnailurl", "thumbnail", "cover", "coverurl", "image", "ภาพปก"]), 2000);
  const region = str(pick(row, ["region", "country", "market", "ประเทศ"]), 40).toUpperCase();
  return {
    url: link.url, platform: link.platform,
    region: /^[A-Z]{2}$/.test(region) ? region : "TH", // "Thailand", "ไทย" or blank
    category: toCategory(pick(row, ["category", "categoryname", "industry", "หมวด", "หมวดสินค้า"])),
    title: str(pick(row, ["title", "desc", "description", "caption", "videotitle", "แคปชัน", "ชื่อคลิป"]), 600),
    author: str(pick(row, ["author", "creator", "authorname", "nickname", "influencer", "ครีเอเตอร์"]), 120),
    productName: str(pick(row, ["productname", "product", "producttitle", "สินค้า", "ชื่อสินค้า"]), 200),
    thumbnailUrl: /^https:\/\//i.test(thumb) ? thumb : null,
    views: metric(["views", "playcount", "plays", "videoviews", "ยอดวิว"]),
    likes: metric(["likes", "diggcount", "like", "ไลก์"]),
    comments: metric(["comments", "commentcount", "คอมเมนต์"]),
    shares: metric(["shares", "sharecount", "แชร์"]),
    revenueThb: revenue,
    publishedAt: toTimestamp(pick(row, ["publishedat", "createtime", "posttime", "publishtime", "date", "วันที่โพสต์"])),
  };
}

export async function upsertTrending(env: Env, rows: TrendingInput[], source: "curated" | "import" | "api", addedBy: string): Promise<number> {
  const t = now();
  // A row an admin added keeps its source and on/off state when an import or sync updates its numbers.
  const statements = rows.map((r) => env.DB.prepare(`INSERT INTO trending_videos (id, source, url, platform, region, category, title, author,
      product_name, thumbnail_url, views, likes, comments, shares, revenue_thb, published_at, added_by, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?18)
    ON CONFLICT(url) DO UPDATE SET views = MAX(views, excluded.views), likes = MAX(likes, excluded.likes),
      comments = MAX(comments, excluded.comments), shares = MAX(shares, excluded.shares),
      revenue_thb = COALESCE(excluded.revenue_thb, revenue_thb),
      title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE title END,
      author = CASE WHEN excluded.author <> '' THEN excluded.author ELSE author END,
      product_name = CASE WHEN excluded.product_name <> '' THEN excluded.product_name ELSE product_name END,
      thumbnail_url = COALESCE(excluded.thumbnail_url, thumbnail_url),
      category = CASE WHEN excluded.category <> 'other' THEN excluded.category ELSE category END,
      published_at = COALESCE(published_at, excluded.published_at), updated_at = excluded.updated_at`)
    .bind(crypto.randomUUID(), source, r.url, r.platform, r.region, r.category, r.title, r.author, r.productName,
      r.thumbnailUrl, r.views, r.likes, r.comments, r.shares, r.revenueThb, r.publishedAt, addedBy, t));
  for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
  return statements.length;
}

export interface TrendingQuery { category?: string; views?: string; days?: string; sort?: string; region?: string; limit?: number }

export const VIEW_BANDS: Record<string, [number, number]> = {
  under_10k: [0, 10_000], "10k_100k": [10_000, 100_000], "100k_1m": [100_000, 1_000_000], over_1m: [1_000_000, Number.MAX_SAFE_INTEGER],
};

/** Active rows for the gallery, newest-relevant first. Engagement = (likes + comments + shares) / views. */
export async function listTrending(env: Env, q: TrendingQuery) {
  const where = ["active = 1", "region = ?1"];
  const binds: unknown[] = [q.region && /^[A-Z]{2}$/.test(q.region) ? q.region : "TH"];
  if (q.category && isCategory(q.category)) { binds.push(q.category); where.push(`category = ?${binds.length}`); }
  const band = q.views ? VIEW_BANDS[q.views] : undefined;
  if (band) { binds.push(band[0], band[1]); where.push(`views >= ?${binds.length - 1} AND views < ?${binds.length}`); }
  const days = Number(q.days);
  if ([7, 30, 90].includes(days)) { binds.push(now() - days * 86400); where.push(`COALESCE(published_at, created_at) >= ?${binds.length}`); }
  const order = q.sort === "revenue" ? "COALESCE(revenue_thb, -1) DESC, views DESC"
    : q.sort === "engagement" ? "CAST(likes + comments + shares AS REAL) / MAX(views, 1) DESC, views DESC"
    : q.sort === "newest" ? "COALESCE(published_at, created_at) DESC" : "views DESC";
  const limit = Math.min(Math.max(Math.trunc(q.limit ?? 48), 1), 96);
  const { results } = await env.DB.prepare(`SELECT id, url, platform, region, category, title, author, product_name, thumbnail_url,
      views, likes, comments, shares, revenue_thb, published_at FROM trending_videos WHERE ${where.join(" AND ")}
    ORDER BY ${order}, id LIMIT ${limit}`).bind(...binds).all<TrendingRow>();
  return results.map(publicVideo);
}

export function publicVideo(r: Pick<TrendingRow, "id" | "url" | "platform" | "region" | "category" | "title" | "author" | "product_name" |
  "thumbnail_url" | "views" | "likes" | "comments" | "shares" | "revenue_thb" | "published_at">) {
  return { id: r.id, url: r.url, platform: r.platform, region: r.region, category: r.category,
    categoryLabel: CATEGORIES[r.category as Category] ?? CATEGORIES.other, title: r.title, author: r.author,
    productName: r.product_name, thumbnail: r.thumbnail_url, views: r.views, likes: r.likes, comments: r.comments,
    shares: r.shares, revenue: r.revenue_thb, publishedAt: r.published_at,
    engagement: r.views ? Math.round(((r.likes + r.comments + r.shares) / r.views) * 1000) / 10 : 0 };
}

/** Title, author and cover from TikTok's public oEmbed endpoint. Covers are signed and expire, so the cron refreshes them. */
export async function tiktokOembed(url: string): Promise<{ title: string; author: string; thumbnail: string | null } | null> {
  try {
    const response = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(6000) });
    if (!response.ok) return null;
    const body = (await response.json()) as { title?: unknown; author_name?: unknown; thumbnail_url?: unknown };
    const thumbnail = typeof body.thumbnail_url === "string" && body.thumbnail_url.startsWith("https://") ? body.thumbnail_url.slice(0, 2000) : null;
    return { title: str(body.title, 600), author: str(body.author_name, 120), thumbnail };
  } catch { return null; }
}

/** Refresh covers that are a day old. Small batches: this runs inside the per-minute cron. */
export async function refreshTrendingCovers(env: Env, max = 5): Promise<number> {
  const { results } = await env.DB.prepare(`SELECT id, url FROM trending_videos WHERE active = 1 AND platform = 'tiktok' AND updated_at < ?
    ORDER BY updated_at LIMIT ?`).bind(now() - 86400, max).all<{ id: string; url: string }>();
  let refreshed = 0;
  for (const row of results) {
    const meta = await tiktokOembed(row.url);
    // Touch the row either way, so a deleted clip does not block the queue.
    await env.DB.prepare(`UPDATE trending_videos SET thumbnail_url = COALESCE(?, thumbnail_url),
      title = CASE WHEN title = '' THEN ? ELSE title END, updated_at = ? WHERE id = ?`)
      .bind(meta?.thumbnail ?? null, meta?.title ?? "", now(), row.id).run();
    if (meta) refreshed++;
  }
  return refreshed;
}

const MAX_API_ROWS = 500;

/**
 * Pull rows from a data provider (FastMoss, Kalodata or similar, through their enterprise API or a
 * proxy you control). GET TRENDING_API_URL with "Authorization: Bearer TRENDING_API_KEY"; the reply
 * is a JSON array, or an object holding one under data / list / items / videos / results.
 */
export async function syncTrendingApi(env: Env): Promise<{ imported: number; skipped: number } | null> {
  const endpoint = env.TRENDING_API_URL?.trim();
  if (!endpoint) return null;
  const response = await fetch(endpoint, {
    headers: { Accept: "application/json", ...(env.TRENDING_API_KEY?.trim() ? { Authorization: `Bearer ${env.TRENDING_API_KEY.trim()}` } : {}) },
    redirect: "error", signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`trending api ${response.status}`);
  const text = await response.text();
  if (text.length > 5_000_000) throw new Error("trending api reply too large");
  const body = JSON.parse(text) as unknown;
  const list = Array.isArray(body) ? body : ["data", "list", "items", "videos", "results"]
    .map((key) => (body as Record<string, unknown>)?.[key]).find(Array.isArray) as unknown[] | undefined;
  if (!list) throw new Error("trending api reply has no list");
  const rate = Number(env.TRENDING_API_USD_RATE) || undefined;
  const rows = list.slice(0, MAX_API_ROWS).map((item) => normalizeTrending(item, rate));
  const valid = rows.filter((r): r is TrendingInput => !("error" in r));
  await upsertTrending(env, valid, "api", "api");
  return { imported: valid.length, skipped: rows.length - valid.length };
}
