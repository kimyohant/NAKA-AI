# หลังร้าน naka-ai (`/admin/`)

All pages share one design (`public/admin/admin.css`) and one shell (`public/admin/admin-shell.js`).
The shell gives every page a grouped sidebar on desktop and a tab bar on phones. Every API under
`/api/admin/*` passes `checkAdmin` (`src/admin/auth.ts`): an admin Google account listed in
`ADMIN_EMAILS` with a sign-in less than 12 hours old, or the `ADMIN_TOKEN` break-glass token.

## Pages

| Group | Page | Path | API |
|---|---|---|---|
| งานประจำวัน | ภาพรวม | `/admin/` | `GET /api/admin/overview` |
| | จัดการลูกค้า | `/admin/customers/` (`?customer=<id>` opens one) | `/api/admin/customers/*` |
| | การเงิน | `/admin/payments/` (filters in the query string) | `GET /api/admin/payments`, `GET /api/admin/payments.csv` |
| | งานที่ล้มเหลว | `/admin/jobs/` (`?days=1\|7\|30`) | `GET /api/admin/jobs` |
| ระบบ | ระบบ Studio | `/admin/studio-system/` | `/api/admin/studio-system/*` |
| | ตั้งค่าระบบ | `/admin/system/` | `/api/admin/system/*` |
| | แจ้งเตือน LINE | `/admin/alerts/` | `/api/admin/alerts/*` |
| | ประวัติการจัดการ | `/admin/audit/` | `GET /api/admin/audit` |
| | บอทขายของ LINE | `/admin/bot/` (was `/admin/` until the overview took that path) | `/api/admin/products`, `orders`, … |

On phones the tab bar shows the four daily pages. The rest open from "เพิ่มเติม", a bottom sheet
built on the native `<dialog>`.

## How the numbers are counted (`src/admin/insights.ts`)

- **Days and months are Thailand days (UTC+7)**, as in `infra/postgres/init/03-reporting.sql`.
- **Revenue** counts successful payments only, on the day they were paid (`paid_at`, falling back to
  `created_at`). The payments list and the CSV filter on the day each payment was *created*.
- **Packages in force** follow the billing rule: `status = 'active'`, and `expires_at` is empty or in the
  future. The free plan is not counted as a package.
- **Credits used** are holds minus refunds (`job_hold`/`job_refund` for naka-ai,
  `studio_hold`/`studio_refund` for the studio). An open hold counts as used, matching
  `reporting.credits_used_by_user`.
- **Waiting payments** are `pending` payments that have not passed `expires_at`. A pending payment past
  its expiry shows as "หมดเวลา (รออัปเดต)" until the billing cron marks it expired.
- **Failed naka-ai jobs** come from `jobs` (status `failed`). "Refunded" means a `job_refund` ledger row
  exists. `failJob` writes that row once, when the last attempt fails.
- **Failed studio tasks** come from the studio's own `GET /api/v1/system/failed-tasks` (admin only,
  called server to server with `STUDIO_ADMIN_TOKEN`). The studio stores the naka-ai user id in
  `owner_user_id`, and the page shows the customer's name next to it. Prompts never leave the studio.
  An older studio has no such route and answers with its HTML app. The page then says the studio needs
  updating; it never treats a missing answer as "nothing failed".

## CSV export

`GET /api/admin/payments.csv` applies the same filters as the list and returns at most 10,000 rows.
A larger result is refused with 413 ("เลือกช่วงวันที่ให้สั้นลง").

- The file starts with a UTF-8 BOM so Excel reads Thai correctly.
- Times are in Thailand time.
- A cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading `'`, so a
  customer's display name cannot run as a spreadsheet formula (OWASP CSV injection).

## LINE alerts (`src/admin/alerts.ts`, migration `0006_admin_alerts.sql`)

Admins receive alerts through the shop's own LINE OA (`LINE_CHANNEL_ACCESS_TOKEN`, webhook `/webhook/line`).

- **Pairing:** "เพิ่มผู้รับ" makes a six-digit code that is valid for ten minutes, and only its SHA-256 is stored.
  - The admin sends `แจ้งเตือน 123456` to the OA. The webhook adds that LINE account and replies.
  - This works even while the shop bot (`FEATURE_LINE_BOT`) is off.
  - Every wrong code counts against all open codes, and five wrong codes close them.
  - `หยุดแจ้งเตือน` from a recipient removes them. From anyone else it is an ordinary chat message.
- **The check** runs from the cron every five minutes and sends **one** message per run.
  - **Rules:** failed jobs (naka-ai and studio, last 30 minutes), naka-studio unreachable or holding
    "unknown" tasks, queued jobs waiting more than 15 minutes, failed payments (last 30 minutes), and
    optionally every successful payment.
  - **Repeats:** a problem that is still there is repeated after two hours.
  - **Recovery:** the studio and the queue also announce when they are back to normal.
  - **Payments:** successful payments are announced once each. Payments made before anyone paired are
    never replayed.
- **Cost:** every alert is a LINE push message and counts against the OA plan's monthly message quota.
- **Audit:** changes are recorded in `system_audit` under area `alert`: codes made, recipients added
  or removed, rules changed, and test messages.

## History of admin actions (`src/admin/audit.ts`)

`GET /api/admin/audit` merges `admin_audit` (one customer) and `system_audit` (settings, plans, studio
cancels, alerts), newest first, 50 per page. It filters by source, actor or a search. Neither table is ever
updated or deleted. Secret settings appear only as their last four characters.
