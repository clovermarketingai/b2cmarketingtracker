// Client roster and per-client revenue rules. SERVER-ONLY: import this from
// API routes only. It must never be imported by anything under pages/ (other
// than pages/api/*), because page code is compiled into public JS chunks that
// an anonymous visitor can fetch without a session cookie.
//
// Keys are the Windsor campaign client names ("(Owner) Business").
//   short      - label shown in the table / CSV
//   airtable   - primary name in the Airtable Clients table (for /api/leads)
//   rule       - how revenue is computed for one day of rows:
//                  { type: 'perLead', rate }                        leads * rate
//                  { type: 'weekly',  perWeek }                     (days / 7) * perWeek
//                  { type: 'tiered',  tier1Leads, tier1Rate, tier2Rate }
//                                                                   first tier1Leads lifetime leads at tier1Rate, rest at tier2Rate
//                  { type: 'none' }                                 0
//   paused     - true -> revenue is always 0
//   lifetimeTotal - lifetime billed leads so far (only needed for 'tiered')

export const CLIENTS = {
  "(Nico) PROS Tree & Landscape": {
    short: "Nico PROS",
    airtable: "PROS Tree & Landscape (Phoenix)",
    rule: { type: 'weekly', perWeek: 1000 },
  },
  "(Ed) Protree Services LLC": {
    short: "Ed Protree",
    airtable: "Protree Services LLC",
    rule: { type: 'perLead', rate: 85 },
  },
  "(Leonardo) HLI Tree Experts": {
    short: "Leonardo HLI",
    airtable: "HLI Tree Experts",
    rule: { type: 'perLead', rate: 80 },
  },
  "(Chris) Five Star Tree Service Long Island": {
    short: "Chris Five Star",
    airtable: "Five Star Tree Service Long Island",
    rule: { type: 'perLead', rate: 75 },
  },
  "(Mario) Arborcare Group": {
    short: "Mario Arborcare",
    airtable: "Arborcare group",
    rule: { type: 'perLead', rate: 65 },
  },
  "(Tomas) Green Leaves Tree Care Corp": {
    short: "Tomas Green Leaves",
    airtable: "Green Leaves Tree Care",
    rule: { type: 'perLead', rate: 75 },
  },
  "(Gerald) GBZ Tree LLC": {
    short: "Gerald GBZ",
    airtable: "GBZ Tree LLC",
    rule: { type: 'tiered', tier1Leads: 10, tier1Rate: 46, tier2Rate: 70 },
    lifetimeTotal: 12,
  },
  "(Edgar) Vema Tree Service": {
    short: "Edgar Vema",
    airtable: "Vema Tree Service",
    rule: { type: 'perLead', rate: 90 },
  },
  "(Cesar) Cesar Tree Service Inc": {
    short: "Cesar",
    airtable: "Cesar Tree Service Inc",
    rule: { type: 'none' },
    paused: true,
  },
};
