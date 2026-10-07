# landing-worker — naka-ai.com Cloudflare Worker

The backend of naka-ai.com (accounts, login, credits, Stripe, receipts, LINE, Meta posting/inbox, AI marketer, AI video,
admin `/admin/*` APIs, cron), moved here with its git history from
[kimyohant/naka-ai-landing](https://github.com/kimyohant/naka-ai-landing). The static pages it serves stay in that repo
(`public/`); `wrangler.jsonc` points `assets.directory` at `../../naka-ai-landing/public`, so check both repos out side by side:

```
work/naka-ai-backend/landing-worker   ← this folder
work/naka-ai-landing/public           ← pages
```

In the unified NAKA-AI system this Worker is the **account hub**: members sign in here, own their credits and
payments, and open the Studio engine (`../backend`) through SSO (`docs/studio-sso.md`).

```bash
npm ci
npm run dev            # wrangler dev on 127.0.0.1:8788 (wrangler.dev.jsonc)
npm run typecheck
npm test               # page-script checks read ../naka-ai-landing/public (or NAKA_LANDING_PUBLIC), skipped when absent
```

Deploy: production still deploys from naka-ai-landing (its Actions › Deploy). This repo has the same workflow ready as
`.github/workflows/deploy-landing-worker.yml` for when the deploy switches here — see that file for the secrets it needs.
`docs/DEPLOY.md` (secrets, migrations order) still applies; run its commands in this folder.
