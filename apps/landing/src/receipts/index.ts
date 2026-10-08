import type { Env as AppEnv } from '../types';
import { getUser } from '../auth/session';
import { formatSatang, inclusiveVatSatang, thaiBahtWords } from './money';

/** Local extension until the integration owner adds these optional fields to src/types.ts. */
export interface Env extends AppEnv {
  RECEIPT_SELLER_NAME?: string;
  RECEIPT_SELLER_ADDRESS?: string;
  RECEIPT_SELLER_TAX_ID?: string;
  RECEIPT_VAT_REGISTERED?: string;
}

interface ReceiptRef { id: string; number: string }
interface Payment {
  id: string; user_id: string; plan_name: string; period: 'monthly' | 'yearly';
  amount_satang: number; paid_at: number;
}
export interface ReceiptSnapshot {
  title: string;
  seller: { name: string; address: string; taxId: string | null };
  buyer: { name: string; phone: string | null; email: string | null };
  planName: string;
  period: 'monthly' | 'yearly';
  periodLabel: string;
  paidAt: number;
  paidDate: string;
  issuedDate: string;
  amountSatang: number;
  amountText: string;
  amountWords: string;
  vatRegistered: boolean;
  vatSatang: number | null;
  vatText: string | null;
  subtotalSatang: number;
  subtotalText: string;
}
interface ReceiptRow extends ReceiptRef { issued_at: number; snapshot: string }

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
const dateLabel = (seconds: number) => new Date(seconds * 1000).toLocaleDateString('th-TH', {
  timeZone: 'Asia/Bangkok', dateStyle: 'long',
});

async function issue(env: Env, paymentId: string): Promise<{ receipt: ReceiptRef | null; created: boolean }> {
  const existing = await env.DB.prepare('SELECT id, number FROM receipts WHERE payment_id = ?')
    .bind(paymentId).first<ReceiptRef>();
  if (existing) return { receipt: existing, created: false };
  const sellerName = env.RECEIPT_SELLER_NAME?.trim();
  if (!sellerName) return { receipt: null, created: false };

  const payment = await env.DB.prepare(`SELECT p.id, p.user_id, p.period, p.amount_satang, p.paid_at, pl.name AS plan_name
    FROM payments p JOIN plans pl ON pl.id = p.plan_id
    WHERE p.id = ? AND p.status = 'successful' AND p.paid_at IS NOT NULL`)
    .bind(paymentId).first<Payment>();
  if (!payment || !Number.isSafeInteger(payment.amount_satang) || payment.amount_satang <= 0 ||
    !Number.isSafeInteger(payment.paid_at)) return { receipt: null, created: false };
  const year = new Date((payment.paid_at + 7 * 3600) * 1000).getUTCFullYear();
  if (!Number.isFinite(year)) return { receipt: null, created: false };
  const buyer = await getUser(env.DB, payment.user_id);
  if (!buyer) return { receipt: null, created: false };

  const issuedAt = Math.floor(Date.now() / 1000);
  const vatRegistered = env.RECEIPT_VAT_REGISTERED === '1';
  const vat = vatRegistered ? inclusiveVatSatang(payment.amount_satang) : null;
  const subtotal = payment.amount_satang - (vat ?? 0);
  const snapshot: ReceiptSnapshot = {
    title: vatRegistered ? 'ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ' : 'ใบเสร็จรับเงิน',
    seller: { name: sellerName, address: env.RECEIPT_SELLER_ADDRESS?.trim() ?? '', taxId: env.RECEIPT_SELLER_TAX_ID?.trim() || null },
    buyer: { name: buyer.displayName, phone: buyer.phone, email: buyer.email },
    planName: payment.plan_name, period: payment.period,
    periodLabel: payment.period === 'yearly' ? 'รายปี' : 'รายเดือน',
    paidAt: payment.paid_at, paidDate: dateLabel(payment.paid_at), issuedDate: dateLabel(issuedAt),
    amountSatang: payment.amount_satang, amountText: formatSatang(payment.amount_satang),
    amountWords: thaiBahtWords(payment.amount_satang), vatRegistered,
    vatSatang: vat, vatText: vat === null ? null : formatSatang(vat),
    subtotalSatang: subtotal, subtotalText: formatSatang(subtotal),
  };

  // SQLite serializes writers. The allocation and insert are one statement; a duplicate
  // payment is a no-op and consumes no sequence. Never UPDATE a previously issued snapshot.
  const inserted = await env.DB.prepare(`INSERT INTO receipts
    (id, payment_id, user_id, year, seq, number, issued_at, snapshot)
    SELECT ?1, p.id, p.user_id, ?2, n.seq, printf('RC%04d-%06d', ?2, n.seq), ?3, ?4
    FROM (SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM receipts WHERE year = ?2) n
    JOIN payments p ON p.id = ?5
    WHERE p.status = 'successful' AND p.paid_at = ?6 AND p.amount_satang = ?7 AND p.user_id = ?8
    ON CONFLICT(payment_id) DO NOTHING`)
    .bind(crypto.randomUUID(), year, issuedAt, JSON.stringify(snapshot), paymentId, payment.paid_at, payment.amount_satang, payment.user_id).run();
  const receipt = await env.DB.prepare('SELECT id, number FROM receipts WHERE payment_id = ?')
    .bind(paymentId).first<ReceiptRef>();
  return { receipt, created: inserted.meta.changes === 1 };
}

/** Issue only successful payments; repeated/concurrent calls return the original receipt. */
export async function issueReceipt(env: Env, paymentId: string): Promise<ReceiptRef | null> {
  return (await issue(env, paymentId)).receipt;
}

/** Returns the number this invocation actually inserted, even when cron runs overlap. */
export async function backfillReceipts(env: Env, { max = 50 } = {}): Promise<number> {
  if (!env.RECEIPT_SELLER_NAME?.trim() || !Number.isSafeInteger(max) || max <= 0) return 0;
  const pending = await env.DB.prepare(`SELECT p.id FROM payments p
    JOIN users u ON u.id = p.user_id AND u.status = 'active'
    JOIN plans pl ON pl.id = p.plan_id
    WHERE p.status = 'successful' AND p.paid_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.payment_id = p.id)
    ORDER BY p.paid_at, p.id LIMIT ?`).bind(max).all<{ id: string }>();
  let count = 0;
  for (const payment of pending.results) {
    try { if ((await issue(env, payment.id)).created) count++; }
    catch { console.error('receipts: backfill could not issue a receipt; will retry'); }
  }
  return count;
}

/** Read-only endpoints. The integration router must pass a userId from requireUser(). */
export async function handleReceipts(request: Request, env: Env, url: URL, userId: string): Promise<Response | null> {
  const path = url.pathname;
  if (path !== '/api/receipts' && !path.startsWith('/api/receipts/')) return null;
  if (!userId) return json({ error: 'กรุณาเข้าสู่ระบบ' }, 401);
  if (request.method !== 'GET') {
    const response = json({ error: 'ไม่รองรับวิธีเรียกใช้งานนี้' }, 405);
    response.headers.set('Allow', 'GET');
    return response;
  }
  try {
    if (path === '/api/receipts' || path === '/api/receipts/') {
      const rows = await env.DB.prepare(`SELECT id, number, issued_at, snapshot FROM receipts
        WHERE user_id = ? ORDER BY issued_at DESC, year DESC, seq DESC`).bind(userId).all<ReceiptRow>();
      return json({ receipts: rows.results.map((row) => {
        const snapshot: ReceiptSnapshot = JSON.parse(row.snapshot);
        return { id: row.id, number: row.number, issuedAt: row.issued_at,
          planName: snapshot.planName, period: snapshot.period, amount: snapshot.amountSatang / 100 };
      }) });
    }
    const match = path.match(/^\/api\/receipts\/([0-9a-f-]{36})$/);
    const row = match && await env.DB.prepare(`SELECT id, number, issued_at, snapshot FROM receipts
      WHERE id = ? AND user_id = ?`).bind(match[1], userId).first<ReceiptRow>();
    if (!row) return json({ error: 'ไม่พบใบเสร็จนี้' }, 404);
    const snapshot: ReceiptSnapshot = JSON.parse(row.snapshot);
    return json({ ...snapshot, id: row.id, number: row.number, issuedAt: row.issued_at,
      amount: snapshot.amountSatang / 100, subtotal: snapshot.subtotalSatang / 100,
      vat: snapshot.vatSatang === null ? null : snapshot.vatSatang / 100 });
  } catch {
    console.error('receipts: unable to read receipt');
    return json({ error: 'โหลดใบเสร็จไม่สำเร็จ กรุณาลองใหม่' }, 500);
  }
}
