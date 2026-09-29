import type { Env } from '../types';
import { base64url, SocialError } from './common';
const encoder = new TextEncoder();
function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
export function keyBytes(env: Env): Uint8Array<ArrayBuffer> {
  try {
    if (!env.SOCIAL_TOKEN_KEY || !/^[A-Za-z0-9+/]{43}=$/.test(env.SOCIAL_TOKEN_KEY)) throw new Error();
    const bytes = decode(env.SOCIAL_TOKEN_KEY);
    if (bytes.length !== 32 || btoa(String.fromCharCode(...bytes)) !== env.SOCIAL_TOKEN_KEY) throw new Error();
    return bytes;
  } catch { throw new SocialError(503, 'ระบบเชื่อมต่อบัญชียังไม่พร้อมใช้งาน'); }
}
// AAD prevents moving ciphertext between users, platforms, or remote accounts.
export const tokenContext = (user: string, platform: string, external: string) => JSON.stringify(['social-token-v1', user, platform, external]);
export async function encryptToken(env: Env, token: string, context: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', keyBytes(env), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(context) }, key, encoder.encode(token));
  return `v1.${base64url(iv)}.${base64url(new Uint8Array(encrypted))}`;
}
export async function decryptToken(env: Env, value: string, context: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', keyBytes(env), 'AES-GCM', false, ['decrypt']);
  try {
    const parts = value.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1' || !/^[\w-]{16}$/.test(parts[1]) || !/^[\w-]+$/.test(parts[2])) throw new Error();
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(parts[1]),
      additionalData: encoder.encode(context) }, key, decode(parts[2])));
  } catch { throw new SocialError(503, 'กรุณาเชื่อมต่อบัญชีโซเชียลใหม่'); }
}
export async function mediaSignature(env: Env, origin: string, key: string, exp: number): Promise<string> {
  // Derive a separate HMAC key; never use the AES key directly to sign URLs.
  const master = await crypto.subtle.importKey('raw', keyBytes(env), 'HKDF', false, ['deriveKey']);
  const signer = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('naka-social-v1'),
    info: encoder.encode('media-url-signing') }, master, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', signer, encoder.encode(JSON.stringify(['GET', origin, key, exp])))));
}
