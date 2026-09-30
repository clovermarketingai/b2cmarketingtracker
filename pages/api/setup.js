// GET  /api/setup -> which Dashboard tables exist in AIRTABLE_DASHBOARD_BASE
// POST /api/setup -> creates the missing "Dashboard Costs" / "Dashboard Targets" /
//                    "Dashboard Snapshots" tables through the Airtable meta API
//                    (the token needs schema.bases:write) -> { created, existing, errors }
// Session-protected by middleware.js. Never echoes the token.

import * as costs from '../../lib/dashboard/sources/costs';

const TABLE_NAMES = ['Dashboard Costs', 'Dashboard Targets', 'Dashboard Snapshots'];

function tableNames() {
  return Array.isArray(costs.DASHBOARD_TABLES) ? costs.DASHBOARD_TABLES.map(t => t.name) : TABLE_NAMES;
}

function baseId() {
  if (typeof costs.config === 'function') return costs.config().baseId;
  return (process.env.AIRTABLE_DASHBOARD_BASE || process.env.AIRTABLE_HS_BASE || '').trim() || 'appG9APSCkeYOQLbl';
}

function hint() {
  return typeof costs.setupHint === 'function'
    ? costs.setupHint()
    : 'Set AIRTABLE_API_KEY (schema.bases:write) and optionally AIRTABLE_DASHBOARD_BASE, then POST /api/setup.';
}

function errorBody(err) {
  const body = { error: String(err && err.message || err) };
  if (err && err.hint) body.hint = err.hint;
  if (err && err.missingConfig) body.missingConfig = true;
  return body;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const base = baseId();
  const names = tableNames();

  if (req.method === 'GET') {
    if (typeof costs.dashboardTablesStatus !== 'function') {
      return res.status(501).json({ error: 'Table status is not supported by this build (costs.dashboardTablesStatus missing).', base });
    }
    try {
      const s = await costs.dashboardTablesStatus({ token: process.env.AIRTABLE_API_KEY, baseId: base });
      const tables = Object.fromEntries(names.map(n => [n, s.existing.includes(n)]));
      return res.status(200).json({ base: s.baseId || base, tables, missing: s.missing, hint: hint() });
    } catch (err) {
      const body = errorBody(err);
      body.base = base;
      body.tables = Object.fromEntries(names.map(n => [n, null]));
      body.hint = body.hint || hint();
      return res.status(err && err.missingConfig ? 200 : 502).json(body);
    }
  }

  if (req.method === 'POST') {
    if (typeof costs.ensureDashboardTables !== 'function') {
      return res.status(501).json({ error: 'Table creation is not supported by this build (costs.ensureDashboardTables missing).', base });
    }
    try {
      const r = await costs.ensureDashboardTables({ token: process.env.AIRTABLE_API_KEY, baseId: base });
      const ok = !(r.errors && r.errors.length);
      return res.status(ok ? 200 : 207).json({ ok, base: r.baseId || base, created: r.created || [], existing: r.existing || [], errors: r.errors || [] });
    } catch (err) {
      const body = errorBody(err);
      body.base = base;
      body.hint = body.hint || hint();
      return res.status(err && err.missingConfig ? 400 : 502).json(body);
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed.' });
}
