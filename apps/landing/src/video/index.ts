// AI video for the AI marketer: sellers upload a reference clip, product photos and (with
// consent) a person's photo to R2; a queued job sends signed links to the active video provider,
// waits for the result without blocking the queue (JobDeferredError) and stores the clip in R2.
import type { Env } from "../types";
import { appOrigin, constantTimeEqual, hmac } from "../auth/common";
import { enqueueJob, JobDeferredError, PermanentJobError, type Job, type JobHandler } from "../jobs";
import { featureRefusal, releaseFeature, useFeature } from "../entitlements";
import { VIDEO_PROVIDERS, VideoProviderRejected, type VideoProvider, type VideoProviderConfig, type VideoRequest } from "./provider";

export const AI_VIDEO_JOB_KIND = "ai_video";
export const DEFAULT_AI_VIDEO_CREDITS = 5;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 200 * 1024 * 1024;
const LINK_SECONDS = 6 * 3600;
const POLL_SECONDS = 30;
const GIVE_UP_SECONDS = 45 * 60;
const now = () => Math.floor(Date.now() / 1000);

export class VideoError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function mediaBucket(env: Env): R2Bucket {
  if (!env.MEDIA) throw new VideoError(503, "ยังไม่ได้เปิดที่เก็บไฟล์ (R2) จึงยังสร้างวิดีโอ AI ไม่ได้");
  return env.MEDIA;
}

export function activeProvider(env: Env): { provider: VideoProvider; config: VideoProviderConfig } {
  const id = env.VIDEO_PROVIDER?.trim();
  if (!id || id === "off") throw new VideoError(503, "ยังไม่ได้ตั้งผู้ให้บริการวิดีโอ AI ในหลังร้าน");
  const provider = VIDEO_PROVIDERS[id];
  if (!provider) throw new VideoError(503, "ยังไม่ได้ติดตั้งตัวเชื่อมผู้ให้บริการวิดีโอนี้");
  const apiKey = env.VIDEO_API_KEY?.trim();
  if (!apiKey) throw new VideoError(503, "ยังไม่ได้ตั้งคีย์ผู้ให้บริการวิดีโอ AI ในหลังร้าน");
  return { provider, config: { apiKey, baseUrl: env.VIDEO_BASE_URL?.trim() || provider.defaultBaseUrl, model: env.VIDEO_MODEL?.trim() || provider.defaultModel } };
}

export function aiVideoCredits(env: Env): number {
  const n = Number(env.AI_VIDEO_CREDITS);
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : DEFAULT_AI_VIDEO_CREDITS;
}

// ---------- uploads ----------

const TYPES = {
  "video/mp4": { kind: "video", ext: "mp4" }, "video/quicktime": { kind: "video", ext: "mov" }, "video/webm": { kind: "video", ext: "webm" },
  "image/jpeg": { kind: "image", ext: "jpg" }, "image/png": { kind: "image", ext: "png" }, "image/webp": { kind: "image", ext: "webp" },
} as const;
type UploadType = keyof typeof TYPES;

/** First bytes of each accepted format, so a renamed file is not stored as something else. */
function looksLike(type: UploadType, b: Uint8Array): boolean {
  const text = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  switch (type) {
    case "video/mp4": case "video/quicktime": return b.length >= 12 && text(4, 8) === "ftyp";
    case "video/webm": return b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
    case "image/jpeg": return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case "image/png": return b.length >= 8 && text(1, 4) === "PNG";
    case "image/webp": return b.length >= 12 && text(0, 4) === "RIFF" && text(8, 12) === "WEBP";
  }
}

/** PUT-style upload: the body is the file. `?person=consented|ai_generated&consent=1` marks a person's photo. */
export async function uploadMedia(request: Request, env: Env, url: URL, userId: string): Promise<Response> {
  const bucket = mediaBucket(env);
  const type = request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() as UploadType;
  const info = TYPES[type];
  if (!info) throw new VideoError(400, "รองรับคลิป MP4/MOV/WebM และรูป JPG/PNG/WebP");
  const person = url.searchParams.get("person");
  if (person !== null) {
    if (info.kind !== "image" || (person !== "consented" && person !== "ai_generated")) throw new VideoError(400, "ระบุประเภทรูปบุคคลไม่ถูกต้อง");
    if (url.searchParams.get("consent") !== "1") throw new VideoError(400, "ต้องยืนยันว่าได้รับความยินยอมจากบุคคลในรูป หรือเป็นใบหน้าที่สร้างด้วย AI");
  }
  const max = info.kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  const declared = request.headers.get("Content-Length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > max)) throw new VideoError(413, `ไฟล์ต้องไม่เกิน ${max / 1024 / 1024} MB`);
  if (!request.body) throw new VideoError(400, "กรุณาเลือกไฟล์");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); throw new VideoError(413, `ไฟล์ต้องไม่เกิน ${max / 1024 / 1024} MB`); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) { data.set(c, offset); offset += c.byteLength; }
  if (!size || !looksLike(type, data)) throw new VideoError(400, "ไฟล์ไม่ตรงกับชนิดที่ระบุ");
  const key = `marketer/${userId}/${crypto.randomUUID()}.${info.ext}`;
  await bucket.put(key, data, { httpMetadata: { contentType: type }, customMetadata: { userId } });
  try {
    await env.DB.prepare(`INSERT INTO marketer_media (key, user_id, kind, content_type, size, person, consent_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(key, userId, info.kind, type, size, person, person ? now() : null, now()).run();
  } catch (error) { await bucket.delete(key); throw error; }
  return new Response(JSON.stringify({ key, kind: info.kind, person }), { status: 201, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

const signature = (env: Env, key: string, exp: number) => hmac(env, JSON.stringify(["marketer-media-v1", key, exp]));

/** An absolute, expiring link the provider (or the seller's browser) can fetch without a session. */
export async function signedMediaUrl(env: Env, key: string, seconds = LINK_SECONDS): Promise<string> {
  const exp = now() + seconds;
  return `${appOrigin(env).origin}/api/marketer/media/${key.split("/").map(encodeURIComponent).join("/")}?e=${exp}&s=${await signature(env, key, exp)}`;
}

/** GET /api/marketer/media/<key> — signed links only; supports a single byte range for playback. */
export async function serveMedia(request: Request, env: Env, url: URL, key: string): Promise<Response> {
  const bucket = mediaBucket(env);
  const exp = Number(url.searchParams.get("e"));
  const sig = url.searchParams.get("s") ?? "";
  if (!/^marketer\/[\w-]{1,80}\/(out\/)?[0-9a-f-]{36}\.(mp4|mov|webm|jpg|png|webp)$/.test(key) || !Number.isSafeInteger(exp) ||
      exp <= now() || exp > now() + LINK_SECONDS || !constantTimeEqual(sig, await signature(env, key, exp))) {
    return new Response("forbidden", { status: 403 });
  }
  const owned = await env.DB.prepare("SELECT content_type FROM marketer_media WHERE key = ?").bind(key).first<{ content_type: string }>();
  if (!owned) return new Response("not found", { status: 404 });
  const range = request.headers.get("Range")?.match(/^bytes=(\d+)-(\d*)$/);
  const object = range
    ? await bucket.get(key, { range: { offset: Number(range[1]), ...(range[2] ? { length: Number(range[2]) - Number(range[1]) + 1 } : {}) } })
    : await bucket.get(key);
  if (!object) return new Response("not found", { status: 404 });
  const headers = new Headers({ "Content-Type": owned.content_type, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" });
  if (range && object.range && "offset" in object.range) {
    const start = object.range.offset ?? 0;
    const length = object.range.length ?? object.size - start;
    headers.set("Content-Range", `bytes ${start}-${start + length - 1}/${object.size}`);
    headers.set("Content-Length", String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { headers });
}

// ---------- creating a video ----------

const KINDS = ["recreate", "replace", "product", "plan"] as const;
type VideoKind = (typeof KINDS)[number];
const RATIOS = ["9:16", "1:1", "16:9"] as const;

interface MediaRow { key: string; kind: string; person: string | null }

/** The English instruction the video model reads; the shot list comes from the marketer's Thai script. */
export function buildVideoPrompt(kind: VideoKind, p: { script: string; productName: string; hasPerson: boolean; productImages: number }): string {
  const product = p.productImages
    ? `The product is ${p.productName ? `"${p.productName}"` : "shown in the product reference images"}: keep its exact shape, label, colours and packaging from the product images.`
    : p.productName ? `The product is "${p.productName}".` : "";
  const person = p.hasPerson ? "The presenter must look exactly like the person in the person reference image (same face, hairstyle and build)." : "";
  const lead = {
    recreate: "Create a new short vertical ad that follows the reference video's structure: the same order of shots, camera moves, framing changes and pacing, but with new content for our product.",
    replace: "Remake the reference video almost shot for shot: keep its scene, camera movement, timing and actions. Replace only the elements named below with the ones in the reference images.",
    product: "Create a short vertical product ad for social commerce, filmed like authentic phone footage with good light.",
    plan: "Create a short vertical ad that follows this creative plan, filmed like authentic phone footage with good light.",
  }[kind];
  return [lead, product, person,
    "Do not add on-screen text, subtitles, logos or watermarks; the seller adds Thai captions later.",
    "Shot plan (Thai, for meaning):", p.script.slice(0, 5000)].filter(Boolean).join("\n").slice(0, 7000);
}

export async function createAiVideo(request: Request, env: Env, userId: string, kick: () => void): Promise<Response> {
  mediaBucket(env);
  const { provider, config } = activeProvider(env);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") throw new VideoError(400, "ข้อมูลไม่ถูกต้อง");
  const kind = KINDS.find((k) => k === body.kind);
  if (!kind) throw new VideoError(400, "ประเภทวิดีโอไม่ถูกต้อง");
  const script = typeof body.script === "string" ? body.script.trim() : "";
  if (!script || script.length > 6000) throw new VideoError(400, "กรุณาใส่บทหรือแผนช็อตของคลิป (ไม่เกิน 6,000 ตัวอักษร)");
  const productName = typeof body.productName === "string" ? body.productName.trim().slice(0, 160) : "";
  const keys = (value: unknown, max: number) => Array.isArray(value) ? value.filter((k): k is string => typeof k === "string").slice(0, max) : [];
  const productKeys = keys(body.productImages, 4);
  const personKey = typeof body.personImage === "string" ? body.personImage : null;
  const sourceKey = typeof body.sourceVideo === "string" ? body.sourceVideo : null;
  const wanted = [...productKeys, ...(personKey ? [personKey] : []), ...(sourceKey ? [sourceKey] : [])];
  const owned = wanted.length ? (await env.DB.prepare(`SELECT key, kind, person FROM marketer_media WHERE user_id = ? AND key IN (${wanted.map(() => "?").join(", ")})`)
    .bind(userId, ...wanted).all<MediaRow>()).results : [];
  const byKey = new Map(owned.map((m) => [m.key, m]));
  if (wanted.some((k) => !byKey.has(k))) throw new VideoError(400, "ไม่พบไฟล์ที่อัปโหลด กรุณาอัปโหลดใหม่");
  if (productKeys.some((k) => byKey.get(k)!.kind !== "image")) throw new VideoError(400, "รูปสินค้าต้องเป็นไฟล์รูป");
  if (personKey && (byKey.get(personKey)!.kind !== "image" || !byKey.get(personKey)!.person)) {
    throw new VideoError(400, "รูปบุคคลต้องอัปโหลดพร้อมยืนยันความยินยอม หรือยืนยันว่าเป็นใบหน้าที่สร้างด้วย AI");
  }
  if (sourceKey && byKey.get(sourceKey)!.kind !== "video") throw new VideoError(400, "คลิปต้นแบบต้องเป็นไฟล์วิดีโอ");
  if ((kind === "recreate" || kind === "replace") && !sourceKey) throw new VideoError(400, "โหมดนี้ต้องมีคลิปต้นแบบที่อัปโหลด");
  if (kind === "replace" && !personKey && !productKeys.length) throw new VideoError(400, "เลือกคนหรือสินค้าที่จะใส่แทนในคลิป");
  if (!sourceKey && !productKeys.length && !personKey) throw new VideoError(400, "เพิ่มรูปสินค้าอย่างน้อย 1 รูป");
  const imageCount = productKeys.length + (personKey ? 1 : 0);
  if (imageCount > provider.limits.images || (sourceKey && provider.limits.videos < 1)) throw new VideoError(400, `${provider.label} รับรูปอ้างอิงได้ ${provider.limits.images} รูป`);
  const duration = Math.min(provider.limits.maxSec, Math.max(provider.limits.minSec, Math.round(Number(body.durationSec) || 10)));
  const ratio = RATIOS.find((r) => r === body.aspectRatio) ?? "9:16";
  const resolution = env.VIDEO_RESOLUTION === "480p" ? "480p" : "720p";
  const prompt = buildVideoPrompt(kind, { script, productName, hasPerson: !!personKey, productImages: productKeys.length });
  const cost = aiVideoCredits(env);
  const id = crypto.randomUUID();
  // the plan's monthly AI videos (docs/entitlements.md): counted first, given back if the job cannot start
  const use = await useFeature(env, userId, "landing.ai_video");
  if (!use.ok) return featureRefusal(use, "วิดีโอ AI");
  const result = await enqueueJob(env.DB, { userId, kind: AI_VIDEO_JOB_KIND, input: { videoId: id }, costCredits: cost, maxAttempts: 3 });
  if (!result.ok) {
    await releaseFeature(env, userId, "landing.ai_video", 1, use.period);
    return new Response(JSON.stringify(result.reason === "insufficient_credits"
      ? { error: `เครดิตไม่พอ วิดีโอ AI ใช้ ${cost} เครดิต`, reason: "credits" } : { error: "มีงานที่กำลังทำอยู่ครบตามแพ็กเกจแล้ว รอให้เสร็จก่อนนะ", reason: "busy" }),
    { status: result.reason === "insufficient_credits" ? 402 : 429, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }
  const input = { productImages: productKeys, personImage: personKey, sourceVideo: sourceKey, durationSec: duration, aspectRatio: ratio, resolution,
    generateAudio: body.generateAudio === true, title: typeof body.title === "string" ? body.title.slice(0, 120) : "" };
  await env.DB.prepare(`INSERT INTO ai_videos (id, user_id, job_id, kind, provider, model, prompt, input, cost_credits, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, userId, result.jobId, kind, provider.id, config.model, prompt, JSON.stringify(input), cost, now(), now()).run();
  kick();
  return new Response(JSON.stringify({ videoId: id, cost }), { status: 202, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

// ---------- the queued job ----------

interface VideoRow {
  id: string; user_id: string; kind: VideoKind; provider: string; model: string; prompt: string; input: string;
  status: string; provider_task_id: string | null; submitted_at: number | null; output_key: string | null;
}

async function markFailed(env: Env, id: string, error: string): Promise<never> {
  await env.DB.prepare("UPDATE ai_videos SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").bind(error, now(), id).run();
  throw new PermanentJobError(error);
}

/** Copy the provider's (expiring) result into R2 under the seller's folder. */
async function keepResult(env: Env, row: VideoRow, videoUrl: string, durationSec?: number) {
  const response = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`result download ${response.status}`);
  const declared = Number(response.headers.get("Content-Length"));
  if (declared > MAX_OUTPUT_BYTES) return markFailed(env, row.id, "result too large");
  const data = new Uint8Array(await response.arrayBuffer());
  if (!data.byteLength || data.byteLength > MAX_OUTPUT_BYTES) return markFailed(env, row.id, "result too large");
  const key = `marketer/${row.user_id}/out/${row.id}.mp4`;
  await mediaBucket(env).put(key, data, { httpMetadata: { contentType: "video/mp4" }, customMetadata: { userId: row.user_id } });
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO marketer_media (key, user_id, kind, content_type, size, created_at) VALUES (?, ?, 'output', 'video/mp4', ?, ?)
      ON CONFLICT(key) DO NOTHING`).bind(key, row.user_id, data.byteLength, now()),
    env.DB.prepare("UPDATE ai_videos SET status = 'done', output_key = ?, duration_sec = ?, error = NULL, updated_at = ? WHERE id = ?")
      .bind(key, durationSec ?? null, now(), row.id),
  ]);
  return { output: { videoId: row.id } };
}

export function makeAiVideoHandler(env: Env): JobHandler {
  return async (job: Job) => {
    let videoId: string;
    try { videoId = String((JSON.parse(job.input) as { videoId: unknown }).videoId); } catch { throw new PermanentJobError("invalid job input"); }
    const row = await env.DB.prepare("SELECT * FROM ai_videos WHERE id = ?").bind(videoId).first<VideoRow>();
    if (!row) throw new PermanentJobError("video row missing");
    if (row.status === "done") return { output: { videoId } };
    if (row.status === "failed") throw new PermanentJobError("video failed");
    const provider = VIDEO_PROVIDERS[row.provider];
    const apiKey = env.VIDEO_API_KEY?.trim();
    if (!provider || !apiKey) return markFailed(env, row.id, "video provider not configured");
    const config = { apiKey, baseUrl: env.VIDEO_BASE_URL?.trim() || provider.defaultBaseUrl, model: row.model || provider.defaultModel };

    if (row.status === "submitting") return markFailed(env, row.id, "submit outcome unknown"); // never pay twice
    if (row.status === "queued") {
      const claimed = await env.DB.prepare("UPDATE ai_videos SET status = 'submitting', updated_at = ? WHERE id = ? AND status = 'queued'").bind(now(), row.id).run();
      if (!claimed.meta.changes) throw new JobDeferredError(10);
      const input = JSON.parse(row.input) as { productImages: string[]; personImage: string | null; sourceVideo: string | null;
        durationSec: number; aspectRatio: VideoRequest["aspectRatio"]; resolution: VideoRequest["resolution"]; generateAudio: boolean };
      const request: VideoRequest = {
        prompt: row.prompt,
        referenceImages: await Promise.all([...(input.personImage ? [input.personImage] : []), ...input.productImages].map((k) => signedMediaUrl(env, k))),
        referenceVideos: input.sourceVideo ? [await signedMediaUrl(env, input.sourceVideo)] : [],
        durationSec: input.durationSec, aspectRatio: input.aspectRatio, resolution: input.resolution, generateAudio: input.generateAudio,
      };
      let submitted;
      try { submitted = await provider.submit(config, request); }
      catch (error) {
        // Rejected = the provider refused before starting: nothing to pay. Anything else may have started.
        return markFailed(env, row.id, error instanceof VideoProviderRejected ? `rejected: ${error.message}`.slice(0, 300) : "submit outcome unknown");
      }
      if ("videoUrl" in submitted) return keepResult(env, row, submitted.videoUrl);
      await env.DB.prepare("UPDATE ai_videos SET status = 'submitted', provider_task_id = ?, submitted_at = ?, updated_at = ? WHERE id = ?")
        .bind(submitted.taskId, now(), now(), row.id).run();
      throw new JobDeferredError(POLL_SECONDS * 2);
    }
    // submitted: look again
    if (now() - (row.submitted_at ?? 0) > GIVE_UP_SECONDS) return markFailed(env, row.id, "provider timeout");
    const result = await provider.poll(config, row.provider_task_id!);
    if (result.status === "running") throw new JobDeferredError(POLL_SECONDS);
    if (result.status === "failed") return markFailed(env, row.id, `provider failed: ${result.error}`.slice(0, 300));
    return keepResult(env, row, result.videoUrl, result.durationSec);
  };
}

/** What the page shows. Provider errors are mapped to short Thai reasons. */
export function publicError(error: string | null): string | null {
  if (!error) return null;
  if (error.includes("not configured")) return "ระบบวิดีโอ AI ยังไม่พร้อม คืนเครดิตให้แล้ว";
  if (error.includes("timeout")) return "ผู้ให้บริการใช้เวลานานเกินไป คืนเครดิตให้แล้ว";
  if (/sensitive|policy|moderation|safety/i.test(error)) return "ผู้ให้บริการปฏิเสธเนื้อหานี้ ลองเปลี่ยนรูปหรือคำอธิบาย คืนเครดิตให้แล้ว";
  if (error.includes("unknown")) return "ส่งงานไม่สำเร็จ คืนเครดิตให้แล้ว";
  return "สร้างวิดีโอไม่สำเร็จ คืนเครดิตให้แล้ว";
}

export async function listAiVideos(env: Env, userId: string) {
  const { results } = await env.DB.prepare(`SELECT v.id, v.kind, v.status, v.error, v.duration_sec AS durationSec, v.cost_credits AS cost,
      v.created_at AS createdAt, v.output_key AS outputKey, json_extract(v.input, '$.title') AS title, j.status AS jobStatus
    FROM ai_videos v LEFT JOIN jobs j ON j.id = v.job_id WHERE v.user_id = ? ORDER BY v.created_at DESC, v.id LIMIT 20`)
    .bind(userId).all<{ id: string; kind: string; status: string; error: string | null; durationSec: number | null; cost: number; createdAt: number;
      outputKey: string | null; title: string | null; jobStatus: string | null }>();
  return Promise.all(results.map(async (v) => ({
    id: v.id, kind: v.kind, title: v.title || "", cost: v.cost, createdAt: v.createdAt, durationSec: v.durationSec,
    // A job that failed before the handler wrote to the row (e.g. no provider) still shows as failed.
    status: v.jobStatus === "failed" && v.status !== "done" ? "failed" : v.status,
    error: publicError(v.error ?? (v.jobStatus === "failed" ? "unknown" : null)),
    url: v.status === "done" && v.outputKey ? await signedMediaUrl(env, v.outputKey) : null,
  })));
}
