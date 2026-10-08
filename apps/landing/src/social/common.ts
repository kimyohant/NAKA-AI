export { appOrigin, AuthError as SocialError, base64url, constantTimeEqual, cookie, cookieValue,
  json, now, randomToken, readJson, sha256 } from '../auth/common';
export type Platform = 'facebook' | 'instagram';
export interface Account {
  id: string; user_id: string; platform: Platform; external_id: string; name: string;
  token_enc: string; token_expires_at: number | null; status: 'active' | 'revoked' | 'error';
}
export interface Post {
  id: string; user_id: string; social_account_id: string; media_key: string; caption: string;
  publish_at: number; status: string; attempts: number; container_id: string | null;
  phase: 'prepare' | 'publish_sent' | 'done'; polls: number; lease_id: string; used_token_enc?: string;
}
export const externalId = (value: unknown): value is string => typeof value === 'string' && /^\d{1,64}$/.test(value);
