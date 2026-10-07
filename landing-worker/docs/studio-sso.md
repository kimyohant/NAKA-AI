# naka-studio sign-in through naka-ai

Members sign in once at naka-ai and open naka-studio with the same account. naka-ai is the sign-in server;
naka-studio never sees passwords.

```
naka-studio page (no session)
  → studio /api/v1/auth/naka/login            state cookie (10 min)
  → naka-ai /api/sso/studio/authorize?state   login if needed, check STUDIO_ACCESS
  → studio /api/v1/auth/naka/callback?code    one-time code, 60 s, stored hashed (studio_sso_codes)
  → studio server POST naka-ai /api/sso/studio/token  (Authorization: Bearer STUDIO_SSO_SECRET)
  → studio session cookie, signed, 12 h
```

Studio side: `backend/src/auth/naka-sso.ts` in this repo (tests: `backend/tests/naka-sso.test.ts`, which also checks this
Worker's `src/auth/studio.ts` for the same paths and token shape). Members get a signed 12 h cookie; the Studio UI shows
the member and a sign-out button; naka-ai admins (`admin: true`) also get the Studio's system settings (`/admin`).

## Who may enter

`STUDIO_ACCESS` (admin panel → naka-studio):

| value | who |
|---|---|
| `admins` (default) | Google accounts listed in `ADMIN_EMAILS` only |
| `members` | every naka-ai member |
| `off` | nobody; the Naka Studio button disappears |

naka-studio keeps one shared workspace today (dramas, campaigns and media are not separated per account).
Keep `admins` until per-account data is added there, otherwise members see each other's work.

## Setup (owner)

1. Make a shared secret (32+ characters of A-Z a-z 0-9 `_` `-`), for example:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
2. naka-ai: apply `migrations/0018_studio_sso.sql` to the remote D1 (back up first), then in
   `/admin/system/` → **naka-studio (ล็อกอินร่วม)** set
   - `STUDIO_URL` = the studio address, e.g. `https://studio.naka-ai.com`
   - `STUDIO_ACCESS` = `admins`
   - `STUDIO_SSO_SECRET` = the secret from step 1
3. naka-studio server environment:
   - `NAKA_SSO_URL=https://naka-ai.com`
   - `NAKA_SSO_SECRET=` the same secret
   With these set, the studio's `NAKA_AUTH_PASSWORD` Basic-auth prompt is no longer used.
4. Restart naka-studio. Opening any studio page now goes through naka-ai sign-in.

The studio must be served over https (or localhost for development); naka-ai refuses plain-http studio
addresses and the studio refuses a plain-http `NAKA_SSO_URL`.

## Password reset by email

The forgot-password link on `/login/` appears once email is configured in `/admin/system/` → **อีเมล**:

- `EMAIL_PROVIDER` = `resend`
- `RESEND_API_KEY` = a key from resend.com (the naka-ai.com domain must be verified there)
- `EMAIL_FROM` = e.g. `naka-ai <no-reply@naka-ai.com>`

Members get a link valid for 30 minutes; it works once, and setting a new password signs out other devices.
Until email is configured the page keeps the "call 089-278-8587" fallback.
