export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY: string;
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  ADMIN_TOKEN: string;
  // Phase 1 auth — contract in docs/phase1-tasks.md
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  SMS_PROVIDER: "mock" | "thaibulksms";
  SMS_API_KEY?: string;
  SMS_API_SECRET?: string;
  SMS_SENDER?: string;
  APP_ORIGIN: string;
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
