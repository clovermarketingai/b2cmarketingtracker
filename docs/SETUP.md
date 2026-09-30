# Command Center — operator guide

Hosted app: **https://b2c.clovermarketing.ai/**

This is everything an operator needs to connect, secure, automate and troubleshoot the Clover Marketing Command Center. The metric definitions live in [METRICS.md](METRICS.md) (generated from the catalog, run `npm run docs`).

Contents

1. [Environment variables](#1-environment-variables)
2. [Airtable dashboard tables](#2-airtable-dashboard-tables)
3. [Whop connection](#3-whop-connection)
4. [Campaign classification (lines)](#4-campaign-classification-lines)
5. [CEO lock](#5-ceo-lock)
6. [External API](#6-external-api)
7. [Vercel Cron and daily snapshots](#7-vercel-cron-and-daily-snapshots)
8. [Caching and Refresh](#8-caching-and-refresh)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Environment variables

Set these in Vercel (Project → Settings → Environment Variables) for Production and Preview, then redeploy. Names are final; the app reads exactly these.

### Login and secrets

| Variable | Required | What it is for | Where to get it |
|---|---|---|---|
| `APP_PASSWORD` | yes | The shared team password for the login page. | Choose one. |
| `SESSION_SECRET` | yes | Signs the session cookie (`clover_session`) and the CEO cookie. Rotating it signs everyone out at once. | Generate: `openssl rand -hex 32`. |
| `CEO_PASSWORD` | optional | Unlocks the CEO section (see [CEO lock](#5-ceo-lock)). Unset = the CEO section is visible to every signed-in user. | Choose one. |
| `DASHBOARD_API_KEY` | optional | Read access to `/api/v1/*` for Sheets, n8n, Grow, curl (see [External API](#6-external-api)). Unset = the external API answers 401 to everything except a signed-in browser. | Generate: `openssl rand -hex 32`. |
| `CRON_SECRET` | optional | What Vercel Cron sends to `/api/cron/refresh`. It is the **only** credential that route accepts (the read-only `DASHBOARD_API_KEY` does not open it, because the cron writes snapshots). Unset = the cron endpoint answers `401` to everything and the daily snapshot is never written. | Generate: `openssl rand -hex 32`. Vercel reads this exact name and sends it as `Authorization: Bearer <CRON_SECRET>`. |

### Dashboard behaviour

| Variable | Default | What it is for |
|---|---|---|
| `DASHBOARD_TZ` | `America/Toronto` | IANA timezone every "today", "MTD" and "last 7 days" is resolved in. Airtable timestamps are converted into it; ad platform dates are used as reported (set the ad account to the same zone). An invalid zone falls back to the default. |
| `DASHBOARD_CACHE_TTL` | `180` | Seconds a source pull stays fresh in memory (see [Caching](#8-caching-and-refresh)). |

### Facebook ads (Windsor.ai)

| Variable | Required | What it is for | Where to get it |
|---|---|---|---|
| `WINDSOR_API_KEY` | yes | Pulls daily spend, clicks, impressions and `actions_lead` per campaign from `connectors.windsor.ai/facebook`. | Windsor.ai → your account → API key. |
| `WINDSOR_ACCOUNTS` | optional | Comma list passed as `select_accounts` to restrict the pull to specific ad accounts. Blank = every account the key can see. | Windsor.ai account/connector page. |
| `WINDSOR_CLICK_FIELD` | optional | Which Windsor field feeds the *Clicks* column. Default `clicks` = Meta *Clicks (all)*, which includes reactions and profile clicks; set `inline_link_clicks` (if your Windsor field list has it) to report link clicks like Ads Manager and the HQ app. CTR, CPC and click-to-lead follow. | Windsor.ai field reference for Facebook. |
| `ADS_EXCLUDE_CAMPAIGN_IDS` | optional | Comma list of Facebook campaign ids to leave out of every line and total (the same list as `META_EXCLUDE_CAMPAIGN_IDS` on the HQ app: campaigns on the shared ad account that are not Clover's). Excluded spend is reported in the Data sources panel. | Copy from the HQ Vercel project. |
| `ADS_LINE_RULES` | optional | JSON array of `{ "match": "<regex>", "line": "hs_b2c\|hs_b2b\|tax_b2b\|other" }` evaluated before the default naming rules. See [Campaign classification](#4-campaign-classification-lines). | You write it. |

### Airtable — Home Service base

| Variable | Default | What it is for |
|---|---|---|
| `AIRTABLE_API_KEY` | — (required) | Personal access token for the Home Service base. Scopes: `data.records:read` for the dashboard, plus `data.records:write` (snapshots), `schema.bases:read` (listing the dashboard tables: `GET /api/setup`, the daily snapshot's table check and the Data sources table check all call the Airtable meta `/tables` API) and `schema.bases:write` (`POST /api/setup` creates the tables) on the dashboard base. Create at airtable.com/create/tokens and grant it access to the base(s). |
| `AIRTABLE_HS_BASE` | `appG9APSCkeYOQLbl` | The Home Service base id. |
| `AIRTABLE_HS_LEADS_TABLE` | `tblpbVnP4y7YlGcML` | Leads table: `Assigned Client` (link to Clients), `Lead Cost` (single select `$45` … `$115`, `Free`, `Replacement`, `Prepay`, `Unbilled` or blank). The record's `createdTime` is the lead time. |
| `AIRTABLE_HS_CLIENTS_TABLE` | `tblTEOPYFNgfE5NdU` | Clients table: primary field `Company Name` (fallback `Name`). |
| `AIRTABLE_HS_PROSPECTS_TABLE` | `tblxy8uy1rn7YySk7` | Prospect table: `Closer`, `Status` (`Hotlist` and `Follow Up` mean not yet contacted), `Appointment Date` (or `Call Time`), `Created At`, `Time Called`, `Speed to Lead (sec)`. Field ids are used as fallbacks when names differ. |
| `AIRTABLE_HS_EOD_TABLE` | `tblZfN07lZJ6pG6sk` | Closer EOD table: `Closer`, `Date`, `Calls Attempted`, `Calls Connected`, `Offers Given`, `Closes`, `Submitted At` (plus `Energy`, `Focus`, `Protected Biology`, `Daily Rollup`, `Common Objections`). One row per closer per day; a duplicate keeps the latest `Submitted At`. |
| `AIRTABLE_DASHBOARD_BASE` | = `AIRTABLE_HS_BASE` | Base that holds the three dashboard tables (`Dashboard Costs`, `Dashboard Targets`, optional `Dashboard Snapshots`). Point it at a separate base if you do not want costs in the Home Service base; the same token must have access to it. |

### Airtable — Tax B2B CRM

Same names as the HQ app, so the values copy across.

| Variable | Default | What it is for |
|---|---|---|
| `AIRTABLE_TOKEN` | falls back to `AIRTABLE_API_KEY` | Token with `data.records:read` on the CRM base. |
| `AIRTABLE_CRM_BASE` | — (required for the Tax funnel) | The CRM base id (`app…`). Unset = the Tax B2B CRM rows show as unconfigured; the Tax ad rows still work. |
| `AIRTABLE_TABLE_PROSPECTS` | `Prospects` | Prospects table name. Uses `Date Added` (falls back to `createdTime`), `Stage`, `Status`, the appointment field, `Lead Grade`. |
| `AIRTABLE_TABLE_CLIENTS` | `Clients` | Clients table name. Uses `Prospect` (link), `Status`, `Paid Up Front`. |
| `AIRTABLE_FIELD_APPOINTMENT` | `Appointment` | The Prospects field that is truthy when a call is booked. |
| `AIRTABLE_FIELD_AD_SET` | `Ad Set` | Kept for parity with the HQ app; not used by the funnel. |

### Whop

| Variable | Required | What it is for |
|---|---|---|
| `WHOP_API_KEY` | for the CEO cash rows | API key from the Whop dashboard developer settings. |
| `WHOP_COMPANY_ID` | optional | Your company id, `biz_…`. Only needed if Whop answers that the key requires a company id; a company API key is already scoped to its company. |
| `WHOP_AMOUNTS_IN_CENTS` | `0` | Set to `1` only if Whop returns integer cents. See [Whop connection](#3-whop-connection). |

---

## 2. Airtable dashboard tables

Three small tables in `AIRTABLE_DASHBOARD_BASE` feed the CEO section and the pace-to-target status. They are created for you by `POST /api/setup`, or by hand with exactly these names and fields.

### "Dashboard Costs"

Manual costs the platforms do not know about: payroll, messaging tools, affiliates, software, personal projects.

| Field | Type | Allowed values |
|---|---|---|
| `Date` | date (ISO) | Any day. For Monthly rows, any day inside the month the cost belongs to. |
| `Category` | single select | `Payroll`, `Messaging`, `Affiliates`, `Software`, `Personal projects`, `Other` (matched case-insensitively; anything else is counted as *uncategorised* and flagged). |
| `Amount` | currency (USD, 2 decimals) | Positive number. |
| `Period` | single select | `One-time` or `Monthly`. |
| `Note` | single line text | Free text. |

**Proration rule.** A `Monthly` row is spread evenly across every day of its month: `Amount ÷ days in that month` per day inside the range being computed. A `One-time` row lands entirely on its `Date`. Example: a `$3,000` Monthly `Payroll` row dated `2026-09-01` adds `$100` to every September day, so Today shows `$100`, Week 1 `$700`, MTD on the 15th `$1,500`, Last month (once October starts) `$3,000`. Enter one Monthly row per recurring cost per month; a row dated in September does not carry into October.

Rows without a `Date` or a numeric `Amount` are skipped and counted in the source's warnings.

### "Dashboard Targets"

Monthly targets that drive the pace bands (see METRICS.md, "Pace and status").

| Field | Type | Allowed values |
|---|---|---|
| `Metric` | single line text | A catalog row id, exactly as in METRICS.md: `cash_collected`, `leads_billed`, `closes`, `cpl_billed`, … Unknown ids are ignored and flagged. |
| `Month` | single line text | `YYYY-MM`, e.g. `2026-10`. |
| `Target` | number (2 decimals) | The full-month target in the row's unit: dollars for currency rows, a count for count rows, `0–100` for percent rows, seconds for `speed_to_lead`. |
| `Note` | single line text | Free text. |

Targets are keyed by **row id + month**. A row with no target for the current month shows *Set target*. When the same metric+month appears twice, the last record wins and a warning says so. For lower-is-better rows (costs, CPL, replacement rate) enter the ceiling you want to stay under; the pace is inverted automatically.

### "Dashboard Snapshots" (optional)

Written by `/api/cron/refresh` once a day (early in the morning, see [section 7](#7-vercel-cron-and-daily-snapshots)); nothing reads it back into the dashboard. It is your history for Sheets / BI. Because the cron runs a few hours into the business day, it does not store a partial "today": each run stores **yesterday's complete day** plus **month to date as of the run**.

| Field | Type | Values |
|---|---|---|
| `Date` | date (ISO) | The business day the row describes: yesterday for `Range = yesterday`, the run day for `Range = mtd`. |
| `Metric` | single line text | Catalog row id. |
| `Range` | single select | `yesterday` (the full previous business day) or `mtd` (the 1st of the month through the moment of the run). |
| `Value` | number (2 decimals) | The value at snapshot time. |
| `Generated At` | single line text | ISO timestamp of the payload. |

### Creating the tables: `POST /api/setup`

The token in `AIRTABLE_API_KEY` needs `schema.bases:read` (to list the tables that exist) and `schema.bases:write` (to create the missing ones) on `AIRTABLE_DASHBOARD_BASE`. The route is session-protected, so call it from a signed-in browser (DevTools console) or with the session cookie:

```js
// In the browser console while signed in at https://b2c.clovermarketing.ai/
await (await fetch('/api/setup', { method: 'POST' })).json()
// -> { ok: true, base: "app…", created: ["Dashboard Costs", …], existing: [], errors: [] }
```

`GET /api/setup` reports which of the three tables exist (`{ base, tables: { "Dashboard Costs": true, … }, missing: [...] }`) without changing anything; when `AIRTABLE_API_KEY` is unset it still answers `200`, with every table `null`, `missingConfig: true` and a `hint`. A `502` from `GET` means Airtable refused the meta call (most often a token without `schema.bases:read`). For `POST /api/setup`, a `207` means some tables were created and some failed (the `errors` array names each one) and a `400` with `missingConfig: true` means `AIRTABLE_API_KEY` is unset. The tables are created empty; add rows in Airtable.

---

## 3. Whop connection

Cash collected, refunds and processor fees come from `GET https://api.whop.com/api/v1/payments` for your company.

1. **API key.** Whop dashboard → Developer settings → create an API key with read access to payments. Set it as `WHOP_API_KEY`.
2. **Company id (optional).** A company API key is already tied to your company, so leave `WHOP_COMPANY_ID` unset. If the Data sources panel says Whop wants a company id, set it to the `biz_…` id shown in the same developer settings (also in the dashboard URL).
3. Redeploy. The Data sources panel should show *Whop payments: ok* with a payment count.

**What is counted.** Only payments whose `status` is one of `paid`, `succeeded`, `completed`, `partially_refunded`, `refunded`. Every other status (pending, failed, draft, void, …) is dropped and tallied in the source's `meta.statuses`. Each kept payment is dated by the **business calendar day of `paid_at`** (falling back to `created_at`). Cash collected = `total` (fallbacks: `final_amount`, `amount`, `subtotal`); refunds = `refunded_amount`, attributed to the payment's own date; processor fees = `total − amount_after_fees` when Whop reports it (fallback `application_fee.amount`). When fees are missing on some payments the fees row is understated and a warning says for how many. Payments in a non-USD currency are summed at face value (no FX) and flagged.

**`WHOP_AMOUNTS_IN_CENTS`.** The connector assumes Whop returns dollar amounts (`49.00`). If your account returns integer cents (`4900`), every cash figure will be 100× too large. To check: open the Whop products table on the dashboard (or call `GET /api/v1/metrics?section=ceo`) and compare *Cash collected* for yesterday with the Whop dashboard. If it is exactly 100× too high, set `WHOP_AMOUNTS_IN_CENTS=1` and redeploy; the connector then divides `total`, `amount_after_fees`, fees and `refunded_amount` by 100.

**Limits.** One pull follows cursor pagination up to 60 pages of 100 payments (6,000 payments) from `from − 3 days`; hitting the cap adds a warning rather than silently truncating.

---

## 4. Campaign classification (lines)

Every Facebook campaign lands on exactly one *line*, and each line feeds different rows (METRICS.md, "Campaign lines"):

| Line | Meaning | Rows it feeds |
|---|---|---|
| `hs_b2c` | Home Service client lead-gen campaigns | Home Service delivery section, CEO *Home Service B2C ads*, per-client table |
| `hs_b2b` | Home Service client acquisition | Sales section (*Client-acquisition ad spend*, cost per close), CEO *Home Service B2B ads* |
| `tax_b2b` | Tax B2B acquisition | Tax section, CEO *Tax B2B ads* |
| `other` | Unclassified | CEO *Unclassified ads* and a Data sources warning |

**Default rules**, applied to the campaign name in this order:

1. `ADS_LINE_RULES` (below), first match wins.
2. Name starts with `(` → `hs_b2c`. The client is the longest `lib/clients.js` key that prefixes the name (case-insensitive), else the text before the first ` - `. A client that is not in `lib/clients.js` still gets its spend counted but its leads cannot be joined; the Data sources panel names the campaign.
3. Name contains `b2b` and `tax` (case-insensitive) → `tax_b2b`.
4. Name contains `b2b` → `hs_b2b`.
5. Anything else → `other`.

**Override with `ADS_LINE_RULES`.** A JSON array evaluated before the defaults; each entry is a case-insensitive regex and a line:

```json
[
  { "match": "^Tax Pros", "line": "tax_b2b" },
  { "match": "Owner Webinar", "line": "hs_b2b" },
  { "match": "Retargeting - Brand", "line": "other" }
]
```

A rule that lands on `hs_b2c` still resolves the client from the name. Bad JSON, a non-array, an invalid regex or an unknown line never breaks the pull: the offending rule (or the whole value) is skipped and the reason appears as a warning under Data sources. Paste the value as one line in Vercel.

**To check** what landed where: the Campaigns table on the dashboard lists every campaign with its line and client for the month, and the ads source `meta.campaigns` in `GET /api/metrics` has the same list.

---

## 5. CEO lock

The CEO section (cash, all costs, known profit) can be restricted to the owner.

- **Unset `CEO_PASSWORD`** → the CEO section is shown to every signed-in user. `GET /api/ceo` answers `{ configured: false, unlocked: true }`.
- **Set `CEO_PASSWORD`** → the section is hidden (the payload returns `ceo: { locked: true }` with no rows) until the viewer unlocks it. The dashboard's *Unlock CEO* control does `POST /api/ceo { "password": "…" }`, which sets a host-only `clover_ceo` cookie signed with `SESSION_SECRET`. **The unlock lasts 12 hours**, then the section locks again. `DELETE /api/ceo` locks it immediately. A wrong password answers `401` after a short delay.
- **API key holders always see CEO rows.** Any request to `/api/v1/*` that carries a valid `DASHBOARD_API_KEY` is treated as unlocked, so Sheets and n8n get the full picture. Give the API key only to people who may see CEO numbers; a signed-in browser session without the CEO cookie gets `403` from `?section=ceo` and from CEO-only ids on `/api/v1/daily`. The cron route (`CRON_SECRET` only) always builds the payload unlocked so the daily snapshot includes the CEO rows.
- The CEO cookie is deliberately not shared across `*.clovermarketing.ai`: unlocking here never unlocks another Clover app.

Because both cookies are signed with `SESSION_SECRET`, rotating that secret logs everyone out and re-locks the CEO section everywhere at once.

---

## 6. External API

Read-only JSON/CSV for Google Sheets, n8n, Grow or any BI tool. Auth is the `DASHBOARD_API_KEY`, sent one of three ways:

- `Authorization: Bearer <key>` header (preferred)
- `x-api-key: <key>` header
- `?api_key=<key>` query parameter, **only** for tools that cannot set headers at all (Google Sheets `IMPORTDATA`)

**Prefer the header.** A key in the query string is less safe than one in a header: the full URL lands in Vercel's request logs and any log drain, in proxy logs, in browser history when pasted into a tab, and in every sheet formula that anyone with read access to the sheet can see. Use `?api_key=` where a header is impossible and nowhere else, keep such sheets private, and rotate `DASHBOARD_API_KEY` if a URL carrying it has been shared.

A signed-in browser session also works, which is handy for testing in a tab. Without a key and without a session every `/api/v1/*` route answers `401 { "error": "unauthorised" }`. Add `&refresh=1` to any route to bypass the cache (slower; use sparingly).

### Routes

| Route | Returns |
|---|---|
| `GET /api/v1/metrics` | `?format=full` (default): the same payload the dashboard renders, with the CEO section included. `?format=flat`: `{ generatedAt, today, tz, rows: [ { section, id, label, unit, today, yesterday, l7d, l30d, mtd, lastMonth, w1, w2, w3, w4, w5, target, pace, status } ] }`. `?section=ceo,sales` filters to those sections (ids: `ceo`, `hs_delivery`, `sales`, `csm`, `tax_b2b`). |
| `GET /api/v1/daily` | One row per calendar day. `?from=YYYY-MM-DD&to=YYYY-MM-DD` (default the last 30 days; at most 92 days; `from` cannot be earlier than the dashboard's pull window, roughly 60 days back, use the Snapshots table for older history). `?ids=cash_collected,leads_billed` picks metrics (default every catalog row id plus `ad_spend_total`, `business_costs`, `uncategorised_costs`). `?format=json` (default) or `csv`. CSV has a header row, unformatted numbers and an empty cell for null. |
| `GET /api/v1/clients` | The per-client month-to-date table (`payload.tables.clients`): `name, airtable, windsor, health, spend, leads, billed, free, replacement, prepay, unbilled, billedValue, retainer, cplBilled, profit, margin, lastLeadDate, daysSinceLastLead`. `?format=json` or `csv`. |

### curl

```bash
export KEY='paste-DASHBOARD_API_KEY'

# Flat metrics, every section
curl -s -H "Authorization: Bearer $KEY" \
  'https://b2c.clovermarketing.ai/api/v1/metrics?format=flat' | jq '.rows[] | select(.id=="cash_collected")'

# CEO + Sales only, full payload
curl -s -H "Authorization: Bearer $KEY" \
  'https://b2c.clovermarketing.ai/api/v1/metrics?section=ceo,sales'

# Last 30 days as CSV
curl -s -H "Authorization: Bearer $KEY" \
  'https://b2c.clovermarketing.ai/api/v1/daily?format=csv' -o clover-daily.csv

# September, three metrics
curl -s -H "x-api-key: $KEY" \
  'https://b2c.clovermarketing.ai/api/v1/daily?from=2026-09-01&to=2026-09-30&ids=cash_collected,leads_billed,closes'

# Per-client MTD table as CSV
curl -s -H "Authorization: Bearer $KEY" 'https://b2c.clovermarketing.ai/api/v1/clients?format=csv'
```

### Google Sheets

`IMPORTDATA` can only pass the key in the URL:

```
=IMPORTDATA("https://b2c.clovermarketing.ai/api/v1/daily?format=csv&api_key=PASTE_KEY")
```

```
=IMPORTDATA("https://b2c.clovermarketing.ai/api/v1/daily?format=csv&from=2026-09-01&to=2026-09-30&ids=cash_collected,leads_billed,closes&api_key=PASTE_KEY")
```

```
=IMPORTDATA("https://b2c.clovermarketing.ai/api/v1/clients?format=csv&api_key=PASTE_KEY")
```

Sheets refreshes `IMPORTDATA` roughly hourly. This is the one place the key has to travel in the URL (see the warning above): anyone who can read the sheet can see the formula and therefore the key, and the URL is logged on the way. Keep such sheets private, or better, use an Apps Script `UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + key } })` with the key in Script Properties, which keeps it out of the URL and out of the sheet. For the flat metrics (one row per metric with today/L7D/L30D/MTD columns) use Apps Script to fetch `/api/v1/metrics?format=flat` and write `rows` to a sheet; `IMPORTDATA` does not parse JSON.

### n8n

Use an **HTTP Request** node: Method `GET`, URL `https://b2c.clovermarketing.ai/api/v1/metrics?format=flat`, Authentication → *Generic Credential Type* → *Header Auth* with name `Authorization` and value `Bearer <key>` (store the key as a credential, not in the URL). Response format JSON; a following *Split Out* node on `rows` gives one item per metric. For a daily push to a sheet or Slack, run the node on a Schedule trigger in the morning Toronto time (yesterday's numbers are complete by then; the Vercel snapshot cron runs at 10:45 UTC, 06:45 EDT / 05:45 EST, but nothing in the API depends on it), and read `/api/v1/daily?from={{ $today.minus(1,'days') }}&to={{ $today.minus(1,'days') }}` for yesterday's row.

### Grow / BI tools

Point a REST/JSON or CSV connector at `/api/v1/daily?format=csv` (history, one row per day) or `/api/v1/metrics?format=flat` (current values) with the `Authorization: Bearer` header (fall back to the `api_key` parameter only if the tool really cannot send headers; see the warning at the top of this section). For history beyond 92 days, connect the tool to the Airtable *Dashboard Snapshots* table instead: it accumulates a row per metric per day from the cron.

---

## 7. Vercel Cron and daily snapshots

`vercel.json` schedules one job:

```json
{ "crons": [ { "path": "/api/cron/refresh", "schedule": "45 10 * * *" } ] }
```

Cron schedules are UTC, so `45 10 * * *` is **06:45 Toronto in summer (EDT) and 05:45 in winter (EST)**; it does not follow daylight-saving time. Vercel calls `GET /api/cron/refresh` with `Authorization: Bearer <CRON_SECRET>`; set `CRON_SECRET` in the project and Vercel sends it automatically. The route accepts **only** `CRON_SECRET`: the read-only `DASHBOARD_API_KEY` is not enough, because the cron writes to Airtable. To trigger it by hand or from n8n, send the cron secret:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" https://b2c.clovermarketing.ai/api/cron/refresh
# -> { ok: true, ms: 4210, today: "2026-09-30", sources: { ads: { status: "ok", … }, … }, snapshot: "written", snapshotWritten: 44, warnings: [] }
```

What it does:

1. **Writes the daily snapshot.** If a **"Dashboard Snapshots"** table exists in `AIRTABLE_DASHBOARD_BASE`, it appends one record per CEO row and per primary (bold) row of every section: `{ Date, Metric, Range, Value, Generated At }`. Because it runs early in the morning it does not store a partial "today". It stores **yesterday's complete day** (`Range = yesterday`, dated yesterday) and **month to date as of the run** (`Range = mtd`, dated the run day); on the 1st the MTD row covers only the hours since midnight. Null values are skipped. The token needs `data.records:write` (to append) and `schema.bases:read` (to check that the table exists) on the base. This is the cron's real job: it is the only thing that builds the history the *Dashboard Snapshots* table holds.
2. **Rebuilds every source with `refresh=true`** to produce that payload, which doubles as a daily health check: the response lists every source's status, and Vercel → Project → Cron Jobs keeps each run's response. It also fills the memory cache, but only on the serverless instance that served the cron; Vercel usually recycles that instance before anyone opens the dashboard, so do not count on the cron to make the first human load of the day fast. A cold instance simply pulls every source again (a few seconds).

`snapshot` in the response is one of `written`, `no_table` (create it with `POST /api/setup`), `unconfigured` (no `AIRTABLE_API_KEY`), `error` (the message is in `warnings`), `skipped`. A snapshot failure never fails the refresh.

---

## 8. Caching and Refresh

Every source pull is memoised in memory per serverless instance. The rules are deliberately simple, because a Vercel function cannot keep working after it has sent its response (there is no background refresh):

- **Fresh** (younger than `DASHBOARD_CACHE_TTL` seconds, default 180): served from memory, no upstream call. The Data sources panel shows *ok*.
- **Expired** (older than the TTL) or never pulled: re-fetched **synchronously**; the request waits for the upstream call and gets the new value. The panel shows *ok*.
- **Re-fetch failed**: only then is the last good value served, marked *stale* with the error attached, instead of blanking the dashboard. The panel shows *stale* and `error` says why. With no earlier good value the source is reported as *error* and its rows are dashes.
- Concurrent requests for the same source share one in-flight upstream call, so a burst of page loads never multiplies upstream traffic.
- Entries older than 4× the TTL (12 minutes by default) are evicted on the next cache access, and the store is capped at 200 entries (oldest first), so a long-lived instance does not accumulate one dataset per day. The stale fallback therefore only exists while the last good pull is younger than that; after it, a failing source is reported as *error*.

Ways to bypass it:

- The **Refresh** button on the dashboard, which calls `GET /api/metrics?refresh=1`.
- `?refresh=1` on any `/api/v1/*` route.
- The daily cron (always `refresh=true`; it fills the cache only on the instance that served it, see [section 7](#7-vercel-cron-and-daily-snapshots)).

`GET /api/metrics?demo=1` renders synthetic data in the exact live shapes, useful for checking the UI without keys.

---

## 9. Troubleshooting

### The Data sources panel

The panel at the bottom of the dashboard (and `payload.sources` in the API) lists every source with a status, a row count, when it was fetched and how long it took, plus a hint and any warnings its normaliser raised (skipped rows, unknown Lead Cost values, unclassified campaigns, hit caps). `payload.warnings` collects the same messages. A metric whose sources are not all `ok` or `stale` is shown as a dash, never as 0.

| Status | Meaning | What to do |
|---|---|---|
| `ok` | Pulled successfully: either served from memory within the TTL or just re-fetched. | Nothing. |
| `stale` | The cache had expired, the re-fetch failed, and the last good pull is being served instead. The `error` field has the reason. | Press Refresh. If it stays stale, read `error`: an expired token, a 429 rate limit, a timeout (Windsor 40 s, Whop 30 s, Airtable 25 s per page). |
| `unconfigured` | The env var(s) the source needs are unset, or the table does not exist. The `hint` names the variable or the table. | Set the variable in Vercel and redeploy, or run `POST /api/setup` for the dashboard tables. |
| `error` | The pull failed and there is no earlier good value to fall back on. `error` has the upstream message. | See below by source. |
| `demo` | `?demo=1` synthetic data. | Remove `demo=1`. |

### By source

- **Facebook ads (Windsor.ai)** — `401`/`403`: bad `WINDSOR_API_KEY`. *response has no data array*: Windsor answered with an error body; check the account is connected in Windsor. Spend in *Unclassified ads*: fix the campaign name or add an `ADS_LINE_RULES` entry. *campaign … is not in lib/clients.js*: add the client to the rate card so its leads join.
- **Home Service leads / clients / prospects / Closer EOD (Airtable)** — `401` `AUTHENTICATION_REQUIRED`: token invalid. `403` `NOT_AUTHORIZED`: the token was not granted this base. `404` `TABLE_NOT_FOUND`: a table id override is wrong. `422` `INVALID_FILTER_BY_FORMULA`: a field name the filter uses is missing (the prospect pull tries narrower formulas automatically and warns). *Lead Cost the dashboard does not recognise*: add the value to the select or rename it to a price / `Free` / `Replacement` / `Prepay` / `Unbilled`. A hit on the 20,000-record cap is reported as a warning, never truncated silently.
- **Whop payments** — `401`: key invalid or lacks payment read permission. Empty with a valid key: the key may belong to a different company, or Whop wants `WHOP_COMPANY_ID` (the panel says so). Numbers 100× too big: set `WHOP_AMOUNTS_IN_CENTS=1`. *fees are only reported for N of M payments*: Whop omitted `amount_after_fees` on some payments; the fees row is understated.
- **Dashboard Costs / Targets (Airtable)** — `unconfigured` with a table hint: run `POST /api/setup`. `GET /api/setup` answering `502`, or the cron reporting `no_table` although the table exists: the token lacks `schema.bases:read`. *metrics the dashboard does not know*: the `Metric` cell is not a row id; copy it from METRICS.md. *Month must be YYYY-MM*: fix the `Month` cell.
- **Tax B2B CRM (Airtable)** — `unconfigured`: set `AIRTABLE_CRM_BASE` (and `AIRTABLE_TOKEN` if the CRM base is under another token). *no "Date Added" field*: leads are dated by `createdTime` instead. *no prospect has ever been marked Showed/No Show*: shows are inferred from closes only until the team uses the Showed stage.
- **Retainer clients (lib/clients.js)** — never fails; edit the file to add a client, change a rate, or set `paused: true`.

### Other symptoms

- **Everything is a dash and the page says 401** — the session expired; sign in again. `/api/v1/*` from a tool: the key is missing or `DASHBOARD_API_KEY` is unset.
- **Today looks empty early in the morning** — Facebook reports spend with a lag of a few hours and Airtable leads only exist once created; compare *Yesterday* instead. Check `payload.today` matches your calendar day; if not, set `DASHBOARD_TZ`.
- **Leads count differs from Airtable by one day at the edges** — the dashboard dates leads by their `createdTime` converted to `DASHBOARD_TZ`; an Airtable view in another timezone (or in UTC) will differ around midnight. Both are right for their own zone.
- **Facebook-reported leads ≠ Airtable leads** — expected; `fb_leads` is Meta's count and is shown for reconciliation only. Billed leads come from Airtable.
- **CEO section missing** — `CEO_PASSWORD` is set and this browser has not unlocked it in the last 12 hours; use the Unlock control or `POST /api/ceo`.
- **Slow first load** — a cold serverless instance pulls every source (typically 3–8 s). The 180 s cache keeps later loads on the same instance fast; the 10:45 UTC cron warms only the instance that served it, which is usually gone by the time someone opens the dashboard, so the first load of the day is normally a cold one. A `stale` marker means the latest re-fetch failed and you are seeing the last good copy (`error` says why).
- **Cron did not run** — Vercel → Project → Settings → Cron Jobs must show the job from `vercel.json` (crons only deploy from the Production branch). `401` in the cron log: `CRON_SECRET` is unset or differs from what Vercel sends (the route accepts no other credential). `snapshot: "no_table"` every day although the table exists: the token lacks `schema.bases:read`.
