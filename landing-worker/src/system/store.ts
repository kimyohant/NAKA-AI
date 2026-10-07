// Settings saved from the system control panel, merged over the Worker's vars and secrets.
// Secrets are AES-GCM encrypted with SETTINGS_KEY (base64, 32 bytes) and bound to their key name.
import type { Env } from '../types';
import { SETTING_BY_KEY, SETTINGS } from './registry';

const encoder = new TextEncoder();
const CACHE_MS = 10_000;

export class SettingsKeyError extends Error {}

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}

/** True when SETTINGS_KEY is a canonical base64 encoding of exactly 32 bytes. */
export function settingsKeyReady(env: Pick<Env, 'SETTINGS_KEY'>): boolean {
  const raw = env.SETTINGS_KEY?.trim(); // a secret piped in from PowerShell may end with a newline
  if (!raw || !/^[A-Za-z0-9+/]{43}=$/.test(raw)) return false;
  try { return btoa(String.fromCharCode(...unb64(raw))) === raw; } catch { return false; }
}

async function aesKey(env: Pick<Env, 'SETTINGS_KEY'>, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  if (!settingsKeyReady(env)) throw new SettingsKeyError('SETTINGS_KEY is missing or invalid');
  return crypto.subtle.importKey('raw', unb64(env.SETTINGS_KEY!.trim()), 'AES-GCM', false, [usage]);
}
// AAD ties a ciphertext to its key name, so a row copied to another key does not decrypt.
const context = (key: string) => encoder.encode(JSON.stringify(['system-setting-v1', key]));

export async function encryptSetting(env: Pick<Env, 'SETTINGS_KEY'>, key: string, value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: context(key) }, await aesKey(env, 'encrypt'), encoder.encode(value));
  return `v1.${b64url(iv)}.${b64url(new Uint8Array(sealed))}`;
}

export async function decryptSetting(env: Pick<Env, 'SETTINGS_KEY'>, key: string, stored: string): Promise<string> {
  const parts = stored.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || !/^[\w-]{16}$/.test(parts[1]) || !/^[\w-]+$/.test(parts[2])) throw new Error('bad ciphertext');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(parts[1]), additionalData: context(key) }, await aesKey(env, 'decrypt'), unb64(parts[2]));
  return new TextDecoder().decode(plain);
}

export interface StoredRow { key: string; value: string; secret: number; hint: string | null; updated_at: number }

// One cache per database binding (tests use a fresh one each), refreshed every few seconds per isolate.
const cache = new WeakMap<object, { at: number; key: string | undefined; values: Promise<Map<string, string>> }>();

export function invalidateSettings(db: D1Database): void { cache.delete(db); }

async function readValues(env: Env): Promise<Map<string, string>> {
  const { results } = await env.DB.prepare('SELECT key, value, secret, hint, updated_at FROM system_settings').all<StoredRow>();
  const values = new Map<string, string>();
  for (const row of results) {
    const def = SETTING_BY_KEY.get(row.key);
    if (!def || (row.secret === 1) !== (def.kind === 'secret')) continue; // unknown or tampered row: ignore
    if (row.secret !== 1) { values.set(row.key, row.value); continue; }
    try { values.set(row.key, await decryptSetting(env, row.key, row.value)); }
    catch { console.error('system setting could not be decrypted', row.key); } // falls back to the Worker's value
  }
  return values;
}

/** Values saved in the panel (secrets decrypted). An unreadable table means none, so the site keeps running on wrangler config. */
export async function savedSettings(env: Env): Promise<Map<string, string>> {
  if (!env.DB) return new Map();
  const hit = cache.get(env.DB);
  if (hit && hit.key === env.SETTINGS_KEY && Date.now() - hit.at < CACHE_MS) return hit.values;
  const values = readValues(env).catch(() => { console.error('system settings unavailable'); cache.delete(env.DB); return new Map<string, string>(); });
  cache.set(env.DB, { at: Date.now(), key: env.SETTINGS_KEY, values });
  return values;
}

/** The env every handler sees: panel values first, then wrangler vars/secrets, then switch defaults. */
export async function withSettings(env: Env): Promise<Env> {
  const saved = await savedSettings(env);
  const merged = { ...env } as Env & Record<string, unknown>;
  for (const def of SETTINGS) {
    const value = saved.get(def.key) ?? (typeof merged[def.key] === 'string' ? (merged[def.key] as string).trim() : undefined);
    if (value) merged[def.key] = value;
    else if (def.default !== undefined) merged[def.key] = def.default;
  }
  // These switches work by hiding the provider's config: every existing "is it configured?" check then agrees.
  if (merged.FEATURE_GOOGLE_LOGIN === 'off') merged.GOOGLE_CLIENT_ID = merged.GOOGLE_CLIENT_SECRET = '';
  if (merged.FEATURE_LINE_LOGIN === 'off') merged.LINE_LOGIN_CHANNEL_ID = merged.LINE_LOGIN_CHANNEL_SECRET = '';
  if (merged.FEATURE_TURNSTILE === 'off') merged.TURNSTILE_SITE_KEY = merged.TURNSTILE_SECRET_KEY = '';
  return merged;
}

/** A feature switch on an env returned by withSettings. */
export function featureOn(env: Env, key: `FEATURE_${string}`): boolean {
  const value = (env as unknown as Record<string, unknown>)[key];
  return value === undefined ? SETTING_BY_KEY.get(key)?.default !== 'off' : value === 'on';
}
