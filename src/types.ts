export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY: string;
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  ADMIN_TOKEN: string;
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
