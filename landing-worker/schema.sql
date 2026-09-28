CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  price REAL NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  image_url TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_user_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  items TEXT NOT NULL,            -- JSON: [{product_id, name, price, quantity}]
  total REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | paid | shipped | cancelled
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(line_user_id);

CREATE TABLE IF NOT EXISTS conversations (
  line_user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  history TEXT NOT NULL DEFAULT '[]',     -- JSON: [{role, content}]
  human_mode INTEGER NOT NULL DEFAULT 0,  -- 1 = บอทหยุดตอบ ให้แอดมินคุยเอง
  handoff_reason TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('shop_name', 'ร้านตัวอย่าง naka-ai'),
  ('shop_info', 'จัดส่งทั่วประเทศผ่าน Flash Express ค่าส่ง 40 บาท ส่งฟรีเมื่อซื้อครบ 500 บาท
ชำระเงินผ่าน PromptPay 0XX-XXX-XXXX (ชื่อบัญชี: ...) แล้วส่งสลิปในแชท
ตัดรอบส่งของทุกวัน 14:00 น. เปลี่ยน/คืนสินค้าได้ภายใน 7 วันหากสินค้ามีปัญหา');

INSERT OR IGNORE INTO products (id, name, description, category, price, stock) VALUES
  (1, 'เสื้อยืดลายพญานาค สีดำ', 'ผ้าคอตตอน 100% ลายสกรีนทอง ไซส์ S M L XL', 'เสื้อผ้า', 390, 25),
  (2, 'เสื้อยืดลายพญานาค สีขาว', 'ผ้าคอตตอน 100% ลายสกรีนเขียวมรกต ไซส์ S M L XL', 'เสื้อผ้า', 390, 12),
  (3, 'กำไลหินมรกต', 'หินธรรมชาติ ขนาดข้อมือ 16-18 ซม. ปรับได้', 'เครื่องประดับ', 590, 8);
