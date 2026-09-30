// Pure campaign-name classification for the ads connector. No I/O, no env
// reads: callers pass the parsed ADS_LINE_RULES and the CLIENTS map in.
//
// A campaign lands on exactly one "line":
//   hs_b2c   client lead-gen campaigns, named "(Owner) Business - ..." — joined to
//            Airtable leads through lib/clients.js
//   hs_b2b   Home Service owner acquisition campaigns (name contains "b2b")
//   tax_b2b  Tax B2B acquisition campaigns (name contains "b2b" and "tax")
//   other    anything else (reported as unclassified spend)

export const LINES = Object.freeze(['hs_b2c', 'hs_b2b', 'tax_b2b', 'other']);

const CLIENT_SEPARATOR = ' - ';

/**
 * Parse the ADS_LINE_RULES env value: a JSON array of { match: "<regex>", line }.
 * Never throws. Bad JSON, a non-array, an invalid regex or an unknown line
 * leaves that rule (or the whole list) out and explains why in `warning`.
 *
 * @param {string|undefined|null} envString
 * @returns {{ rules: Array<{ match: RegExp, line: string, source: string }>, warning: string|null }}
 */
export function parseLineRules(envString) {
  const text = String(envString ?? '').trim();
  if (!text) return { rules: [], warning: null };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { rules: [], warning: `ADS_LINE_RULES is not valid JSON (${e.message}); ignoring it.` };
  }
  if (!Array.isArray(parsed)) {
    return { rules: [], warning: 'ADS_LINE_RULES must be a JSON array of { "match", "line" }; ignoring it.' };
  }
  const rules = [];
  const problems = [];
  parsed.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object' || typeof entry.match !== 'string' || !entry.match) {
      problems.push(`rule ${i + 1} has no "match" string`);
      return;
    }
    const line = String(entry.line ?? '').trim();
    if (!LINES.includes(line)) {
      problems.push(`rule ${i + 1} (${entry.match}) has an unknown line "${line}" (use ${LINES.join('|')})`);
      return;
    }
    let re;
    try {
      re = new RegExp(entry.match, 'i');
    } catch (e) {
      problems.push(`rule ${i + 1} regex "${entry.match}" is invalid (${e.message})`);
      return;
    }
    rules.push({ match: re, line, source: entry.match });
  });
  const warning = problems.length ? `ADS_LINE_RULES: skipped ${problems.join('; ')}.` : null;
  return { rules, warning };
}

/** A rule's matcher as a case-insensitive RegExp, whatever form the caller stored it in. */
function ruleRegex(rule) {
  if (!rule) return null;
  if (rule.match instanceof RegExp) return rule.match;
  if (typeof rule.match === 'string' && rule.match) {
    try { return new RegExp(rule.match, 'i'); } catch { return null; }
  }
  return null;
}

/**
 * The client a "(Owner) Business - ..." campaign belongs to: the longest
 * CLIENTS key that is a case-insensitive prefix of the name, else the text
 * before the first " - " (or the whole name). The returned `known` flag says
 * whether the client is a key of the map.
 *
 * @param {string} name
 * @param {Record<string, unknown>} clients
 * @returns {{ client: string, known: boolean }}
 */
export function clientFromCampaign(name, clients = {}) {
  const trimmed = String(name ?? '').trim();
  const lower = trimmed.toLowerCase();
  let best = null;
  for (const key of Object.keys(clients || {})) {
    if (!key) continue;
    if (lower.startsWith(key.toLowerCase()) && (!best || key.length > best.length)) best = key;
  }
  if (best) return { client: best, known: true };
  const idx = trimmed.indexOf(CLIENT_SEPARATOR);
  const client = (idx > 0 ? trimmed.slice(0, idx) : trimmed).trim();
  return { client, known: false };
}

/**
 * Classify one campaign name. Rules, in order:
 *   1. `rules` (from parseLineRules / ADS_LINE_RULES), first match wins
 *   2. name starts with "("            -> hs_b2c, client from clientFromCampaign()
 *   3. contains "b2b" and "tax"        -> tax_b2b
 *   4. contains "b2b"                  -> hs_b2b
 *   5. anything else                   -> other
 * An env rule that lands on hs_b2c still resolves the client the same way.
 *
 * @param {string} name
 * @param {{ rules?: Array<{ match: RegExp|string, line: string }>, clients?: Record<string, unknown> }} [opts]
 * @returns {{ line: string, client: string|null, clientKnown: boolean, rule: string }}
 */
export function classifyCampaign(name, { rules = [], clients = {} } = {}) {
  const text = String(name ?? '').trim();
  const withClient = (line, rule) => {
    if (line !== 'hs_b2c') return { line, client: null, clientKnown: false, rule };
    const c = clientFromCampaign(text, clients);
    return { line, client: c.client || null, clientKnown: c.known, rule };
  };

  for (const rule of rules || []) {
    const re = ruleRegex(rule);
    if (!re || !LINES.includes(rule.line)) continue;
    re.lastIndex = 0;
    if (re.test(text)) return withClient(rule.line, 'env');
  }
  if (text.startsWith('(')) return withClient('hs_b2c', 'prefix');
  const b2b = /b2b/i.test(text);
  if (b2b && /tax/i.test(text)) return withClient('tax_b2b', 'tax');
  if (b2b) return withClient('hs_b2b', 'b2b');
  return withClient('other', 'none');
}
