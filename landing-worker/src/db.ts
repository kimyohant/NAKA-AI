import type { HistoryTurn, OrderItem, Product } from "./types";

const HISTORY_LIMIT = 20;

export async function getSettings(db: D1Database): Promise<Record<string, string>> {
  const { results } = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  return Object.fromEntries(results.map((r) => [r.key, r.value]));
}

export async function searchProducts(db: D1Database, query: string): Promise<Product[]> {
  const q = query.trim();
  if (!q) {
    const { results } = await db.prepare("SELECT * FROM products WHERE active = 1 ORDER BY id LIMIT 30").all<Product>();
    return results;
  }
  // Match any keyword against name / description / category.
  const words = q.split(/\s+/).slice(0, 5);
  const clause = words.map(() => "(name LIKE ? OR description LIKE ? OR category LIKE ?)").join(" OR ");
  const binds = words.flatMap((w) => [`%${w}%`, `%${w}%`, `%${w}%`]);
  const { results } = await db
    .prepare(`SELECT * FROM products WHERE active = 1 AND (${clause}) ORDER BY id LIMIT 30`)
    .bind(...binds)
    .all<Product>();
  return results;
}

export interface OrderInput {
  customer_name: string;
  phone: string;
  address: string;
  note?: string;
  items: { product_id: number; quantity: number }[];
}

export async function createOrder(
  db: D1Database,
  lineUserId: string,
  input: OrderInput,
): Promise<{ ok: true; order_id: number; total: number; items: OrderItem[] } | { ok: false; error: string }> {
  if (!input.items?.length) return { ok: false, error: "ไม่มีสินค้าในออเดอร์" };

  const items: OrderItem[] = [];
  for (const { product_id, quantity } of input.items) {
    if (!Number.isInteger(quantity) || quantity < 1) return { ok: false, error: `จำนวนไม่ถูกต้องสำหรับสินค้า #${product_id}` };
    const p = await db.prepare("SELECT * FROM products WHERE id = ? AND active = 1").bind(product_id).first<Product>();
    if (!p) return { ok: false, error: `ไม่พบสินค้า #${product_id}` };
    if (p.stock < quantity) return { ok: false, error: `${p.name} เหลือเพียง ${p.stock} ชิ้น` };
    items.push({ product_id: p.id, name: p.name, price: p.price, quantity });
  }
  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  // Decrement stock only where enough remains, then insert the order — all in one batch.
  const stmts = items.map((i) =>
    db.prepare("UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?").bind(i.quantity, i.product_id, i.quantity),
  );
  stmts.push(
    db
      .prepare("INSERT INTO orders (line_user_id, customer_name, phone, address, items, total, note) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(lineUserId, input.customer_name, input.phone, input.address, JSON.stringify(items), total, input.note ?? ""),
  );
  const results = await db.batch(stmts);
  const orderId = results[results.length - 1].meta.last_row_id;
  if (results.slice(0, items.length).some((r) => r.meta.changes === 0)) {
    // A concurrent order took the stock; roll this one back.
    const undo = items
      .filter((_, idx) => results[idx].meta.changes > 0)
      .map((i) => db.prepare("UPDATE products SET stock = stock + ? WHERE id = ?").bind(i.quantity, i.product_id));
    await db.batch([...undo, db.prepare("DELETE FROM orders WHERE id = ?").bind(orderId)]);
    return { ok: false, error: "สต็อกเพิ่งหมดระหว่างสั่งซื้อ กรุณาตรวจสอบสินค้าอีกครั้ง" };
  }
  return { ok: true, order_id: orderId, total, items };
}

export async function ordersForUser(db: D1Database, lineUserId: string) {
  const { results } = await db
    .prepare("SELECT id, items, total, status, created_at FROM orders WHERE line_user_id = ? ORDER BY id DESC LIMIT 5")
    .bind(lineUserId)
    .all();
  return results;
}

export interface Conversation {
  line_user_id: string;
  display_name: string;
  history: HistoryTurn[];
  human_mode: boolean;
  handoff_reason: string;
}

export async function getConversation(db: D1Database, lineUserId: string): Promise<Conversation> {
  const row = await db
    .prepare("SELECT * FROM conversations WHERE line_user_id = ?")
    .bind(lineUserId)
    .first<{ line_user_id: string; display_name: string; history: string; human_mode: number; handoff_reason: string }>();
  if (!row) return { line_user_id: lineUserId, display_name: "", history: [], human_mode: false, handoff_reason: "" };
  return { ...row, history: JSON.parse(row.history), human_mode: row.human_mode === 1 };
}

export async function saveConversation(db: D1Database, conv: Conversation): Promise<void> {
  // Keep the tail, and make sure it starts with a user turn.
  let history = conv.history.slice(-HISTORY_LIMIT);
  while (history.length && history[0].role !== "user") history = history.slice(1);
  await db
    .prepare(
      `INSERT INTO conversations (line_user_id, display_name, history, human_mode, handoff_reason, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(line_user_id) DO UPDATE SET
         display_name = excluded.display_name, history = excluded.history, human_mode = excluded.human_mode,
         handoff_reason = excluded.handoff_reason, updated_at = excluded.updated_at`,
    )
    .bind(conv.line_user_id, conv.display_name, JSON.stringify(history), conv.human_mode ? 1 : 0, conv.handoff_reason)
    .run();
}
