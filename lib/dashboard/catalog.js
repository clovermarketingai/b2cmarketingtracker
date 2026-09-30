// Metric catalog for the Command Center.
//
// This file is the single source of truth for WHAT the dashboard shows: every
// row of every section, its unit, whether higher or lower is better, whether
// it accumulates over a month (so pace-to-target applies) and a plain-English
// formula. lib/dashboard/compute.js implements the formulas; docs/METRICS.md
// is generated from this catalog so the two can never drift.
//
// Row fields
//   id         stable identifier, also the key used in the Dashboard Targets table
//   label      what the UI prints
//   unit       'currency' | 'number' | 'percent' | 'ratio' | 'seconds' | 'decimal'
//   dir        'higher' (more is better) | 'lower' (less is better) | 'none' (context only)
//   cumulative true for sums that grow through the month (pace = actual / expected-so-far);
//              false for rates and averages (pace = actual / target)
//   needs      dataset keys the value depends on; if any is unavailable the value is null
//   formula    exact definition, in terms of the normalised datasets
//   emphasis   'primary' rows are the ones the owner reads first (bold in the UI)

export const DATASET_LABEL = {
  ads: 'Facebook ads (Windsor.ai)',
  hsLeads: 'Home Service leads (Airtable)',
  clients: 'Home Service clients (Airtable)',
  retainers: 'Retainer clients (lib/clients.js)',
  whop: 'Whop payments',
  costs: 'Dashboard Costs (Airtable)',
  closerEod: 'Closer EOD (Airtable)',
  prospects: 'Prospects (Airtable)',
  b2b: 'B2B Tax CRM (Airtable)',
  targets: 'Dashboard Targets (Airtable)',
};

export const LINE_LABEL = {
  hs_b2c: 'Home Service client campaigns',
  hs_b2b: 'Home Service client acquisition',
  tax_b2b: 'Tax B2B',
  other: 'Unclassified campaigns',
};

const row = (id, label, unit, dir, opts = {}) => ({
  id, label, unit, dir,
  cumulative: opts.cumulative ?? (unit === 'currency' || unit === 'number'),
  needs: opts.needs || [],
  formula: opts.formula || '',
  emphasis: opts.emphasis || 'normal',
  note: opts.note || '',
});

export const SECTIONS = [
  {
    id: 'ceo',
    title: 'CEO — Total company',
    subtitle: 'Cash in, every tracked cost, and what is left. Costs that are not tracked anywhere are not here, which is why profit is "known" profit.',
    ceoOnly: true,
    rows: [
      row('cash_collected', 'Cash collected', 'currency', 'higher', { needs: ['whop'], emphasis: 'primary',
        formula: 'Σ Whop payment total where status is paid, by the local date of paid_at' }),
      row('refunds', 'Refunds', 'currency', 'lower', { needs: ['whop'],
        formula: 'Σ Whop refunded_amount, attributed to the payment\'s paid_at date' }),
      row('tracked_costs', 'Tracked costs', 'currency', 'lower', { needs: ['ads', 'costs'], emphasis: 'primary',
        formula: 'ad spend (all lines) + processor fees + messaging + affiliates + software + other + payroll + personal projects' }),
      row('profit_business', 'Known profit after business costs', 'currency', 'higher', { needs: ['whop', 'ads', 'costs'], emphasis: 'primary',
        formula: 'cash collected − refunds − (ad spend + processor fees + messaging + affiliates + software + other)' }),
      row('profit_all', 'Known profit after all costs', 'currency', 'higher', { needs: ['whop', 'ads', 'costs'], emphasis: 'primary',
        formula: 'profit after business costs − payroll − personal projects' }),
      row('processor_fees', 'Processor fees', 'currency', 'lower', { needs: ['whop'],
        formula: 'Σ (Whop payment total − amount after fees); null when Whop does not report fees' }),
      row('messaging_cost', 'Messaging cost', 'currency', 'lower', { needs: ['costs'],
        formula: 'Σ Dashboard Costs rows with category Messaging (monthly rows prorated per day)' }),
      row('hs_b2b_ads', 'Home Service B2B ads', 'currency', 'lower', { needs: ['ads'],
        formula: 'Σ spend of campaigns classified hs_b2b (client-acquisition campaigns)' }),
      row('hs_b2c_ads', 'Home Service B2C ads', 'currency', 'lower', { needs: ['ads'],
        formula: 'Σ spend of campaigns classified hs_b2c (client lead-gen campaigns, names starting with "(")' }),
      row('tax_b2b_ads', 'Tax B2B ads', 'currency', 'lower', { needs: ['ads'],
        formula: 'Σ spend of campaigns classified tax_b2b' }),
      row('other_ads', 'Unclassified ads', 'currency', 'lower', { needs: ['ads'],
        formula: 'Σ spend of campaigns that matched no classification rule (listed under Data sources)' }),
      row('payroll', 'Payroll', 'currency', 'lower', { needs: ['costs'],
        formula: 'Σ Dashboard Costs rows with category Payroll' }),
      row('affiliates', 'Affiliates', 'currency', 'lower', { needs: ['costs'],
        formula: 'Σ Dashboard Costs rows with category Affiliates' }),
      row('software_cost', 'Software', 'currency', 'lower', { needs: ['costs'],
        formula: 'Σ Dashboard Costs rows with category Software' }),
      row('other_costs', 'Other business costs', 'currency', 'lower', { needs: ['costs'],
        formula: 'Σ Dashboard Costs rows with category Other' }),
      row('personal_projects', 'Personal projects', 'currency', 'lower', { needs: ['costs'],
        formula: 'Σ Dashboard Costs rows with category Personal projects' }),
      row('hs_billed_value', 'Home Service billed lead value', 'currency', 'higher', { needs: ['hsLeads'],
        formula: 'Σ Lead Cost of billed leads + retainer revenue; what was invoiced, not what was collected' }),
    ],
  },
  {
    id: 'hs_delivery',
    title: 'Home Service — Money + delivery',
    subtitle: 'Client lead-gen campaigns and the Airtable leads they produced. Billed = Lead Cost is a price; PROS counts every lead (retainer).',
    rows: [
      row('hs_billed_value', 'Billed lead value', 'currency', 'higher', { needs: ['hsLeads'], emphasis: 'primary',
        formula: 'Σ Lead Cost of billed leads in range + Σ (retainer per week ÷ 7) per day in range' }),
      row('hs_spend', 'Ad spend (B2C campaigns)', 'currency', 'lower', { needs: ['ads'],
        formula: 'Σ spend of hs_b2c campaigns' }),
      row('hs_profit', 'Delivery profit', 'currency', 'higher', { needs: ['hsLeads', 'ads'], emphasis: 'primary',
        formula: 'billed lead value − ad spend (B2C campaigns)' }),
      row('hs_margin', 'Delivery margin', 'percent', 'higher', { needs: ['hsLeads', 'ads'], cumulative: false,
        formula: 'delivery profit ÷ billed lead value' }),
      row('leads_sent', 'Leads sent (all)', 'number', 'higher', { needs: ['hsLeads'], emphasis: 'primary',
        formula: 'count of leads created in range (local date), any Lead Cost' }),
      row('leads_billed', 'Billed leads', 'number', 'higher', { needs: ['hsLeads'], emphasis: 'primary',
        formula: 'count of leads whose Lead Cost is a price, plus every PROS lead' }),
      row('cpl_billed', 'Cost per billed lead', 'currency', 'lower', { needs: ['hsLeads', 'ads'], cumulative: false,
        formula: 'ad spend (B2C) ÷ billed leads' }),
      row('cpl_all', 'Cost per lead (all leads)', 'currency', 'lower', { needs: ['hsLeads', 'ads'], cumulative: false,
        formula: 'ad spend (B2C) ÷ leads sent' }),
      row('leads_replacement', 'Replacement leads', 'number', 'lower', { needs: ['hsLeads'],
        formula: 'count of leads with Lead Cost = Replacement' }),
      row('leads_free', 'Free leads', 'number', 'lower', { needs: ['hsLeads'],
        formula: 'count of leads with Lead Cost = Free' }),
      row('leads_prepay', 'Prepay leads', 'number', 'none', { needs: ['hsLeads'],
        formula: 'count of leads with Lead Cost = Prepay' }),
      row('leads_unbilled', 'Unbilled / blank leads', 'number', 'lower', { needs: ['hsLeads'],
        formula: 'count of leads with Lead Cost = Unbilled or blank (excluding PROS)' }),
      row('replacement_rate', 'Replacement rate', 'percent', 'lower', { needs: ['hsLeads'], cumulative: false,
        formula: 'replacement leads ÷ (billed + replacement leads)' }),
      row('fb_leads', 'Facebook-reported leads', 'number', 'none', { needs: ['ads'],
        formula: 'Σ actions_lead of hs_b2c campaigns (Meta\'s count; reconciliation only)' }),
      row('clicks', 'Clicks', 'number', 'none', { needs: ['ads'], formula: 'Σ clicks of hs_b2c campaigns' }),
      row('impressions', 'Impressions', 'number', 'none', { needs: ['ads'], formula: 'Σ impressions of hs_b2c campaigns' }),
      row('ctr', 'CTR', 'percent', 'higher', { needs: ['ads'], cumulative: false, formula: 'clicks ÷ impressions' }),
      row('cpc', 'CPC', 'currency', 'lower', { needs: ['ads'], cumulative: false, formula: 'spend ÷ clicks' }),
      row('cpm', 'CPM', 'currency', 'lower', { needs: ['ads'], cumulative: false, formula: 'spend ÷ impressions × 1000' }),
      row('cvr', 'Click to billed lead', 'percent', 'higher', { needs: ['hsLeads', 'ads'], cumulative: false,
        formula: 'billed leads ÷ clicks' }),
    ],
  },
  {
    id: 'sales',
    title: 'Sales — Closers',
    subtitle: 'Closer EOD reports plus the Prospect table. Client-acquisition ad spend gives cost per close.',
    rows: [
      row('closes', 'Closes', 'number', 'higher', { needs: ['closerEod'], emphasis: 'primary',
        formula: 'Σ Closer EOD "Closes"' }),
      row('close_rate', 'Close rate (closes ÷ offers)', 'percent', 'higher', { needs: ['closerEod'], cumulative: false,
        formula: 'Σ closes ÷ Σ offers given' }),
      row('calls_attempted', 'Calls attempted', 'number', 'higher', { needs: ['closerEod'],
        formula: 'Σ Closer EOD "Calls Attempted"' }),
      row('calls_connected', 'Calls connected', 'number', 'higher', { needs: ['closerEod'], emphasis: 'primary',
        formula: 'Σ Closer EOD "Calls Connected"' }),
      row('contact_rate', 'Connect rate', 'percent', 'higher', { needs: ['closerEod'], cumulative: false,
        formula: 'Σ connected ÷ Σ attempted' }),
      row('offers', 'Offers given', 'number', 'higher', { needs: ['closerEod'],
        formula: 'Σ Closer EOD "Offers Given"' }),
      row('offer_rate', 'Offer rate', 'percent', 'higher', { needs: ['closerEod'], cumulative: false,
        formula: 'Σ offers ÷ Σ connected' }),
      row('new_prospects', 'New prospects', 'number', 'higher', { needs: ['prospects'],
        formula: 'count of Prospect records created in range (local date of Created At)' }),
      row('booked_calls', 'Calls booked', 'number', 'higher', { needs: ['prospects'], emphasis: 'primary',
        formula: 'count of prospects whose Appointment Date falls in range' }),
      row('book_rate', 'Prospect to booked', 'percent', 'higher', { needs: ['prospects'], cumulative: false,
        formula: 'prospects created in range that have any Appointment Date ÷ new prospects' }),
      row('prospect_contact_rate', 'Prospects contacted', 'percent', 'higher', { needs: ['prospects'], cumulative: false,
        formula: 'prospects created in range whose Status is not Hotlist / Follow Up ÷ new prospects' }),
      row('speed_to_lead', 'Speed to lead (avg)', 'seconds', 'lower', { needs: ['prospects'], cumulative: false,
        formula: 'mean "Speed to Lead (sec)" over prospects created in range that were called' }),
      row('hs_b2b_spend', 'Client-acquisition ad spend', 'currency', 'lower', { needs: ['ads'],
        formula: 'Σ spend of hs_b2b campaigns' }),
      row('hs_b2b_leads', 'Client-acquisition FB leads', 'number', 'higher', { needs: ['ads'],
        formula: 'Σ actions_lead of hs_b2b campaigns' }),
      row('hs_b2b_cpl', 'Cost per acquisition lead', 'currency', 'lower', { needs: ['ads'], cumulative: false,
        formula: 'hs_b2b spend ÷ hs_b2b FB leads' }),
      row('cost_per_close', 'Cost per close', 'currency', 'lower', { needs: ['ads', 'closerEod'], cumulative: false,
        formula: 'hs_b2b spend ÷ closes' }),
      row('eods_submitted', 'EOD reports submitted', 'number', 'higher', { needs: ['closerEod'],
        formula: 'count of Closer EOD rows dated in range' }),
    ],
  },
  {
    id: 'csm',
    title: 'CSM — Client health',
    subtitle: 'Who is getting leads, who is not, and how much of the flow is free or replaced.',
    rows: [
      row('clients_active', 'Active clients', 'number', 'higher', { needs: ['hsLeads', 'ads'], cumulative: false, emphasis: 'primary',
        formula: 'distinct clients with ad spend > 0 or ≥ 1 lead in range' }),
      row('clients_new', 'New clients', 'number', 'higher', { needs: ['clients'],
        formula: 'Clients table records created in range' }),
      row('clients_at_risk', 'At risk (spend, no leads 3d)', 'number', 'lower', { needs: ['hsLeads', 'ads'], cumulative: false, emphasis: 'primary',
        formula: 'clients with spend > 0 but 0 leads in the 3 days ending at the range end' }),
      row('clients_stalled', 'Stalled (no leads 7d)', 'number', 'lower', { needs: ['hsLeads', 'ads'], cumulative: false,
        formula: 'active clients with 0 leads in the 7 days ending at the range end' }),
      row('clients_paused', 'Paused clients', 'number', 'none', { needs: ['retainers'], cumulative: false,
        formula: 'clients flagged paused in lib/clients.js' }),
      row('leads_per_client_day', 'Leads per active client per day', 'decimal', 'higher', { needs: ['hsLeads', 'ads'], cumulative: false,
        formula: 'leads sent ÷ active clients ÷ days in range' }),
      row('replacement_rate', 'Replacement rate', 'percent', 'lower', { needs: ['hsLeads'], cumulative: false,
        formula: 'replacement leads ÷ (billed + replacement leads)' }),
      row('free_rate', 'Free lead rate', 'percent', 'lower', { needs: ['hsLeads'], cumulative: false,
        formula: 'free leads ÷ (billed + free + replacement leads)' }),
      row('avg_billed_price', 'Average billed price', 'currency', 'higher', { needs: ['hsLeads'], cumulative: false,
        formula: 'Σ Lead Cost of billed leads ÷ billed leads (retainers excluded)' }),
    ],
  },
  {
    id: 'tax_b2b',
    title: 'Tax — B2B ads + funnel',
    subtitle: 'Tax B2B campaigns from the ad account, joined to the B2B CRM when it is connected.',
    rows: [
      row('tax_spend', 'Ad spend', 'currency', 'lower', { needs: ['ads'], emphasis: 'primary',
        formula: 'Σ spend of tax_b2b campaigns' }),
      row('tax_fb_leads', 'Facebook-reported leads', 'number', 'higher', { needs: ['ads'],
        formula: 'Σ actions_lead of tax_b2b campaigns' }),
      row('tax_cpl_fb', 'Cost per FB lead', 'currency', 'lower', { needs: ['ads'], cumulative: false,
        formula: 'tax spend ÷ FB leads' }),
      row('tax_ctr', 'CTR', 'percent', 'higher', { needs: ['ads'], cumulative: false, formula: 'clicks ÷ impressions' }),
      row('tax_cpc', 'CPC', 'currency', 'lower', { needs: ['ads'], cumulative: false, formula: 'spend ÷ clicks' }),
      row('tax_cpm', 'CPM', 'currency', 'lower', { needs: ['ads'], cumulative: false, formula: 'spend ÷ impressions × 1000' }),
      row('b2b_leads', 'CRM leads', 'number', 'higher', { needs: ['b2b'], emphasis: 'primary',
        formula: 'Prospects with Date Added in range' }),
      row('b2b_cpl', 'Cost per CRM lead', 'currency', 'lower', { needs: ['ads', 'b2b'], cumulative: false,
        formula: 'tax spend ÷ CRM leads' }),
      row('b2b_booked', 'Booked', 'number', 'higher', { needs: ['b2b'],
        formula: 'CRM leads (by Date Added) that ever reached Booked/Confirmed/Showed/Won/No Show or have an appointment' }),
      row('b2b_cpb', 'Cost per booking', 'currency', 'lower', { needs: ['ads', 'b2b'], cumulative: false,
        formula: 'tax spend ÷ booked' }),
      row('b2b_shows', 'Shows', 'number', 'higher', { needs: ['b2b'],
        formula: 'CRM leads that showed (Stage Showed/Won, Status showed, or closed)' }),
      row('b2b_closes', 'Closes', 'number', 'higher', { needs: ['b2b'], emphasis: 'primary',
        formula: 'CRM leads with Stage Won, a won Status, or a linked Client' }),
      row('b2b_cpa', 'Cost per acquisition', 'currency', 'lower', { needs: ['ads', 'b2b'], cumulative: false,
        formula: 'tax spend ÷ closes' }),
      row('b2b_cash', 'Cash up front (CRM)', 'currency', 'higher', { needs: ['b2b'],
        formula: 'Σ Clients "Paid Up Front" of closed leads, cohorted to the lead\'s Date Added' }),
      row('b2b_roas', 'FE cash ROAS', 'ratio', 'higher', { needs: ['ads', 'b2b'], cumulative: false,
        formula: 'cash up front ÷ tax spend' }),
      row('b2b_lead_to_book', 'Lead to booking', 'percent', 'higher', { needs: ['b2b'], cumulative: false,
        formula: 'booked ÷ CRM leads' }),
      row('b2b_show_rate', 'Show rate', 'percent', 'higher', { needs: ['b2b'], cumulative: false,
        formula: 'shows ÷ booked' }),
      row('b2b_close_rate', 'Close rate', 'percent', 'higher', { needs: ['b2b'], cumulative: false,
        formula: 'closes ÷ shows' }),
    ],
  },
];

export const SECTION_BY_ID = Object.fromEntries(SECTIONS.map(s => [s.id, s]));

/** Every distinct row id across sections (some ids repeat on purpose, e.g. replacement_rate). */
export const ALL_ROW_IDS = Array.from(new Set(SECTIONS.flatMap(s => s.rows.map(r => r.id))));

export const ROW_BY_ID = {};
for (const s of SECTIONS) for (const r of s.rows) if (!ROW_BY_ID[r.id]) ROW_BY_ID[r.id] = r;

/* Pace-to-target bands. pace = actual ÷ expected, phrased so that > 1 is
   always good (inverted for lower-is-better rows). */
export const STATUS = {
  well_ahead: { label: 'Well ahead', tone: 'good',     min: 1.25 },
  ahead:      { label: 'Ahead',      tone: 'good',     min: 1.10 },
  on_track:   { label: 'On track',   tone: 'good',     min: 0.95 },
  watch:      { label: 'Watch',      tone: 'warning',  min: 0.85 },
  behind:     { label: 'Behind',     tone: 'serious',  min: 0.70 },
  critical:   { label: 'Critical',   tone: 'critical', min: -Infinity },
  set_target: { label: 'Set target', tone: 'neutral' },
  no_data:    { label: 'No data',    tone: 'neutral' },
  partial:    { label: 'Partial',    tone: 'neutral' },
};

export function statusForPace(pace) {
  if (pace == null || !Number.isFinite(pace)) return 'no_data';
  for (const key of ['well_ahead', 'ahead', 'on_track', 'watch', 'behind', 'critical']) {
    if (pace >= STATUS[key].min) return key;
  }
  return 'critical';
}

/** Cost categories accepted in the Dashboard Costs table, mapped to CEO rows. */
export const COST_CATEGORIES = {
  'Payroll': 'payroll',
  'Messaging': 'messaging_cost',
  'Affiliates': 'affiliates',
  'Software': 'software_cost',
  'Personal projects': 'personal_projects',
  'Other': 'other_costs',
};

export const BUSINESS_COST_ROWS = ['processor_fees', 'messaging_cost', 'affiliates', 'software_cost', 'other_costs'];
export const OWNER_COST_ROWS = ['payroll', 'personal_projects'];
