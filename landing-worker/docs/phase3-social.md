# Phase 3 — Social Connector (Facebook Page + Instagram)

สัญญากลาง Claude เป็นเจ้าของ ห้ามเปลี่ยนเอง ถ้าต้องเปลี่ยนให้เขียนขอใน PR

## ขอบเขตรอบนี้

- เชื่อมบัญชี Facebook Page และ Instagram Business/Creator ที่ผูกกับเพจ ผ่าน Facebook Login ครั้งเดียว
- อัปโหลดคลิปที่ผู้ใช้สร้างในเบราว์เซอร์ขึ้น R2 แล้วตั้งเวลาโพสต์
- Cron เรียก `publishDuePosts` ทุกนาที เพื่อโพสต์คลิปที่ถึงเวลา
- **ยังไม่ทำ:** TikTok (ต้องรอผ่าน audit), Shopee (ไม่มี API), ตอบคอมเมนต์ (Phase 4)

## ไฟล์ที่ ChatGPT เป็นเจ้าของ

`src/social/**`, `migrations/0003_social.sql`, `src/social/tests/**`, `docs/social-integration-status.md`

## Env (มีใน `src/types.ts` แล้ว)

`META_APP_ID`, `META_APP_SECRET`, `SOCIAL_TOKEN_KEY` (base64 ของ key 32 bytes สำหรับ AES-GCM), `MEDIA` (R2Bucket อาจยังไม่มี → ตอบ 503 ภาษาไทย), `APP_ORIGIN`

## ตาราง (`migrations/0003_social.sql`)

```sql
social_accounts (id TEXT PK, user_id TEXT, platform 'facebook'|'instagram', external_id TEXT,
                 name TEXT, token_enc TEXT, token_expires_at INTEGER NULL,
                 status 'active'|'revoked'|'error', created_at INTEGER,
                 UNIQUE(user_id, platform, external_id))
scheduled_posts (id TEXT PK, user_id TEXT, social_account_id TEXT, media_key TEXT, caption TEXT,
                 publish_at INTEGER, status 'queued'|'publishing'|'published'|'failed',
                 external_post_id TEXT NULL, error TEXT NULL, attempts INTEGER DEFAULT 0,
                 created_at INTEGER, updated_at INTEGER)
```

เวลาเป็น Unix seconds เหมือน `0001_auth.sql`

## API (ทุก route ต้องมี `userId` จาก session — Claude ต่อ `requireUser` ให้)

| Method | Path | Body | ผลลัพธ์ |
|---|---|---|---|
| GET | `/api/social/meta/start` | — | `302` ไป Facebook Login (state + PKCE หรือ state ใน cookie แบบเดียวกับ Google) |
| GET | `/api/social/meta/callback` | — | `302` ไป `/app/?connected=meta` หรือ `/app/?error=meta` |
| GET | `/api/social/accounts` | — | `200 { accounts: [{ id, platform, name, status }] }` ไม่มี token |
| DELETE | `/api/social/accounts/:id` | — | `204` ลบ token ของผู้ใช้คนนั้นเท่านั้น |
| POST | `/api/social/uploads` | ไฟล์ `video/mp4` หรือ `video/webm` ≤ 50 MB (raw body) | `201 { mediaKey }` |
| POST | `/api/social/posts` | `{ accountId, mediaKey, caption, publishAt? }` | `202 { postId }` · `publishAt` ไม่ใส่ = โพสต์รอบ cron ถัดไป |
| GET | `/api/social/posts` | — | `200 { posts: [...] }` ของผู้ใช้คนนั้น |
| GET | `/api/social/media/:key?exp=&sig=` | — | ส่งไฟล์จาก R2 เมื่อ HMAC ถูกและยังไม่หมดอายุ (Instagram ต้องดึงคลิปจาก URL สาธารณะ) |

## Export ที่ Claude จะต่อเข้า `src/index.ts`

```ts
// src/social/index.ts
export async function handleSocial(request: Request, env: Env, url: URL, userId: string | null): Promise<Response | null>;
// userId = null เฉพาะ route /api/social/media/* ที่ Instagram เรียกจากภายนอก
export async function publishDuePosts(env: Env, { maxPosts }: { maxPosts: number }): Promise<{ published: number; failed: number }>;
```

## กติกาความปลอดภัย

- เก็บ token แบบเข้ารหัส AES-GCM ด้วย `SOCIAL_TOKEN_KEY` (IV สุ่มทุกครั้ง) ห้าม log token, code, หรือ response body ของ Meta
- ผู้ใช้เห็นและลบได้เฉพาะบัญชีและโพสต์ของตัวเอง
- เลือก Graph API version เป็นค่าคงที่ตัวเดียว และตรวจ scope กับ endpoint จากเอกสาร Meta จริง ถ้าเปิดเอกสารไม่ได้ ให้ throw ชัดเจนและจดไว้ ห้ามเดา
- โพสต์ซ้ำไม่ได้: claim โพสต์แบบ atomic (`UPDATE … SET status='publishing' WHERE status='queued' … RETURNING`) แบบเดียวกับ `src/jobs.ts`
- error ที่ผู้ใช้เห็นเป็นภาษาไทยทั่วไป รายละเอียดเก็บใน `scheduled_posts.error`
- เทสต์ mock HTTP ทั้งหมด ห้ามเรียก Meta จริง ห้ามโพสต์จริง
