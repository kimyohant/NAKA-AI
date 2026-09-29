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
  APP_ORIGIN: string;
  // Affiliate review voiceover (Google Cloud Text-to-Speech)
  GOOGLE_TTS_API_KEY: string;
  GOOGLE_TTS_VOICE?: string;
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
