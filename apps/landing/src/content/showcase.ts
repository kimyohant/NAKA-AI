// The home page's clip gallery ("คลังคลิปจริง", public/index.html #reel), managed from /admin/content/.
// The cards written in the HTML stay the source of truth for what they show. A showcase_clips row hides
// one, gives it a place in the order, or adds a clip an admin uploaded (stored in MEDIA, served from
// /showcase-media/). The server rewrites the gallery when it serves "/", and leaves the page exactly
// as written while there are no rows.
import type { Env } from '../types';
import type { AdminActor } from '../admin/auth';

export const CATEGORIES = { review: 'วิดีโอรีวิว', drama: 'ละครสั้น', live: 'AI Live', bot: 'แชทบอท' } as const;
type Category = keyof typeof CATEGORIES;
// what an uploaded card says and links to, like the written cards of the same category
const CARD: Record<Category, { chip: string; href: string; cta: string }> = {
  review: { chip: 'รีวิวสินค้า', href: '/go/studio/skills', cta: 'ทำแบบนี้ในคลังสกิล ↗' },
  drama: { chip: 'ละครสั้น', href: '/go/studio/drama', cta: 'ทำละครแบบนี้ ↗' },
  live: { chip: 'AI Live', href: '/go/studio/live', cta: 'ตั้งค่าไลฟ์ ↗' },
  bot: { chip: 'แชทบอท', href: '/app/inbox/', cta: 'ตั้งค่าบอท ↗' },
};
const MAX_VIDEO = 40 * 1024 * 1024;
const MAX_POSTER = 3 * 1024 * 1024;
const MEDIA_KEY = /^showcase\/[0-9a-f-]{36}\.(mp4|jpg|png|webp)$/;
const GRID_OPEN = '<div class="g-shell g-grid">';
const now = () => Math.floor(Date.now() / 1000);
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
class ContentError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const unescape = (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" } as Record<string, string>)[e]);

// ---------- the written cards ----------

export interface WrittenCard { id: string; category: string; title: string; poster: string | null; video: boolean; html: string; index: number }

/** The cards in the gallery grid of the home page, in their written order, or null if the grid is not found. */
export function parseGallery(html: string): { start: number; end: number; cards: WrittenCard[] } | null {
  const open = html.indexOf(GRID_OPEN);
  if (open < 0) return null;
  const start = open + GRID_OPEN.length;
  const stop = html.indexOf('</section>', start);
  const pattern = /<article class="g-card[^"]*"[\s\S]*?<\/article>/g;
  pattern.lastIndex = start;
  const cards: WrittenCard[] = [];
  const seen = new Map<string, number>();
  let end = start;
  for (let m = pattern.exec(html); m && (stop < 0 || m.index < stop); m = pattern.exec(html)) {
    const card = m[0];
    const src = /<source src="([^"]+)"/.exec(card)?.[1];
    const label = /aria-label="([^"]+)"/.exec(card)?.[1];
    let key = src ?? (label ? 'chat:' + unescape(label) : 'card');
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > 1) key += '#' + n;
    const title = /<h3>([\s\S]*?)<\/h3>/.exec(card)?.[1] ?? label ?? '';
    cards.push({ id: 'static:' + key, category: /data-cat="(\w+)"/.exec(card)?.[1] ?? '', title: unescape(title.replace(/<[^>]+>/g, '')).trim(),
      poster: /poster="([^"]+)"/.exec(card)?.[1] ?? null, video: !!src, html: card, index: cards.length });
    end = m.index + card.length;
  }
  return cards.length ? { start, end, cards } : null;
}

interface ClipRow {
  id: string; kind: 'static' | 'upload'; category: string; title: string; subtitle: string; chip: string;
  video_key: string | null; poster_key: string | null; hidden: number; sort: number | null; updated_at: number;
}

function uploadedCard(row: ClipRow): string {
  const card = CARD[row.category as Category] ?? CARD.review;
  const title = escape(row.title);
  return `<article class="g-card" data-cat="${row.category}">
          <video data-autoplay muted loop playsinline preload="none" poster="/showcase-media/${row.poster_key}" aria-hidden="true"><source src="/showcase-media/${row.video_key}" type="video/mp4"></video>
          <span class="g-chip">${escape(row.chip || card.chip)}</span>
          <button class="reel-sound" type="button" aria-pressed="false" aria-label="เปิดเสียงคลิป ${title}"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="spk" d="M4 9h4l5-4v14l-5-4H4z"/><path class="on" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/><path class="off" d="M16.5 9.5l5 5m0-5l-5 5"/></svg></button>
          <div class="g-cap"><h3>${title}</h3>${row.subtitle ? `<p>${escape(row.subtitle)}</p>` : ''}<a class="g-use" href="${card.href}">${card.cta}</a></div>
        </article>`;
}

interface Placed { id: string; key: number; tie: number; hidden: boolean; category: string; video: boolean; html: string }

/** Every card, written and uploaded, in the order the page shows them (hidden ones included, flagged). */
function arrange(cards: WrittenCard[], rows: ClipRow[]): Placed[] {
  const byId = new Map(rows.map(r => [r.id, r]));
  const placed: Placed[] = cards.map(c => {
    const row = byId.get(c.id);
    return { id: c.id, key: row?.sort ?? c.index, tie: c.index, hidden: row?.hidden === 1, category: c.category, video: c.video, html: c.html };
  });
  rows.filter(r => r.kind === 'upload').forEach((r, i) => placed.push({ id: r.id, key: r.sort ?? -1, tie: -1 - i, hidden: r.hidden === 1,
    category: r.category, video: true, html: uploadedCard(r) }));
  return placed.sort((a, b) => a.key - b.key || a.tie - b.tie);
}

/** The home page with the gallery as the admins arranged it; the counts on the tabs and the heading follow. */
export function renderGallery(html: string, rows: ClipRow[]): string {
  if (!rows.length) return html;
  const parsed = parseGallery(html);
  if (!parsed) return html;
  const shown = arrange(parsed.cards, rows).filter(p => !p.hidden);
  const out = html.slice(0, parsed.start) + '\n        ' + shown.map(p => p.html).join('\n        ') + html.slice(parsed.end);
  const count = (tab: string) => tab === 'all' ? shown.length : shown.filter(p => p.category === tab).length;
  return out
    .replace(/(<button type="button" data-tab="(\w+)"[^>]*>[^<]*<span>)\d+(<\/span>)/g, (_, head: string, tab: string, tail: string) => head + count(tab) + tail)
    .replace(/(คลังคลิปจริง · )\d+( คลิป)/, (_, a: string, b: string) => a + shown.filter(p => p.video).length + b);
}

// rows are read at most once a minute per process; an admin change here drops the copy at once
let cached: { at: number; rows: ClipRow[] } | null = null;
export function forgetShowcase() { cached = null; }
async function clipRows(env: Env): Promise<ClipRow[]> {
  if (cached && Date.now() - cached.at < 60_000) return cached.rows;
  const { results } = await env.DB.prepare('SELECT * FROM showcase_clips').all<ClipRow>();
  cached = { at: Date.now(), rows: results };
  return results;
}

/** The home page as served: the written HTML with the managed gallery. Never fails the page: on any error the HTML as written. */
export async function homeWithGallery(env: Env, html: string): Promise<string> {
  try { return renderGallery(html, await clipRows(env)); } catch { console.error('showcase: gallery not applied'); return html; }
}

// ---------- uploaded media: GET /showcase-media/<key> ----------

export async function serveShowcaseMedia(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/showcase-media/')) return null;
  const key = url.pathname.slice('/showcase-media/'.length);
  if (!MEDIA_KEY.test(key) || !env.MEDIA || (request.method !== 'GET' && request.method !== 'HEAD')) return new Response('Not Found', { status: 404 });
  // videos need byte ranges (Safari will not play an mp4 without them)
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('Range') ?? '');
  const head = await env.MEDIA.get(key);
  if (!head) return new Response('Not Found', { status: 404 });
  const size = head.size;
  const headers = new Headers({ 'Content-Type': head.httpMetadata?.contentType ?? 'application/octet-stream', 'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
  if (range) {
    const offset = Number(range[1]);
    const last = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (offset >= size || last < offset) { (head.body as ReadableStream | null)?.cancel?.(); return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } }); }
    (head.body as ReadableStream | null)?.cancel?.();
    const part = await env.MEDIA.get(key, { range: { offset, length: last - offset + 1 } });
    if (!part) return new Response('Not Found', { status: 404 });
    headers.set('Content-Range', `bytes ${offset}-${last}/${size}`);
    headers.set('Content-Length', String(last - offset + 1));
    return new Response(request.method === 'HEAD' ? null : part.body as ReadableStream, { status: 206, headers });
  }
  headers.set('Content-Length', String(size));
  if (request.method === 'HEAD') { (head.body as ReadableStream | null)?.cancel?.(); return new Response(null, { status: 200, headers }); }
  return new Response(head.body as ReadableStream, { status: 200, headers });
}

// ---------- admin API: /api/admin/content/clips ----------

const audit = (env: Env, who: string, target: string, action: string, detail: unknown) =>
  env.DB.prepare(`INSERT INTO system_audit (id, area, target, action, detail, note, actor, created_at) VALUES (?, 'content', ?, ?, ?, '', ?, ?)`)
    .bind(crypto.randomUUID(), target, action, JSON.stringify(detail), who, now());

async function writtenCards(env: Env, url: URL): Promise<WrittenCard[]> {
  const page = await env.ASSETS.fetch(new Request(new URL('/', url.origin)));
  if (!page.ok) throw new ContentError(502, 'อ่านหน้าแรกของเว็บไม่ได้');
  return parseGallery(await page.text())?.cards ?? [];
}

async function catalogue(env: Env, url: URL) {
  const [cards, rows] = await Promise.all([writtenCards(env, url), env.DB.prepare('SELECT * FROM showcase_clips').all<ClipRow>()]);
  const byId = new Map(rows.results.map(r => [r.id, r]));
  const written = new Map(cards.map(c => [c.id, c]));
  const list = arrange(cards, rows.results).map((p, position) => {
    const card = written.get(p.id);
    const row = byId.get(p.id);
    return card
      ? { id: p.id, kind: 'static', category: card.category, title: card.title, poster: card.poster, video: card.video, hidden: p.hidden, position }
      : { id: p.id, kind: 'upload', category: row!.category, title: row!.title, subtitle: row!.subtitle, chip: row!.chip,
        poster: `/showcase-media/${row!.poster_key}`, video: true, hidden: p.hidden, position };
  });
  return { list, cards, rows: rows.results };
}

/** What a file really is, from its first bytes (the browser's type is only a claim). */
function sniff(bytes: Uint8Array): 'mp4' | 'jpg' | 'png' | 'webp' | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length > 12 && ascii(4, 8) === 'ftyp') return 'mp4';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  return null;
}
const TYPE = { mp4: 'video/mp4', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const;
const text = (form: FormData, field: string, max: number, label: string, required = false): string => {
  const value = form.get(field);
  const s = typeof value === 'string' ? value.trim() : '';
  if (required && !s) throw new ContentError(400, `กรุณากรอก${label}`);
  if (s.length > max || /[\u0000-\u001f\u007f]/.test(s)) throw new ContentError(400, `${label}ต้องยาวไม่เกิน ${max} ตัวอักษร และไม่มีการขึ้นบรรทัดใหม่`);
  return s;
};

async function upload(request: Request, env: Env, who: string): Promise<string> {
  if (!env.MEDIA) throw new ContentError(503, 'ยังไม่ได้ตั้งที่เก็บไฟล์ (MEDIA_DIR หรือ R2) จึงอัปโหลดคลิปไม่ได้');
  if (Number(request.headers.get('Content-Length')) > MAX_VIDEO + MAX_POSTER + 65536) throw new ContentError(413, 'ไฟล์ใหญ่เกินไป คลิปไม่เกิน 40 MB รูปปกไม่เกิน 3 MB');
  let form: FormData;
  try { form = await request.formData(); } catch { throw new ContentError(400, 'ส่งข้อมูลเป็น multipart/form-data'); }
  const category = text(form, 'category', 10, 'ประเภท', true);
  if (!(category in CATEGORIES)) throw new ContentError(400, 'ประเภทไม่ถูกต้อง');
  const title = text(form, 'title', 80, 'ชื่อคลิป', true);
  const subtitle = text(form, 'subtitle', 120, 'คำอธิบาย');
  const chip = text(form, 'chip', 30, 'ป้าย');
  const video = form.get('video'), poster = form.get('poster');
  if (!(video instanceof File) || !(poster instanceof File)) throw new ContentError(400, 'กรุณาเลือกไฟล์คลิป (MP4) และรูปปก');
  if (video.size > MAX_VIDEO) throw new ContentError(413, 'คลิปต้องไม่เกิน 40 MB');
  if (poster.size > MAX_POSTER) throw new ContentError(413, 'รูปปกต้องไม่เกิน 3 MB');
  const videoBytes = new Uint8Array(await video.arrayBuffer()), posterBytes = new Uint8Array(await poster.arrayBuffer());
  if (sniff(videoBytes) !== 'mp4') throw new ContentError(400, 'ไฟล์คลิปต้องเป็น MP4');
  const posterType = sniff(posterBytes);
  if (posterType !== 'jpg' && posterType !== 'png' && posterType !== 'webp') throw new ContentError(400, 'รูปปกต้องเป็น JPG, PNG หรือ WebP');
  const id = crypto.randomUUID();
  const videoKey = `showcase/${id}.mp4`, posterKey = `showcase/${id}.${posterType}`;
  await env.MEDIA.put(videoKey, videoBytes, { httpMetadata: { contentType: TYPE.mp4 } });
  await env.MEDIA.put(posterKey, posterBytes, { httpMetadata: { contentType: TYPE[posterType] } });
  try {
    // new uploads go first in the gallery
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO showcase_clips (id, kind, category, title, subtitle, chip, video_key, poster_key, hidden, sort, updated_by, updated_at)
        SELECT ?1, 'upload', ?2, ?3, ?4, ?5, ?6, ?7, 0, LEAST(COALESCE(MIN(sort), 0), 0) - 1, ?8, ?9 FROM showcase_clips`)
        .bind(id, category, title, subtitle, chip, videoKey, posterKey, who, now()),
      audit(env, who, id, 'create', { category, title, size: video.size }),
    ]);
  } catch (error) {
    await env.MEDIA.delete([videoKey, posterKey]).catch(() => undefined); // no orphaned files
    throw error;
  }
  return id;
}

async function body(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ContentError(400, 'กรุณาส่งข้อมูลเป็น JSON');
  try {
    const value: unknown = JSON.parse(await request.text());
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* below */ }
  throw new ContentError(400, 'ข้อมูลไม่ถูกต้อง');
}

export async function handleAdminShowcase(request: Request, env: Env, url: URL, actor: AdminActor): Promise<Response | null> {
  const BASE = '/api/admin/content/clips';
  if (url.pathname !== BASE && !url.pathname.startsWith(BASE + '/')) return null;
  const path = url.pathname.slice(BASE.length);
  const method = request.method, who = actor.label;
  try {
    if (path === '' && method === 'GET') {
      const { list } = await catalogue(env, url);
      return json({ clips: list, mediaReady: !!env.MEDIA, categories: CATEGORIES });
    }
    if (path === '' && method === 'POST') {
      const id = await upload(request, env, who);
      forgetShowcase();
      return json({ ok: true, id, clips: (await catalogue(env, url)).list }, 201);
    }
    if (path === '/order' && method === 'PUT') {
      const input = await body(request);
      const { list } = await catalogue(env, url);
      const ids = input.ids;
      const known = new Set(list.map(c => c.id));
      if (!Array.isArray(ids) || ids.length !== known.size || new Set(ids).size !== ids.length || !ids.every(id => typeof id === 'string' && known.has(id))) {
        throw new ContentError(409, 'รายการคลิปเปลี่ยนไปแล้ว กรุณาโหลดหน้าใหม่');
      }
      const t = now();
      await env.DB.batch([
        ...ids.map((id, i) => env.DB.prepare(`INSERT INTO showcase_clips (id, kind, sort, updated_by, updated_at) VALUES (?1, 'static', ?2, ?3, ?4)
          ON CONFLICT (id) DO UPDATE SET sort = excluded.sort, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).bind(id, i, who, t)),
        audit(env, who, 'order', 'update', { count: ids.length }),
      ]);
      forgetShowcase();
      return json({ clips: (await catalogue(env, url)).list });
    }
    const one = path.match(/^\/([^/]{1,400})$/);
    if (one) {
      let id: string;
      try { id = decodeURIComponent(one[1]); } catch { throw new ContentError(400, 'รหัสคลิปไม่ถูกต้อง'); }
      const { list, rows } = await catalogue(env, url);
      const clip = list.find(c => c.id === id);
      if (!clip) throw new ContentError(404, 'ไม่พบคลิปนี้');
      if (method === 'PUT') {
        const input = await body(request);
        if (typeof input.hidden !== 'boolean') throw new ContentError(400, 'ส่ง { hidden: true หรือ false }');
        await env.DB.batch([
          env.DB.prepare(`INSERT INTO showcase_clips (id, kind, hidden, updated_by, updated_at) VALUES (?1, 'static', ?2, ?3, ?4)
            ON CONFLICT (id) DO UPDATE SET hidden = excluded.hidden, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
            .bind(id, input.hidden ? 1 : 0, who, now()),
          audit(env, who, id, 'update', { title: clip.title, after: { hidden: input.hidden } }),
        ]);
        forgetShowcase();
        return json({ clips: (await catalogue(env, url)).list });
      }
      if (method === 'DELETE') {
        if (clip.kind !== 'upload') throw new ContentError(400, 'คลิปที่เขียนไว้ในหน้าเว็บลบไม่ได้ ใช้ "ซ่อน" แทน');
        const row = rows.find(r => r.id === id)!;
        await env.DB.batch([env.DB.prepare('DELETE FROM showcase_clips WHERE id = ?').bind(id), audit(env, who, id, 'remove', { title: row.title })]);
        await env.MEDIA?.delete([row.video_key!, row.poster_key!]).catch(() => console.error('showcase: media not deleted'));
        forgetShowcase();
        return json({ clips: (await catalogue(env, url)).list });
      }
    }
    return json({ error: 'ไม่พบรายการนี้' }, 404);
  } catch (error) {
    if (error instanceof ContentError) return json({ error: error.message }, error.status);
    console.error('admin showcase: request failed');
    return json({ error: 'ระบบขัดข้อง กรุณาลองใหม่' }, 500);
  }
}
