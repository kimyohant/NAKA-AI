# Stripe integration — remaining setup

naka-ai sells prepaid packages (monthly or yearly, renewed by paying again) through **Stripe Checkout (hosted page)**.
This replaced Omise, which no longer onboards sole proprietors. This file is the single source of truth for what is
left to do before taking real money.

**สถานะ ณ 2026-10-01:** โค้ดฝั่ง Stripe อยู่บน `main` ครบและ deploy แล้ว แต่ยัง**ไม่ได้ตั้ง** `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`
และยังไม่ได้ตั้งค่า Dashboard ข้อ 1–4 ของหัวข้อ Setup → ระบบชำระออนไลน์ยังปิด: `GET /api/billing/config` ตอบ `enabled: false`
และหน้า `/app/billing/` ปิดปุ่มชำระ แจ้งให้โทร 089-278-8587 สั่งซื้อแทน ตั้งค่าตามหัวข้อ Setup ให้ครบแล้วระบบเปิดเองทันที **ไม่ต้องแก้โค้ดเพิ่ม**

## Values to Replace

The following values are placeholders and must be updated before going live.

**Files containing placeholders:** none in code. The only placeholders are the two secrets, which are never stored in files:

| Field | Current Value | What to Set |
|-------|--------------|-------------|
| `STRIPE_SECRET_KEY` | *(unset — online payment is off and `/app/billing/` says so)* | A **restricted key** (`rk_…`) with **Checkout Sessions: Write** only. Sandbox key first, live key at launch. `npx wrangler secret put STRIPE_SECRET_KEY` |
| `STRIPE_WEBHOOK_SECRET` | *(unset)* | The endpoint's **Signing secret** (`whsec_…`), see Setup step 4. `npx wrangler secret put STRIPE_WEBHOOK_SECRET` |

The Checkout Studio `sample_only` parameters already have real values, so nothing else needs replacing:

| Field | Value in code | Why |
|-------|--------------|-----|
| `mode` | `payment` | Packages are one-time prepaid charges; renewal is another checkout, not a Stripe subscription. So `payment_method_collection` (subscription-only) is not sent. |
| `success_url` | `{APP_ORIGIN}/app/billing/?payment={our payment id}` | The billing page polls the payment until the webhook or the poll applies it. |
| `cancel_url` | `{APP_ORIGIN}/app/billing/?payment={our payment id}&cancelled=1` | Shows "cancelled", lets the customer start again. |
| `line_items` | one item with `price_data` (THB, amount from the `plans` table) | Prices live in our database (`migrations/0004_plans.sql`), so no Stripe Price IDs are needed and the browser can never set the amount. |

## Configured Parameters

These parameters were configured in Checkout Studio and are already set correctly.

**Files containing these parameters:**
- [src/billing/stripe.ts](src/billing/stripe.ts)

| Parameter | Value |
|-----------|-------|
| ui_mode | `hosted_page` (stripe-node 22.6.2 is ≥ 21.0.0) |
| billing_address_collection | `auto` |
| phone_number_collection | `{ enabled: false }` |
| automatic_tax | `{ enabled: false }` |
| allow_promotion_codes | `false` |
| submit_type | `auto` |
| integration_identifier | `hosted_web_0001` |
| origin_context | `web` |

`payment_method_types` is deliberately **not** sent: the page shows whichever methods are switched on in the Dashboard.

## Setup

1. **Account** — sign up at stripe.com, country **Thailand**, business type **Individual / sole proprietor**
   (ณัฐพงษ์ โยธาไพ). Verify identity and add the bank account for payouts. Confirm during sign-up that Stripe accepts
   this business type for your use; if it does not, stop here and tell Claude.
2. **Payment methods** — Settings → Payment methods: enable **PromptPay** and **Cards**.
3. **Branding / public details** — logo, colour, business name, support phone `089-278-8587`, email
   `nattapong.n8m@gmail.com`. These appear on the payment page and on card statements.
4. **Webhook** — Developers → Webhooks → Add endpoint `https://naka-ai.com/webhook/stripe` with events
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`. Copy the Signing secret.
   Webhooks are required: PromptPay settles *after* the page closes, and only the webhook (or the customer's
   return-page poll) switches the package on.
5. **Secrets** — `npx wrangler secret put STRIPE_SECRET_KEY` and `npx wrangler secret put STRIPE_WEBHOOK_SECRET`.
6. **Database** — `npx wrangler d1 migrations apply naka-ai-db --remote` รันครั้งเดียวพาทุก migration ที่ยังค้างขึ้นพร้อมกัน
   (`0010_stripe.sql` รวมอยู่ในนั้น; ล่าสุดบน `main` ตอนนี้คือ `0013_password_reset.sql`)
7. **Dependency** — `stripe` (^22.6.2) is in `package.json`; `npm ci` installs it.

## New and changed files

```
migrations/0010_stripe.sql      payments.method gains 'stripe_checkout'; payments.stripe_session_id
src/billing/stripe.ts           Stripe client (fetch + Web Crypto for Workers), session create/retrieve, webhook verify
src/billing/index.ts            checkout → Checkout Session; reconcile/webhook/poll read the session from Stripe
src/index.ts                    POST /webhook/stripe (was /webhook/omise)
public/app/billing/             one "go to payment page" button (was Omise.js card form + PromptPay QR)
tests/billing.test.cjs          Stripe mocked at fetch; signature, PromptPay async, mismatch, poll, receipts, migration
src/billing/omise.ts            removed
```

## How it works

1. `/app/billing/` → customer picks a package and period → `POST /api/billing/checkout`.
2. The server prices it from `plans`, inserts a `pending` payment, creates a Checkout Session
   (`client_reference_id` and `metadata.payment_id` = our payment id, expires in 60 minutes) and returns its URL.
3. The customer pays on Stripe's page (PromptPay QR or card, including 3-D Secure) and returns to
   `/app/billing/?payment=…`, which polls `GET /api/billing/payments/:id`.
4. Either the webhook or that poll **re-reads the session from Stripe** (never trusts the webhook body), checks the
   amount, currency, session id and our payment id, and when `payment_status = paid` calls `applyPayment` once:
   package on (or extended), credits topped up, receipt issued.
5. `async_payment_failed` marks the payment failed; `checkout.session.expired` marks it expired; the cron closes
   pending payments a day after their session expired.

## Testing (sandbox)

- Card success `4242 4242 4242 4242` · 3-D Secure `4000 0025 0000 3155` · declined `4000 0000 0000 0002`
  (any future expiry, any CVC). PromptPay in a sandbox has buttons to simulate success or failure.
- Local: `stripe listen --forward-to http://127.0.0.1:8788/webhook/stripe` prints a `whsec_…` for `.dev.vars`.
- `docs/DEPLOY.md` §5 lists the checks to run on naka-ai.com after deploy.

## Next steps

- Refunds and disputes: refund from the Stripe Dashboard, then adjust the package or credits in `/admin/customers/`
  (the system does not yet react to `charge.refunded` or disputes).
- Tax invoice / VAT: `automatic_tax` is off; receipts are issued by naka-ai itself (`src/receipts/`).
- Resources: https://support.stripe.com · https://docs.stripe.com/mcp
