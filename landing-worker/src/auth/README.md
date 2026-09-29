# Auth backend

Implements the API in `docs/phase1-tasks.md` using Workers Web Crypto, fetch, and D1.
Auth source and tests are under `src/auth/`; its schema is
`migrations/0001_auth.sql`. The main router now mounts `handleAuth`, and `/me`
reads the real credit ledger. Existing LINE tables are untouched.

## Integration

```ts
import { handleAuth } from './auth';

// Inside fetch, before the admin API and static asset fallback:
const authResponse = await handleAuth(request, env, url);
if (authResponse) return authResponse;
```

`requireUser(request, env)` is also exported for customer API authorization; it
returns `User | null` and checks account status and session expiry on each call.
It does not grant admin access. `/api/auth/me` reads the signed-in user's balance
through `getBalance`; it does not accept a caller-supplied user ID. Both auth and
credits migrations must be applied before using the integrated API.

Apply the migration before enabling routes:

```powershell
npm run auth:setup
npm run db:migrate:local
npm run dev:auth
# Production, when releasing:
npx wrangler d1 migrations apply naka-ai-db --remote
```

Local auth is available at `http://127.0.0.1:8788`. The setup script adds only
missing local values and generates a random secret without printing it. Existing
settings are preserved. Review all pending migrations before the production
command. Local migrations have been tested; remote migration/deploy still need
Cloudflare credentials. Do not use the local mock SMS settings in production.

## Configuration

Store actual secrets in `.dev.vars` locally and Wrangler secrets in production.
Values below are placeholders, not working credentials.

```dotenv
APP_ORIGIN="http://127.0.0.1:8788"
SESSION_SECRET="<random secret with at least 32 characters>"
SMS_PROVIDER="mock"
GOOGLE_CLIENT_ID="<Google Web application client ID>"
GOOGLE_CLIENT_SECRET="<Google client secret>"

# Production SMS:
# SMS_PROVIDER="thaibulksms"
# SMS_API_KEY="<ThaiBulkSMS API key>"
# SMS_API_SECRET="<ThaiBulkSMS API secret>"
# SMS_SENDER="<approved ThaiBulkSMS sender name>"
```

ThaiBulkSMS requires a registered, case-sensitive sender. `SMS_SENDER?: string`
is now included in `src/types.ts`; the adapter rejects missing configuration. There
is no guessed/default sender and no fallback to mock when real SMS fails.

Use exactly one canonical `APP_ORIGIN` (scheme, hostname and optional port, no
path). Register `${APP_ORIGIN}/api/auth/google/callback` in the Google Web OAuth
client. Use the same origin for the frontend and API; alias domains should
redirect to it. POST requests require the matching `Origin` header, including
requests made with curl. HTTP is permitted only on localhost/loopback. Session
cookies are Secure on HTTPS; local HTTP omits Secure so development works.

Mock SMS logs OTP text **only for explicit `SMS_PROVIDER=mock` on loopback HTTP**.
It is rejected on HTTPS and on non-loopback HTTP. Real SMS and Google flows do
not log provider bodies, OTPs, OAuth codes, tokens or credentials. No SMS or OAuth
calls are made unless their configuration is present.

## Behavior

- Thai mobile input `06…`, `08…`, `09…` or `+66…` normalizes to E.164.
- OTPs use uniform cryptographic six-digit codes, challenge-specific HMAC-SHA256,
  five-minute expiry, 60-second cooldown, and three sends per rolling hour per
  phone. Five failed guesses lock that challenge; the fifth correct guess works.
- An additional limit allows 20 send requests per rolling hour per trusted
  `CF-Connecting-IP`; stored IP values are HMACs. Missing IPs share one bucket.
  Failed/uncertain SMS deliveries consume quota but cannot activate an OTP.
- D1 transactions reserve send quota and replace the challenge atomically.
  Conditional SQL claims prevent OTP replay and duplicate OAuth code exchange.
  Concurrent OTP verification may reject an in-flight attempt; at most one wins.
- Sessions contain 32 random bytes and expire after 30 days. D1 stores only their
  SHA-256 digests. Login rotates the presented session; logout deletes it.
- Google uses authorization code exchange plus PKCE, a ten-minute HttpOnly state
  cookie and single-use server-side state. Identity and verified email come from
  Google's userinfo endpoint over the server-obtained access token. Google `sub`
  is the identity key. Client tokens are never accepted; emails never auto-link
  accounts across providers or distinct Google subjects.
- Login creates an active user only when that provider identity is new. Disabled
  users cannot log in or use existing sessions.
- API responses are non-cacheable. Errors are Thai and hide internal details.
  Old OTP/history/state/session records are cleaned on the corresponding flows;
  idle deployments can additionally schedule deletion by expiry for retention.

## Validation

Node 24 is used for the built-in SQLite test harness. It executes production SQL
with foreign keys and atomic transactions. A second suite uses Wrangler's
installed Miniflare/esbuild to verify the flow against isolated workerd and D1.
All outbound HTTP is mocked, and runtime database state is ephemeral.

```powershell
npm run test:auth
npm run typecheck
npm test
```

`npm test` now discovers both the existing tests and the auth suites. The runtime
suite bundles the real `src/index.ts`, exercises routed auth on workerd/D1, and
verifies that a ledger grant appears in `/me` for the authenticated customer.
Test coverage includes normalization, request validation, rolling limits,
concurrent sends/verifications, lockout, expiry, replay, hashed sessions,
rotation/logout, disabled users, provider failures, dev-only mock mode, Google
state/PKCE/replay, verified profile handling and stable identity reuse.

Provider credentials, SMS delivery and real Google browser login must be checked
in the integrated environment; local automated tests do not establish delivery
or account configuration.

## References

- [ThaiBulkSMS SMS API](https://developer.thaibulksms.com/)
- [Google OpenID Connect and UserInfo](https://developers.google.com/identity/openid-connect/openid-connect)
- [Cloudflare D1 atomic batches](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
