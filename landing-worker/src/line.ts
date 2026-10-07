import type { Env } from "./types";

const LINE_API = "https://api.line.me/v2/bot";
const MAX_TEXT = 5000; // LINE limit per text message

/** Verify the x-line-signature header (HMAC-SHA256 of the raw body, base64). */
export async function verifySignature(body: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  const expected = btoa(String.fromCharCode(...mac));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

function toMessages(text: string) {
  const chunks: string[] = [];
  for (let i = 0; i < text.length && chunks.length < 5; i += MAX_TEXT) chunks.push(text.slice(i, i + MAX_TEXT));
  return chunks.map((t) => ({ type: "text", text: t }));
}

async function call(env: Env, path: string, payload: unknown): Promise<Response> {
  return fetch(`${LINE_API}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });
}

/** Reply with the reply token; fall back to a push message if the token has expired. */
export async function replyOrPush(env: Env, replyToken: string, userId: string, text: string): Promise<void> {
  const messages = toMessages(text);
  const res = await call(env, "/message/reply", { replyToken, messages });
  if (res.ok) return;
  // Log only the status code: LINE error bodies can echo message content the customer sent.
  console.warn("LINE reply failed, falling back to push", res.status);
  const push = await call(env, "/message/push", { to: userId, messages });
  if (!push.ok) console.error("LINE push failed", push.status);
}

/** Push a message outside the reply window (used by admins in human mode). */
export async function pushText(env: Env, userId: string, text: string): Promise<boolean> {
  const res = await call(env, "/message/push", { to: userId, messages: toMessages(text) });
  if (!res.ok) console.error("LINE push failed", res.status);
  return res.ok;
}

/** Show the "typing…" animation while the agent works (1:1 chats only). */
export async function startLoading(env: Env, userId: string): Promise<void> {
  await call(env, "/chat/loading/start", { chatId: userId, loadingSeconds: 30 }).catch(() => undefined);
}

export async function getDisplayName(env: Env, userId: string): Promise<string> {
  const res = await fetch(`${LINE_API}/profile/${userId}`, {
    headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
  });
  if (!res.ok) return "";
  const profile = (await res.json()) as { displayName?: string };
  return profile.displayName ?? "";
}
