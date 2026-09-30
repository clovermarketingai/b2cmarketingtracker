# Clover Command Center

The one place Clover Marketing reads its numbers: cash collected, every tracked cost and known profit for the CEO; delivery, sales, CSM and Tax B2B metrics for the team. Every metric is shown for Today, Yesterday, Last 7 days, Last 30 days, Month to date and Last month, plus Week 1–5 blocks, with a previous-period delta and a pace-to-target status.

Hosted at **https://b2c.clovermarketing.ai/**.

Data comes from Facebook ads (Windsor.ai), the Home Service Airtable base (leads, clients, prospects, Closer EOD), the Tax B2B CRM (Airtable), Whop payments, and two small Airtable tables you fill in yourself (manual costs and monthly targets). Everything is aggregated server-side in one business timezone and served through a cached API that Sheets, n8n and BI tools can read with an API key.

## Pages

| Page | What it is |
|---|---|
| `/` | The Command Center: CEO section (lockable with a password), Home Service delivery, Sales, CSM and Tax sections, per-client / per-closer / per-campaign / Whop product tables, sparklines, and the Data sources panel. |
| `/daily` | The original per-client daily P&L: Facebook spend vs. Airtable leads and billed revenue by client and day, all-time. |

## Quick start

```bash
npm install
# put the variables from docs/SETUP.md in .env.local (never committed)
npm run dev                   # http://localhost:3000
```

Without any keys, open `http://localhost:3000/api/metrics?demo=1` (after signing in with `APP_PASSWORD`) to see the full payload on synthetic data, or add `?demo=1` to the dashboard.

Minimum variables to run: `APP_PASSWORD`, `SESSION_SECRET`, `WINDSOR_API_KEY`, `AIRTABLE_API_KEY`. Everything else (Whop, Tax CRM, CEO lock, API key, cron) is optional and documented in [docs/SETUP.md](docs/SETUP.md).

## npm scripts

| Script | Does |
|---|---|
| `npm run dev` | Next.js dev server. |
| `npm run build` / `npm start` | Production build and server. |
| `npm test` | Every `test/*.test.js` suite with `node --test` (pure normalisers and the aggregation engine, no network). |
| `npm run docs` | Regenerates `docs/METRICS.md` from `lib/dashboard/catalog.js`. Run it after changing a metric; `node scripts/gen-metrics-doc.mjs --check` fails when the file is out of date. |

## Documentation

- [docs/SETUP.md](docs/SETUP.md) — operator guide: every environment variable, the Airtable dashboard tables, Whop, campaign classification, the CEO lock, the external API (curl, Google Sheets, n8n, Grow), Vercel Cron and snapshots, caching, troubleshooting.
- [docs/METRICS.md](docs/METRICS.md) — every metric with its unit, direction, formula, the range definitions, the pace/status bands and the timezone rule. Generated; do not edit by hand.

## Layout

```
lib/dashboard/catalog.js   what the dashboard shows (sections, rows, formulas, status bands)
lib/dashboard/compute.js   the aggregation engine (pure)
lib/dashboard/sources/     one connector per source; pure normalisers + fetch wrappers
lib/dashboard/load.js      pulls every source through the cache and builds the payload
lib/auth.js, middleware.js session cookie, CEO unlock, API key and cron secret
pages/api/metrics.js       GET /api/metrics — the payload the page renders
pages/api/v1/*             external read API (metrics, daily, clients)
pages/api/cron/refresh.js  daily warm-up + Airtable snapshot
pages/api/setup.js, ceo.js create the dashboard tables; CEO unlock
```

## Deployment (Vercel)

1. Import the repository in Vercel (Next.js is detected; no build settings needed).
2. Add the environment variables from [docs/SETUP.md](docs/SETUP.md) for Production and Preview.
3. Deploy. `vercel.json` registers the daily `/api/cron/refresh` job (06:45 Toronto); set `CRON_SECRET` so Vercel can authenticate it.
4. Sign in, run `POST /api/setup` once to create the *Dashboard Costs*, *Dashboard Targets* and *Dashboard Snapshots* tables, then add your monthly costs and targets in Airtable.

Pushes to the production branch redeploy automatically.
