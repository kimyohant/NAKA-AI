import type { Env } from '../types';
import { getPlan } from '../credits';
import { appOrigin, INBOX_PLANS, InboxError, json, now, pauseThread, readJson, settings } from './common';
import { sendReply } from './send';
export { INBOX_JOB_KIND } from './common';
export { makeInboxHandler } from './draft';
export { handleMetaWebhook } from './webhook';
export { drainInbox } from './queue';

const fields = `id,kind,customer_name AS customerName,status,last_message_at AS lastMessageAt,
  social_account_id AS accountId,auto_paused AS autoPaused`;
async function route(request: Request, env: Env, url: URL, userId: string): Promise<Response> {
  const path = url.pathname.slice('/api/inbox'.length);
  const thread = path.match(/^\/threads\/([\w-]+)(\/handoff)?$/);
  const approve = path.match(/^\/messages\/([\w-]+)\/approve$/);
  const kb = path.match(/^\/kb(?:\/([\w-]+))?$/);
  const allowed = path === '/threads' ? 'GET' : path === '/settings' ? 'GET, PUT' : thread ? thread[2] ? 'POST' : 'GET' : approve ? 'POST' : kb ? kb[1] ? 'DELETE' : 'GET, POST' : '';
  if (!allowed) throw new InboxError(404, 'ไม่พบเส้นทาง');
  if (!allowed.split(', ').includes(request.method)) return json({ error: 'วิธีเรียกใช้งานไม่ถูกต้อง' }, 405, { Allow: allowed });
  if (path === '/threads') {
    const status = url.searchParams.get('status');
    if (status && !['open', 'needs_human', 'closed'].includes(status)) throw new InboxError(400, 'สถานะไม่ถูกต้อง');
    const result = await env.DB.prepare(`SELECT ${fields} FROM inbox_threads WHERE user_id=? AND (?::text IS NULL OR status=?) ORDER BY last_message_at DESC,id LIMIT 100`)
      .bind(userId, status, status).all();
    return json({ threads: result.results });
  }
  if (thread) {
    const found = await env.DB.prepare(`SELECT ${fields} FROM inbox_threads WHERE id=? AND user_id=?`).bind(thread[1], userId).first();
    if (!found) throw new InboxError(404, 'ไม่พบบทสนทนา');
    if (thread[2]) { await pauseThread(env, thread[1], userId); return json({ status: 'needs_human' }); }
    const messages = await env.DB.prepare(`SELECT id,direction,body,draft,confidence,handoff_reason AS handoffReason,status,
      approved_by AS approvedBy,sent_at AS sentAt,created_at AS createdAt,message_at AS messageAt,
      CASE WHEN send_phase IN ('sending','uncertain') THEN 'กรุณาตรวจสอบผลการส่งบน Meta ก่อนส่งใหม่'
      WHEN status='failed' THEN 'ดำเนินการไม่สำเร็จ กรุณาให้ทีมงานช่วยตรวจสอบ' ELSE NULL END AS error
      FROM inbox_messages WHERE thread_id=? AND user_id=? ORDER BY created_at DESC,id DESC LIMIT 100`).bind(thread[1], userId).all();
    return json({ thread: found, messages: messages.results.reverse() });
  }
  if (approve) {
    const body = await readJson(request, 4096);
    if (Object.keys(body).some(key => key !== 'reply')) throw new InboxError(400, 'ข้อมูลไม่ถูกต้อง');
    return json(await sendReply(env, approve[1], userId, body));
  }
  if (path === '/settings') {
    if (request.method === 'GET') {
      const config = await settings(env, userId);
      return json({ mode: config.mode, tone: config.tone, escalate_keywords: JSON.parse(config.escalate_keywords) });
    }
    const body = await readJson(request, 8192);
    if (!['off', 'draft', 'auto'].includes(String(body.mode)) || typeof body.tone !== 'string' || !body.tone.trim() || body.tone.length > 200 ||
        !Array.isArray(body.escalate_keywords) || body.escalate_keywords.length > 30 ||
        body.escalate_keywords.some(value => typeof value !== 'string' || !value.trim() || value.length > 60)) throw new InboxError(400, 'กรุณาตรวจสอบโหมด น้ำเสียง และคำที่ต้องส่งต่อทีมงาน');
    // The pricing page sells the chat bot from the Business package up.
    if (body.mode !== 'off' && !INBOX_PLANS.includes((await getPlan(env.DB, userId)).id))
      throw new InboxError(402, 'แชทบอทใช้ได้ในแพ็กเกจธุรกิจและแพ็กเกจสูงสุด');
    const keywords = [...new Set((body.escalate_keywords as string[]).map(value => value.trim()))];
    await env.DB.prepare(`INSERT INTO inbox_settings (user_id,mode,tone,escalate_keywords,updated_at,revision) VALUES (?,?,?,?,?,1)
      ON CONFLICT(user_id) DO UPDATE SET mode=excluded.mode,tone=excluded.tone,escalate_keywords=excluded.escalate_keywords,
      updated_at=excluded.updated_at,revision=inbox_settings.revision+1`).bind(userId, body.mode, body.tone.trim(), JSON.stringify(keywords), now()).run();
    return json({ mode: body.mode, tone: body.tone.trim(), escalate_keywords: keywords });
  }
  if (kb) {
    if (request.method === 'GET') return json({ items: (await env.DB.prepare('SELECT id,title,content,updated_at AS updatedAt FROM inbox_kb WHERE user_id=? ORDER BY updated_at DESC,id LIMIT 30').bind(userId).all()).results });
    const bump = env.DB.prepare(`INSERT INTO inbox_settings (user_id,updated_at,revision) VALUES (?,?,1)
      ON CONFLICT(user_id) DO UPDATE SET revision=inbox_settings.revision+1,updated_at=excluded.updated_at`).bind(userId, now());
    if (request.method === 'DELETE') {
      await env.DB.batch([env.DB.prepare('DELETE FROM inbox_kb WHERE id=? AND user_id=?').bind(kb[1], userId), bump]);
      return new Response(null, { status: 204 });
    }
    const body = await readJson(request, 20000);
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 160 ||
        typeof body.content !== 'string' || !body.content.trim() || body.content.length > 4000) throw new InboxError(400, 'หัวข้อต้องไม่เกิน 160 ตัวอักษร และเนื้อหาไม่เกิน 4,000 ตัวอักษร');
    const id = crypto.randomUUID();
    const [inserted] = await env.DB.batch([
      env.DB.prepare(`INSERT INTO inbox_kb (id,user_id,title,content,updated_at) SELECT ?,?,?,?,?
        WHERE (SELECT COUNT(*) FROM inbox_kb WHERE user_id=?)<30`).bind(id, userId, body.title.trim(), body.content.trim(), now(), userId), bump,
    ]);
    if (!inserted.meta.changes) throw new InboxError(409, 'คลังความรู้เต็มแล้ว รองรับสูงสุด 30 รายการ');
    return json({ id }, 201);
  }
  throw new InboxError(404, 'ไม่พบเส้นทาง');
}

export async function handleInbox(request: Request, env: Env, url: URL, userId: string): Promise<Response | null> {
  if (url.pathname !== '/api/inbox' && !url.pathname.startsWith('/api/inbox/')) return null;
  let response: Response;
  try {
    if (!userId) throw new InboxError(401, 'กรุณาเข้าสู่ระบบ');
    const origin = appOrigin(env).origin;
    if (url.origin !== origin || new URL(request.url).origin !== origin) throw new InboxError(403, 'กรุณาใช้งานผ่านเว็บไซต์หลัก');
    if (['POST', 'PUT', 'DELETE'].includes(request.method) && (request.headers.get('Origin') !== origin || request.headers.get('Sec-Fetch-Site') === 'cross-site'))
      throw new InboxError(403, 'คำขอไม่ถูกต้อง กรุณาลองจากเว็บไซต์');
    response = await route(request, env, url, userId);
  } catch (error) { response = json({ error: error instanceof InboxError ? error.message : 'ระบบกล่องข้อความขัดข้อง กรุณาลองใหม่ภายหลัง' }, error instanceof InboxError ? error.status : 500); }
  response.headers.set('Cache-Control', 'no-store'); response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}
