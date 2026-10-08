import type { Env } from '../types';
import { type Account, type Post, appOrigin, json, now, readJson, SocialError } from './common';
import { decryptToken, keyBytes, tokenContext } from './crypto';
import { bucket, signedMediaUrl } from './media';
import { graph, MetaError, metaConfig, remoteId } from './meta';

export async function schedule(request: Request, env: Env, userId: string): Promise<Response> {
  bucket(env); keyBytes(env); metaConfig(env);
  if (appOrigin(env).protocol !== 'https:') throw new SocialError(503, 'ต้องใช้เว็บไซต์ HTTPS ที่ Meta เข้าถึงได้เพื่อตั้งเวลาโพสต์');
  const body = await readJson(request, 16384);
  if (typeof body.accountId !== 'string' || body.accountId.length > 100 || typeof body.mediaKey !== 'string' || body.mediaKey.length > 100 ||
      typeof body.caption !== 'string' || [...body.caption].length > 2200) throw new SocialError(400, 'กรุณาระบุบัญชี คลิป และคำบรรยายไม่เกิน 2,200 ตัวอักษร');
  const at = body.publishAt === undefined ? now() : body.publishAt;
  if (typeof at !== 'number' || !Number.isSafeInteger(at) || at < now() - 60 || at > now() + 30 * 86400)
    throw new SocialError(400, 'กรุณาตั้งเวลาเป็น Unix seconds ภายใน 30 วัน');
  const account = await env.DB.prepare('SELECT * FROM social_accounts WHERE id = ? AND user_id = ?').bind(body.accountId, userId).first<Account>();
  if (!account) throw new SocialError(404, 'ไม่พบบัญชี');
  if (account.status !== 'active' || (account.token_expires_at !== null && account.token_expires_at <= Math.max(now(), at)))
    throw new SocialError(409, 'กรุณาเชื่อมต่อบัญชีโซเชียลใหม่');
  const media = await env.DB.prepare('SELECT content_type FROM social_media WHERE key = ? AND user_id = ?').bind(body.mediaKey, userId).first<{ content_type: string }>();
  if (!media) throw new SocialError(404, 'ไม่พบคลิป');
  if (account.platform === 'instagram' && media.content_type !== 'video/mp4') throw new SocialError(400, 'Instagram ต้องใช้คลิป MP4 กรุณาส่งออกคลิปใหม่');
  const id = crypto.randomUUID();
  // Ownership is additionally enforced by composite foreign keys in the migration.
  const inserted = await env.DB.prepare(`INSERT INTO scheduled_posts
    (id, user_id, social_account_id, media_key, caption, publish_at, status, created_at, updated_at, next_attempt_at)
    SELECT ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ? WHERE EXISTS
    (SELECT 1 FROM social_accounts WHERE id = ? AND user_id = ? AND status = 'active' AND
     (token_expires_at IS NULL OR token_expires_at > ?)) RETURNING id`)
    .bind(id, userId, body.accountId, body.mediaKey, body.caption, at, now(), now(), at, body.accountId, userId, Math.max(now(), at)).first();
  if (!inserted) throw new SocialError(409, 'กรุณาเชื่อมต่อบัญชีโซเชียลใหม่');
  return json({ postId: id }, 202);
}

export async function listPosts(env: Env, userId: string): Promise<Response> {
  const result = await env.DB.prepare(`SELECT id, social_account_id AS accountId, media_key AS mediaKey, caption,
    publish_at AS publishAt, status, external_post_id AS externalPostId, attempts, created_at AS createdAt,
    updated_at AS updatedAt, CASE WHEN status = 'failed' THEN 'เผยแพร่คลิปไม่สำเร็จ กรุณาตรวจสอบบัญชีและสถานะโพสต์ก่อนลองใหม่' ELSE NULL END AS error
    FROM scheduled_posts WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100`).bind(userId).all();
  return json({ posts: result.results });
}

const MAX_ATTEMPTS = 5;
const MAX_POLLS = 30;
// Every update is fenced by the current lease. Never let a stale worker send a final publish.
async function checkpoint(env: Env, post: Post, changes: string, values: (string | number | null)[] = []): Promise<void> {
  const result = await env.DB.prepare(`UPDATE scheduled_posts SET ${changes}, updated_at = ?
    WHERE id = ? AND status = 'publishing' AND lease_id = ? AND lease_until > ? RETURNING id`)
    .bind(...values, now(), post.id, post.lease_id, now()).first();
  if (!result) throw new MetaError('lease_lost');
}
async function activeAccount(env: Env, post: Post): Promise<Account> {
  const account = await env.DB.prepare(`SELECT a.* FROM social_accounts a JOIN users u ON u.id = a.user_id
    WHERE a.id = ? AND a.user_id = ? AND a.status = 'active' AND u.status = 'active'
    AND (a.token_expires_at IS NULL OR a.token_expires_at > ?)`).bind(post.social_account_id, post.user_id, now()).first<Account>();
  if (!account) throw new MetaError('account_unavailable');
  return account;
}
async function processPost(env: Env, post: Post): Promise<boolean> {
  const account = await activeAccount(env, post);
  post.used_token_enc = account.token_enc;
  const token = await decryptToken(env, account.token_enc, tokenContext(account.user_id, account.platform, account.external_id));
  const object = await bucket(env).head(post.media_key);
  if (!object) throw new MetaError('media_missing');
  const url = await signedMediaUrl(env, post.media_key);
  let publishedId: string;
  if (account.platform === 'instagram') {
    if (!post.container_id) {
      // Creating an unpublished container is safe to retry; never auto-retry a final publication.
      const created = await graph(`${account.external_id}/media`, token, { media_type: 'REELS', video_url: url, caption: post.caption, share_to_feed: 'true' }, 'POST');
      post.container_id = remoteId(created);
      await checkpoint(env, post, 'container_id = ?', [post.container_id]);
    }
    const status = await graph(post.container_id, token, { fields: 'status_code' });
    if (status.status_code === 'IN_PROGRESS') {
      if (post.polls >= MAX_POLLS) throw new MetaError('processing_deadline');
      await checkpoint(env, post, "status = 'queued', polls = polls + 1, attempts = attempts - 1, next_attempt_at = ?, lease_id = NULL, lease_until = NULL", [now() + 60]);
      return false;
    }
    if (status.status_code !== 'FINISHED') throw new MetaError('container_not_publishable');
    await activeAccount(env, post);
    await checkpoint(env, post, "phase = 'publish_sent'");
    post.phase = 'publish_sent';
    publishedId = remoteId(await graph(`${account.external_id}/media_publish`, token, { creation_id: post.container_id }, 'POST'));
  } else {
    await activeAccount(env, post);
    await checkpoint(env, post, "phase = 'publish_sent'");
    post.phase = 'publish_sent';
    publishedId = remoteId(await graph(`${account.external_id}/videos`, token, { file_url: url, description: post.caption, published: 'true' }, 'POST', true));
  }
  await checkpoint(env, post, "status = 'published', external_post_id = ?, error = NULL, phase = 'done', lease_id = NULL, lease_until = NULL", [publishedId]);
  return true;
}

export async function publishDuePosts(env: Env, { maxPosts }: { maxPosts: number }): Promise<{ published: number; failed: number }> {
  if (!Number.isSafeInteger(maxPosts) || maxPosts < 1 || maxPosts > 20) throw new SocialError(400, 'จำนวนโพสต์ต่อรอบต้องอยู่ระหว่าง 1 ถึง 20');
  bucket(env); metaConfig(env);
  if (appOrigin(env).protocol !== 'https:') throw new SocialError(503, 'ต้องใช้เว็บไซต์ HTTPS เพื่อเผยแพร่คลิป');
  const result = { published: 0, failed: 0 };
  // A crashed worker after publish_sent has an unknown outcome. Quarantine instead of duplicating a post.
  const recovery = await env.DB.prepare(`UPDATE scheduled_posts SET
    status = CASE WHEN phase = 'publish_sent' OR attempts >= ? THEN 'failed' ELSE 'queued' END,
    error = CASE WHEN phase = 'publish_sent' THEN 'publish_outcome_unknown' ELSE 'lease_expired' END,
    lease_id = NULL, lease_until = NULL, next_attempt_at = ?, updated_at = ?
    WHERE status = 'publishing' AND lease_until <= ? RETURNING status`).bind(MAX_ATTEMPTS, now(), now(), now()).all<{ status: string }>();
  result.failed += recovery.results.filter(row => row.status === 'failed').length;
  for (let index = 0; index < maxPosts; index++) {
    const post = await env.DB.prepare(`UPDATE scheduled_posts SET status = 'publishing', attempts = attempts + 1,
      lease_id = ?, lease_until = ?, updated_at = ? WHERE id = (
        SELECT id FROM scheduled_posts WHERE status = 'queued' AND publish_at <= ? AND next_attempt_at <= ?
        ORDER BY publish_at, created_at, id LIMIT 1
      ) AND status = 'queued' RETURNING *`).bind(crypto.randomUUID(), now() + 180, now(), now(), now()).first<Post>();
    if (!post) break;
    try { if (await processPost(env, post)) result.published++; }
    catch (error) {
      const safe = error instanceof MetaError ? error : new MetaError('internal_or_configuration_error');
      if (safe.revoked && post.used_token_enc) await env.DB.prepare("UPDATE social_accounts SET status = 'error', token_enc = '' WHERE id = ? AND user_id = ? AND token_enc = ?")
        .bind(post.social_account_id, post.user_id, post.used_token_enc).run();
      const retry = (post.phase === 'prepare' || safe.rateLimitRejected) && safe.retryable && post.attempts < MAX_ATTEMPTS;
      const updated = await env.DB.prepare(`UPDATE scheduled_posts SET status = ?, phase = ?, error = ?, next_attempt_at = ?,
        updated_at = ?, lease_id = NULL, lease_until = NULL WHERE id = ? AND status = 'publishing' AND lease_id = ? RETURNING id`)
        .bind(retry ? 'queued' : 'failed', retry ? 'prepare' : post.phase, `${post.phase}:${safe.detail}`, now() + Math.min(3600, 60 * 2 ** (post.attempts - 1)), now(), post.id, post.lease_id).first();
      if (updated && !retry) result.failed++;
    }
  }
  return result;
}
