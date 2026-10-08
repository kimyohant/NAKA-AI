import Stripe from "stripe";
import type { Env } from "../types";

// Stripe Checkout (hosted page). The SDK pins its own API version; we never set one.
// Workers have no Node http module, so the SDK talks to Stripe through fetch and
// verifies webhook signatures with Web Crypto.
//   https://docs.stripe.com/payments/checkout
//   https://docs.stripe.com/webhooks#verify-events

export class StripeConfigError extends Error {}

export type CheckoutSession = Stripe.Checkout.Session;

export function stripeClient(env: Pick<Env, "STRIPE_SECRET_KEY">): Stripe {
  const key = env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new StripeConfigError("stripe_not_configured");
  return new Stripe(key, { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 1, timeout: 15_000 });
}

export interface CheckoutInput {
  paymentId: string;
  userId: string;
  planName: string;
  period: "monthly" | "yearly";
  amountSatang: number;
  expiresAt: number; // Unix seconds, 30 minutes to 24 hours ahead
  origin: string;
}

/** One-time payment for a prepaid package. The price comes from our plans table, not a Stripe Price. */
export function createCheckoutSession(stripe: Stripe, input: CheckoutInput): Promise<CheckoutSession> {
  return stripe.checkout.sessions.create({
    // Configured in Checkout Studio.
    ui_mode: "hosted_page",
    billing_address_collection: "auto",
    phone_number_collection: { enabled: false },
    automatic_tax: { enabled: false },
    allow_promotion_codes: false,
    submit_type: "auto",
    integration_identifier: "hosted_web_0001",
    origin_context: "web",
    // Our package: a one-time charge; renewing is another checkout (no Stripe subscription).
    mode: "payment",
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "thb",
        unit_amount: input.amountSatang,
        product_data: { name: `naka-ai ${input.planName} · ${input.period === "yearly" ? "รายปี" : "รายเดือน"}` },
      },
    }],
    expires_at: input.expiresAt,
    client_reference_id: input.paymentId,
    metadata: { payment_id: input.paymentId, user_id: input.userId },
    payment_intent_data: { metadata: { payment_id: input.paymentId, user_id: input.userId } },
    success_url: `${input.origin}/app/billing/?payment=${input.paymentId}`,
    cancel_url: `${input.origin}/app/billing/?payment=${input.paymentId}&cancelled=1`,
  }, { idempotencyKey: `checkout-${input.paymentId}` });
}

export function getCheckoutSession(stripe: Stripe, sessionId: string): Promise<CheckoutSession> {
  if (!/^cs_[A-Za-z0-9_]{1,200}$/.test(sessionId)) throw new StripeConfigError("invalid_session_id");
  return stripe.checkout.sessions.retrieve(sessionId);
}

/** Verify Stripe-Signature over the raw body (default tolerance: 5 minutes). Null when it does not verify. */
export async function verifyWebhookEvent(stripe: Stripe, env: Pick<Env, "STRIPE_WEBHOOK_SECRET">, rawBody: string, signature: string | null): Promise<Stripe.Event | null> {
  const secret = env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret || !signature) return null;
  try {
    return await stripe.webhooks.constructEventAsync(rawBody, signature, secret, undefined, Stripe.createSubtleCryptoProvider());
  } catch {
    return null;
  }
}
