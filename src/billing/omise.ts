import type { Env } from "../types";

// Minimal Omise (Opn Payments) client. References:
//   https://docs.omise.co/promptpay   — POST /sources (type=promptpay) then POST /charges; QR at
//                                        charge.source.scannable_code.image.download_uri; event charge.complete
//   https://docs.omise.co/omise-js    — card token (tokn_) charged server-side; 3-D Secure via authorize_uri
//   https://docs.omise.co/api-webhooks — Omise-Signature = hex HMAC-SHA256(base64-decoded secret, "<ts>.<raw body>")

const API = "https://api.omise.co";

export class OmiseError extends Error {}

export interface Charge {
  id: string;
  status: "pending" | "successful" | "failed" | "expired" | "reversed" | string;
  amount: number;
  currency: string;
  paid?: boolean;
  metadata?: Record<string, unknown>;
  authorize_uri?: string | null;
  failure_code?: string | null;
  source?: { scannable_code?: { image?: { download_uri?: string } } } | null;
}

async function call<T>(env: Pick<Env, "OMISE_SECRET_KEY">, method: "GET" | "POST", path: string, fields?: Record<string, string>): Promise<T> {
  if (!env.OMISE_SECRET_KEY?.trim()) throw new OmiseError("omise_not_configured");
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Basic ${btoa(`${env.OMISE_SECRET_KEY}:`)}`,
        ...(fields ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      ...(fields ? { body: new URLSearchParams(fields) } : {}),
    });
  } catch {
    throw new OmiseError("omise_network");
  }
  const data = (await response.json().catch(() => null)) as (T & { object?: string; code?: string }) | null;
  // Keep only the status and Omise's error code; never the message or request details.
  if (!response.ok || !data || data.object === "error") throw new OmiseError(`omise_${response.status}_${data?.code ?? "unknown"}`);
  return data;
}

const metadata = (paymentId: string, userId: string) => ({ "metadata[payment_id]": paymentId, "metadata[user_id]": userId });

export async function createPromptPayCharge(
  env: Pick<Env, "OMISE_SECRET_KEY">,
  input: { amount: number; paymentId: string; userId: string; expiresAt: number },
): Promise<Charge> {
  const source = await call<{ id: string }>(env, "POST", "/sources", { amount: String(input.amount), currency: "THB", type: "promptpay" });
  return call<Charge>(env, "POST", "/charges", {
    amount: String(input.amount),
    currency: "THB",
    source: source.id,
    expires_at: new Date(input.expiresAt * 1000).toISOString(),
    ...metadata(input.paymentId, input.userId),
  });
}

export async function createCardCharge(
  env: Pick<Env, "OMISE_SECRET_KEY">,
  input: { amount: number; token: string; paymentId: string; userId: string; returnUri: string },
): Promise<Charge> {
  return call<Charge>(env, "POST", "/charges", {
    amount: String(input.amount),
    currency: "THB",
    card: input.token,
    return_uri: input.returnUri,
    ...metadata(input.paymentId, input.userId),
  });
}

export function getCharge(env: Pick<Env, "OMISE_SECRET_KEY">, chargeId: string): Promise<Charge> {
  if (!/^chrg_[A-Za-z0-9_]{1,100}$/.test(chargeId)) throw new OmiseError("invalid_charge_id");
  return call<Charge>(env, "GET", `/charges/${chargeId}`);
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
function sameText(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Verify Omise-Signature over "<timestamp>.<raw body>". Accepts either signature during secret rotation. */
export async function verifyWebhook(env: Pick<Env, "OMISE_WEBHOOK_SECRET">, headers: Headers, rawBody: string, nowSeconds: number): Promise<boolean> {
  const secret = env.OMISE_WEBHOOK_SECRET?.trim();
  const signatures = headers.get("Omise-Signature");
  const timestamp = headers.get("Omise-Signature-Timestamp");
  if (!secret || !signatures || !timestamp || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > 300) return false; // reject replays older than 5 minutes
  let keyBytes: Uint8Array;
  try {
    keyBytes = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`)));
  return signatures.split(",").some((signature) => sameText(signature.trim().toLowerCase(), expected));
}
