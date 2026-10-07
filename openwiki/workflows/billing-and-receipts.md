---
type: workflow
title: Billing, Plans and Receipts
description: How prepaid packages are sold through Stripe Checkout, how payments are reconciled by webhook or polling and applied exactly once, how the billing cron expires packages and tops up monthly credits, and how numbered receipts are issued and backfilled.
tags: [billing, stripe, plans, credits, receipts, cron, payments]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-07T08:08:50.062Z
sources:
  - id: openwiki-source-4543573948980ca75e0240b1
    resource: repo://src/billing/index.ts
  - id: openwiki-source-32a93f022a00f892b08cb6d1
    resource: repo://src/billing/stripe.ts
  - id: openwiki-source-6b6fdc9f4e2d34e1b8716990
    resource: repo://src/receipts/index.ts
  - id: openwiki-source-62f44c559568a8c6c16fec75
    resource: repo://src/receipts/money.ts
generated: { by: "claude-code", at: "2026-10-07T08:08:50.062Z" }
---

# Billing, Plans and Receipts

<!-- openwiki: broken internal link [/openwiki/architecture/background-processing.md] link "/openwiki/architecture/background-processing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Customers buy a prepaid package (a month or a year) on Stripe's hosted Checkout page (PromptPay or card). The package and its credits switch on only once Stripe confirms payment. Code: `src/billing/index.ts`, `src/billing/stripe.ts`, `src/receipts/`. Credits and plans are described in [Job Queue, Credits and Cron](/openwiki/architecture/background-processing.md).

## Trust rules

- **Prices come from the `plans` table**, never the browser. `paidPlan` accepts only plans with `price_thb > 0 AND on_sale = 1`. `priceSatang` multiplies by 100 and charges **ten months for yearly**.
<!-- openwiki: broken internal link [/openwiki/architecture/runtime-settings.md] link "/openwiki/architecture/runtime-settings.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- Online payment is available only when `FEATURE_PAYMENTS` is not `off` **and** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set (`onlinePayment`). The feature defaults to off ([Runtime Settings and Feature Flags](/openwiki/architecture/runtime-settings.md)). Otherwise checkout answers 503.
- A Stripe session is never trusted from a webhook payload. The webhook only identifies a session id; the Worker re-fetches the session from Stripe and `reconcile` requires that id, `amount_total`, `THB` currency, `client_reference_id` and `metadata.payment_id` all match the stored payment.

## Checkout flow

1. `POST /api/billing/checkout` (Origin must equal the Worker origin; JSON body ≤ 4 KB) inserts a `payments` row in `pending` status. The insert itself is conditional on fewer than 5 pending payments for the user in the last hour, so concurrent requests cannot exceed the limit (429).
2. It creates a Stripe Checkout Session with a 60-minute expiry. If Stripe fails, the payment is marked `failed` (nobody can pay a session whose URL was never received) and only Stripe's error type/code is logged.
3. The session id is stored; the response contains the `redirect` URL (must be `https://`).
4. `GET /api/billing/payments/:id` lets the page poll; it reconciles against Stripe if the payment is still pending, and falls back to the stored status if Stripe is unreachable.
5. `POST /webhook/stripe` accepts four session events (`completed`, `async_payment_succeeded`, `async_payment_failed`, `expired`). The body is read through `readBodyBytes` with a 256 KiB cap, and the `Stripe-Signature` is verified over the raw bytes (5-minute default tolerance, Web Crypto provider). Unknown events or sessions return 204; a Stripe fetch failure returns 503 so Stripe retries.

PromptPay settles after the session completes, so `payment_status` stays `unpaid` until later; only `status = complete` **and** `payment_status = paid` applies the payment. An async failure marks the payment `failed` unless the session is paid.

## Applying a payment exactly once

`applyPayment` runs three statements in one D1 batch, all guarded by a random `apply_token` written by the first statement:

1. Claim: `UPDATE payments … WHERE status = 'pending' AND apply_token IS NULL` — only one concurrent caller gets `changes === 1`.
2. Credit top-up (when the user is *not* extending the same active plan): insert a `purchase` ledger row that raises the balance **up to** the plan's `monthly_credits` (never removes credits).
3. Upsert `subscriptions`: paying again for the same still-active plan **extends** `expires_at` and keeps `next_credit_at`; a new or different plan starts now with `next_credit_at = now + 30 days`.

Whether to extend is decided inside the batch, so two simultaneous payments add up. After a successful apply, `issueReceipt` runs; if it fails, the cron backfill issues it later, and a receipt failure never undoes the payment.

## Cron

<!-- openwiki: broken internal link [/openwiki/architecture/background-processing.md] link "/openwiki/architecture/background-processing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`runBillingCron` (every minute, see [cron fan-out](/openwiki/architecture/background-processing.md)):

- sets `active` subscriptions past `expires_at` to `expired`;
- closes `pending` payments only one day after their checkout expiry, so a late PromptPay settlement can still be applied by the webhook;
- tops up to 50 due subscriptions per tick: advancing `next_credit_at` by 30 days and the guarded top-up statement run in one batch, so an overlapping cron run cannot double-credit.

## Receipts

- `issueReceipt(env, paymentId)` returns the existing receipt if one exists (idempotent). It issues nothing unless `RECEIPT_SELLER_NAME` is set and the payment is `successful` with a valid `paid_at` and positive satang amount.
- The receipt `snapshot` (seller, buyer, plan, Thai-formatted dates/amounts, Thai baht words) is frozen JSON in `receipts.snapshot` and never updated afterwards.
- Numbering `RCYYYY-NNNNNN` (year in Bangkok time) is allocated inside the single `INSERT … SELECT MAX(seq)+1` statement with `ON CONFLICT(payment_id) DO NOTHING`, relying on SQLite serializing writers, so duplicates consume no number.
- If `RECEIPT_VAT_REGISTERED = '1'`, the title becomes an abbreviated tax invoice and VAT is computed as inclusive 7 % (`inclusiveVatSatang`, exact BigInt arithmetic, nearest satang). Amounts are integer satang throughout.
- `backfillReceipts` (≤ 20 per tick) finds successful payments of active users with no receipt, so setting `RECEIPT_SELLER_NAME` later also issues receipts for earlier payments.
- `GET /api/receipts` and `/api/receipts/:id` are read-only and scoped to the session user.

<!-- openwiki: broken internal link [/openwiki/testing/test-suite.md] link "/openwiki/testing/test-suite.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Tests: `tests/billing.test.cjs` (Stripe mocked at fetch), `tests/receipts.test.cjs`, `tests/webhook-body-limits.test.cjs`. See [Test Suite](/openwiki/testing/test-suite.md).
