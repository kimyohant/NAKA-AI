import type { Env } from '../types';
import { appOrigin, constantTimeEqual, cookie, cookieValue, externalId, now, randomToken, sha256, SocialError, type Platform } from './common';
import { encryptToken, tokenContext } from './crypto';
import { graph, GRAPH_VERSION, metaConfig, PAGE_WEBHOOK_FIELDS, SCOPES } from './meta';

const STATE_COOKIE = 'naka_meta_state';
const callbackUri = (env: Env) => `${appOrigin(env).origin}/api/social/meta/callback`;
export async function metaStart(env: Env, userId: string): Promise<Response> {
  const config = metaConfig(env);
  const state = randomToken();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM social_oauth_states WHERE expires_at <= ? OR user_id = ?').bind(now(), userId),
    env.DB.prepare('INSERT INTO social_oauth_states (id, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256(state), userId, now() + 600),
  ]);
  const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
  url.search = new URLSearchParams({ client_id: config.id, redirect_uri: callbackUri(env), state,
    response_type: 'code', scope: SCOPES.join(',') }).toString();
  return new Response(null, { status: 302, headers: { Location: url.toString(), 'Set-Cookie': cookieValue(env, STATE_COOKIE, state, 600) } });
}

export async function metaCallback(request: Request, env: Env, url: URL, userId: string): Promise<Response> {
  let success = false;
  try {
    const config = metaConfig(env);
    const state = url.searchParams.get('state') || '';
    const storedCookie = cookie(request, STATE_COOKIE) || '';
    if (url.searchParams.getAll('state').length !== 1 || !/^[\w-]{43}$/.test(state) || !constantTimeEqual(state, storedCookie)) throw new Error();
    const claimed = await env.DB.prepare('DELETE FROM social_oauth_states WHERE id = ? AND user_id = ? AND expires_at > ? RETURNING id')
      .bind(await sha256(state), userId, now()).first();
    if (!claimed || url.searchParams.has('error') || url.searchParams.getAll('code').length !== 1) throw new Error();
    const code = url.searchParams.get('code');
    if (!code || code.length > 4096) throw new Error();
    const short = await graph('oauth/access_token', null, { client_id: config.id, client_secret: config.secret, redirect_uri: callbackUri(env), code });
    if (typeof short.access_token !== 'string' || !short.access_token) throw new Error();
    const long = await graph('oauth/access_token', null, { client_id: config.id, client_secret: config.secret,
      grant_type: 'fb_exchange_token', fb_exchange_token: short.access_token });
    if (typeof long.access_token !== 'string' || !long.access_token) throw new Error();
    const duration = long.expires_in ?? long.expires;
    // Conservatively bound page tokens by parent expiry when provided, rather than assuming perpetual access.
    const expiry = Number.isSafeInteger(duration) && duration > 0 ? now() + duration : null;
    const statements: D1PreparedStatement[] = [];
    let after: string | undefined;
    const seen = new Set<string>();
    const pagesToSubscribe: { id: string; token: string }[] = [];
    for (let page = 0; page < 20; page++) {
      const result = await graph('me/accounts', long.access_token, { fields: 'id,name,access_token,tasks,instagram_business_account', limit: '100', ...(after ? { after } : {}) });
      if (!Array.isArray(result.data)) throw new Error();
      for (const item of result.data) {
        if (!externalId(item.id) || typeof item.name !== 'string' || typeof item.access_token !== 'string' || !item.access_token || item.access_token.length > 8192) throw new Error();
        if (!Array.isArray(item.tasks) || !item.tasks.some((task: unknown) => ['CREATE_CONTENT', 'MANAGE', 'PROFILE_PLUS_CREATE_CONTENT', 'PROFILE_PLUS_FULL_CONTROL'].includes(String(task)))) continue;
        const save = async (platform: Platform, id: string, name: string) => {
          if (seen.has(`${platform}:${id}`)) return;
          seen.add(`${platform}:${id}`);
          if (seen.size > 100) throw new SocialError(400, 'กรุณาเลือกบัญชีไม่เกิน 100 บัญชี');
          const encrypted = await encryptToken(env, item.access_token, tokenContext(userId, platform, id));
          statements.push(env.DB.prepare(`INSERT INTO social_accounts (id, user_id, platform, external_id, name, token_enc, token_expires_at, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?) ON CONFLICT(user_id, platform, external_id) DO UPDATE SET
            name = excluded.name, token_enc = excluded.token_enc, token_expires_at = excluded.token_expires_at, status = 'active'`)
            .bind(crypto.randomUUID(), userId, platform, id, name.slice(0, 200), encrypted, expiry, now()));
        };
        await save('facebook', item.id, item.name);
        pagesToSubscribe.push({ id: item.id, token: item.access_token });
        if (item.instagram_business_account) {
          const id = item.instagram_business_account.id;
          if (!externalId(id)) throw new Error();
          const profile = await graph(id, item.access_token, { fields: 'id,username' });
          if (profile.id !== id || typeof profile.username !== 'string') throw new Error();
          await save('instagram', id, profile.username);
        }
      }
      if (!result.paging?.next) break;
      // Never follow a provider-supplied URL with credentials (SSRF/token leakage).
      const cursor = result.paging?.cursors?.after;
      if (typeof cursor !== 'string' || !cursor || cursor.length > 4096 || cursor === after || page === 19) throw new Error();
      after = cursor;
    }
    if (!statements.length) throw new Error();
    await env.DB.batch(statements);
    success = true;
    // Ask Meta to send this page's comments and messages to /webhook/meta (AI inbox).
    // Best effort: posting still works without it, and reconnecting retries it.
    for (const page of pagesToSubscribe) {
      try { await graph(`${page.id}/subscribed_apps`, page.token, { subscribed_fields: PAGE_WEBHOOK_FIELDS }, 'POST'); }
      catch { /* no provider details in logs */ }
    }
  } catch { /* No codes, credentials, provider response bodies, or exception objects in logs. */ }
  return new Response(null, { status: 302, headers: { Location: `${appOrigin(env).origin}/app/?${success ? 'connected=meta' : 'error=meta'}`,
    'Set-Cookie': cookieValue(env, STATE_COOKIE, '', 0) } });
}
