---
type: workflow
title: Authentication and Sessions
description: How customers sign in (Google, LINE, phone OTP, email+password with reset, Turnstile), how D1-backed sessions work, how admin access and the naka-studio SSO are authorized, and the abuse limits built into each flow.
tags: [auth, sessions, oauth, otp, admin, sso, security]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-07T08:08:50.062Z
sources:
  - id: openwiki-source-eee801299a69aa48dc74d609
    resource: repo://docs/studio-sso.md
  - id: openwiki-source-75b6eeadbb3ed61fd32f3473
    resource: repo://src/admin/auth.ts
  - id: openwiki-source-5e010c08b4ee3b6e59a870f6
    resource: repo://src/auth/google.ts
  - id: openwiki-source-d321c3d7646efe0a14edf680
    resource: repo://src/auth/index.ts
  - id: openwiki-source-169cfe7b52d8d88fbb25d765
    resource: repo://src/auth/otp.ts
  - id: openwiki-source-b515aeae977aa10e5cc02091
    resource: repo://src/auth/password.ts
  - id: openwiki-source-1b2665ccb7f36d8e66cc8321
    resource: repo://src/auth/session.ts
generated: { by: "claude-code", at: "2026-10-07T08:08:50.062Z" }
---

# Authentication and Sessions

<!-- openwiki: broken internal link [/openwiki/architecture/request-routing.md] link "/openwiki/architecture/request-routing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Code lives in `src/auth/` (module notes in `src/auth/README.md`) and `src/admin/auth.ts`. `handleAuth` is the first handler after settings/feature checks in [Worker Request Routing](/openwiki/architecture/request-routing.md); other handlers obtain the caller with `requireUser(request, env)`.

## Endpoint surface

`handleAuth` owns a fixed table of `/api/auth/*` paths, each with exactly one allowed method (others get 405): `otp/request|verify`, `google/start|callback`, `line/start|callback`, `password/register|login|change|forgot|reset`, `me`, `logout`, `config`. For every known path it:

- requires the request URL's origin to equal `APP_ORIGIN` (blocks host-header tricks and login CSRF);
- for POST, requires `Origin == APP_ORIGIN` and rejects `Sec-Fetch-Site: cross-site`;
- turns `AuthError` into a JSON error with optional `Retry-After`, and any other error into a generic 500 that logs no provider bodies, OAuth codes, phones or credentials;
- always sets `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`.

<!-- openwiki: broken internal link [/openwiki/architecture/runtime-settings.md] link "/openwiki/architecture/runtime-settings.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`GET /api/auth/config` tells the login page which methods are actually configured (`googleLogin`, `lineLogin`, `phoneLogin`, `passwordLogin`, `passwordReset`, the Turnstile site key) so it never offers one that can only fail. `GET /api/auth/me` returns the user, credit balance, whether a password is set and the naka-studio link. Because feature switches blank provider credentials (see [Runtime Settings and Feature Flags](/openwiki/architecture/runtime-settings.md)), turning a provider off also removes it from this config.

## Sessions

- Customer sessions last 30 days (`SESSION_SECONDS`). The cookie `naka_session` holds a 43-character random token; D1 `sessions` stores only its **SHA-256**, so a database read cannot be replayed.
- `createSession` deletes the caller's previous session and any expired rows in the same batch as the insert (session rotation).
- `requireUser` validates the token shape, looks up an unexpired session and loads the user only if `users.status = 'active'`. `logout` deletes the row and expires the cookie.
- `identityUser` creates or finds a user for a provider identity. The user row is inserted only if no identity for `(provider, provider_uid)` exists, in a single D1 batch that also upserts the identity and, when `SIGNUP_CREDITS` is a positive integer, adds the signup-bonus ledger row — so races cannot leave orphan users or double bonuses.

## Sign-in methods

| Method | Mechanism and guards |
| --- | --- |
| Google | OAuth with PKCE (`S256`). `auth_oauth_states` stores the hashed state plus verifier; a state cookie must match exactly once and the row is consumed with `DELETE … RETURNING`. |
| LINE Login | Same state/callback pattern (`line.ts`). |
| Phone OTP | `otp.ts` + `sms.ts` (`SMS_PROVIDER`: `off`, `mock`, `android_gateway`, `thaibulksms`). Codes are stored hashed with expiry; per-phone and per-IP request rate limits; at most 5 verify attempts, counted atomically, then 429 with `Retry-After`. |
| Email + password | `password.ts`: PBKDF2-SHA256 at 100,000 iterations (the Workers maximum), format `pbkdf2-sha256$iter$salt$hash`, constant-time compare, and timing padding for unknown emails. Limits recorded in `auth_password_attempts`: 5 failures per email and 30 per IP per 15 min, 5 sign-ups per IP per hour; successful attempts are released. No email verification yet. |
| Reset | `forgot`/`reset` use `auth_password_resets` and an `emailProvider` (Resend); available only when email is configured. |
| Turnstile | `verifyTurnstile` calls Cloudflare siteverify when `TURNSTILE_*` keys are set; the secret never leaves the Worker. |

## Admin access

`checkAdmin` authorizes `/api/admin/*`:

1. A non-empty `Authorization: Bearer` header must equal `ADMIN_TOKEN` (constant-time) — the break-glass actor `kind: token`. An empty `Bearer` falls through to the session.
2. Otherwise a session cookie is required. Non-GET requests must come from `APP_ORIGIN` and not be cross-site (the cookie is SameSite=Lax).
3. The user must have a **Google-verified** identity whose email is in `ADMIN_EMAILS`; a password account with the same address does not count.
4. The session must have been created within 12 hours (`ADMIN_SESSION_SECONDS`), else the admin must sign in again.

The resulting `AdminActor` (`google` with email, or `token`) is recorded in admin audit logs.

## naka-studio SSO

naka-ai is the sign-in server for the separate naka-studio app (`src/auth/studio.ts`, `docs/studio-sso.md`, migration 0018 `studio_sso_codes`). The studio redirects to `/api/sso/studio/authorize?state`, naka-ai checks `STUDIO_ACCESS` (`admins` default, `members`, `off`), issues a one-time 60-second code stored hashed, and the studio server exchanges it at `/api/sso/studio/token` with `Authorization: Bearer STUDIO_SSO_SECRET`. That exchange is server-to-server with no `Origin`, which is why `handleStudioSso` runs before `handleAuth`.

## Tests

<!-- openwiki: broken internal link [/openwiki/testing/test-suite.md] link "/openwiki/testing/test-suite.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`src/auth/tests/auth.test.cjs` and `runtime.test.cjs` (Miniflare), plus `tests/password-*.test.cjs`, `line-login`, `sms-gateway`, `studio-sso`, `admin-auth`. See [Test Suite](/openwiki/testing/test-suite.md).
