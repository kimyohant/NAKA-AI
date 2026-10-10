export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY: string;
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  ADMIN_TOKEN: string; // break-glass bearer for /api/admin/* (src/admin/auth.ts)
  ADMIN_EMAILS?: string; // Google accounts allowed into /admin/, comma separated
  // Phase 1 auth — contract in docs/phase1-tasks.md
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  SMS_PROVIDER: "mock" | "thaibulksms" | "android_gateway" | "off"; // "off" = no phone OTP, sign in with LINE/Google
  SMS_API_KEY?: string;
  SMS_API_SECRET?: string;
  SMS_SENDER?: string;
  APP_ORIGIN: string;
  EMAIL_PROVIDER?: "off" | "mock" | "resend";
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  STUDIO_URL?: string; // naka-studio origin that may sign members in through naka-ai
  STUDIO_ACCESS?: string; // 'admins' (default) | 'members' | 'off'
  STUDIO_SSO_SECRET?: string; // shared with naka-studio for the server-to-server code exchange
  STUDIO_INTERNAL_URL?: string; // how this server reaches naka-studio directly (Docker: http://studio:5679), for /admin/studio-system/
  STUDIO_ADMIN_TOKEN?: string; // naka-studio's ADMIN_TOKEN, sent as X-Admin-Token by /admin/studio-system/
  // Affiliate review voiceover (Google Cloud Text-to-Speech)
  GOOGLE_TTS_API_KEY: string;
  GOOGLE_TTS_VOICE?: string;
  // Bot protection on OTP requests (Cloudflare Turnstile)
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string; // public; served to the login page by /api/auth/config
  // Social connector (Facebook Pages + Instagram) — contract in docs/phase3-social.md
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  SOCIAL_TOKEN_KEY?: string; // base64 32-byte AES-GCM key for stored page tokens
  MEDIA?: R2Bucket; // clip uploads for posting; bound once the R2 bucket exists
  // AI Inbox (Phase 4) — contract in docs/phase4-inbox.md
  META_WEBHOOK_VERIFY_TOKEN?: string;
  // Online payment (Stripe Checkout) — src/billing
  STRIPE_SECRET_KEY?: string; // restricted key rk_… (or sk_…); unset = online payment off
  STRIPE_WEBHOOK_SECRET?: string; // whsec_… of the /webhook/stripe endpoint
  // SMS_PROVIDER=android_gateway (src/auth/sms.ts): the shop's Android phone via SMS Gateway for Android
  SMS_GATEWAY_URL?: string; // https only; unset = the project's cloud server
  SMS_GATEWAY_USERNAME?: string;
  SMS_GATEWAY_PASSWORD?: string;
  // LINE Login (src/auth/line.ts) — its own LINE Login channel, not the Messaging API bot above
  LINE_LOGIN_CHANNEL_ID?: string;
  LINE_LOGIN_CHANNEL_SECRET?: string;
  RECEIPT_SELLER_NAME?: string; // unset = no receipts yet; the cron issues them once it is set
  RECEIPT_SELLER_ADDRESS?: string;
  RECEIPT_SELLER_TAX_ID?: string;
  RECEIPT_VAT_REGISTERED?: string; // "1" = short-form tax invoice with 7% VAT shown
  SIGNUP_CREDITS?: string; // free credits granted once at signup; unset or not a positive integer = none
  // System control panel (src/system): base64 32-byte AES-GCM key for secrets saved from /admin/system/
  SETTINGS_KEY?: string;
  // Feature switches, "on" | "off" (src/system/registry.ts); withSettings() fills in their defaults
  FEATURE_MAINTENANCE?: string;
  FEATURE_PAYMENTS?: string;
  FEATURE_CLIPS?: string;
  FEATURE_SOCIAL?: string;
  FEATURE_INBOX?: string;
  FEATURE_LINE_BOT?: string;
  FEATURE_GOOGLE_LOGIN?: string;
  FEATURE_LINE_LOGIN?: string;
  FEATURE_TURNSTILE?: string;
  FEATURE_MARKETER?: string;
  // AI marketer trending videos from a data provider (src/marketer/trending.ts)
  TRENDING_API_URL?: string;
  TRENDING_API_KEY?: string;
  TRENDING_API_USD_RATE?: string;
  // AI video (src/video): the active provider and its account, chosen in /admin/system/
  VIDEO_PROVIDER?: string;
  VIDEO_API_KEY?: string;
  VIDEO_BASE_URL?: string;
  VIDEO_MODEL?: string;
  VIDEO_RESOLUTION?: string;
}

/** A signed-in customer, as returned by /api/auth/otp/verify and /api/auth/me. */
export interface User {
  id: string;
  displayName: string;
  phone: string | null;
  email: string | null;
}

export interface Product {
  id: number;
  name: string;
  description: string;
  category: string;
  price: number;
  stock: number;
  image_url: string;
  active: number;
}

export interface OrderItem {
  product_id: number;
  name: string;
  price: number;
  quantity: number;
}

/** Condensed chat history: only the visible text of each turn is kept. */
export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}
