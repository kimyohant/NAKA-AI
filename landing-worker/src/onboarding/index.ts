// Phase 5B onboarding status (docs/phase5-onboarding.md).
// Claude wires the route at merge — GET /api/onboarding with the userId taken
// from the session (wiring snippet in docs/onboarding-integration-status.md).
// Every value is read from the real schema: credit_ledger (0002), jobs
// (0002 + the inbox_reply kind from src/inbox), social_accounts (0003) and
// subscriptions (0002, extended by 0007).
import type { Env } from '../types';
import { json } from '../auth/common';
import { getBalance } from '../credits';
import { INBOX_JOB_KIND } from '../inbox/common';

export async function handleOnboarding(request: Request, env: Env, url: URL, userId: string): Promise<Response | null> {
  if (url.pathname !== '/api/onboarding') return null;
  if (request.method !== 'GET') return json({ error: 'วิธีเรียกใช้งานไม่ถูกต้อง' }, 405, { Allow: 'GET' });
  if (!userId) return json({ error: 'กรุณาเข้าสู่ระบบ' }, 401);

  const [credits, row] = await Promise.all([
    getBalance(env.DB, userId),
    env.DB.prepare(
      `SELECT
         COALESCE((SELECT SUM(delta) FROM credit_ledger WHERE user_id = ? AND note = 'signup_bonus'), 0) AS signup_bonus,
         EXISTS (SELECT 1 FROM jobs WHERE user_id = ? AND status = 'done' AND kind <> ?) AS first_video,
         EXISTS (SELECT 1 FROM social_accounts WHERE user_id = ? AND status = 'active') AS page_connected,
         EXISTS (SELECT 1 FROM subscriptions WHERE user_id = ? AND status = 'active') AS has_package`,
    )
      .bind(userId, userId, INBOX_JOB_KIND, userId, userId)
      .first<{ signup_bonus: number; first_video: number; page_connected: number; has_package: number }>()
      .then((row) => row ?? { signup_bonus: 0, first_video: 0, page_connected: 0, has_package: 0 }),
  ]);

  const response = json({
    credits,
    signupBonus: row?.signup_bonus ?? 0,
    steps: {
      firstVideo: Boolean(row?.first_video),
      pageConnected: Boolean(row?.page_connected),
      hasPackage: Boolean(row?.has_package),
    },
  });
  // Per-user data must never be cached or stored by intermediaries.
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
