// STUB — replaced by the build workflow. Contract in lib/dashboard/load.js.
import { unconfigured } from './_shared.js';
export function isConfigured() { return false; }
export function setupHint() { return 'Connector not implemented yet.'; }
export async function fetchLeads() { throw unconfigured('Home Service leads (Airtable)', 'Set AIRTABLE_API_KEY.'); }
export async function fetchClients() { throw unconfigured('Home Service clients (Airtable)', 'Set AIRTABLE_API_KEY.'); }
export async function fetchProspects() { throw unconfigured('Prospects (Airtable)', 'Set AIRTABLE_API_KEY.'); }
export async function fetchCloserEod() { throw unconfigured('Closer EOD (Airtable)', 'Set AIRTABLE_API_KEY.'); }
