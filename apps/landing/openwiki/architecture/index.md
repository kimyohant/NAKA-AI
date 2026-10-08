# Files

- [Job Queue, Credits and Cron](background-processing.md) - How naka-ai runs AI work in the background — a D1-backed job queue with leases and fencing tokens, an append-only credit ledger that holds and refunds credits, and the per-minute cron that fans out to queue, social, billing, receipts, marketer and inbox work.
- [D1 Data Model and Migrations](data-model.md) - How naka-ai stores state in Cloudflare D1 — the legacy LINE-bot schema.sql versus the numbered migrations/ files, the tables each feature area owns, and the rule to migrate before deploying dependent code.
- [Static Front End](frontend.md) - The build-less front end under public/ — plain HTML/CSS/JS pages served by Workers Assets, the route groups, 3D and Godot landing assets, and the design brief that constrains UI copy.
- [Worker Request Routing](request-routing.md) - How the single naka-ai Cloudflare Worker dispatches each request — settings overlay, www redirect, feature closing, studio SSO, auth, per-prefix API handlers, webhooks, the admin API and the static-asset fall-through.
- [Runtime Settings and Feature Flags](runtime-settings.md) - How values saved in the /admin/system/ panel (D1 system_settings, secrets encrypted with AES-GCM) are merged over wrangler vars on every request, how FEATURE_* switches work, and how to register a new setting.
