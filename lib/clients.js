// Client roster and per-client revenue rules. SERVER-ONLY: import this from
// API routes only. It must never be imported by anything under pages/ (other
// than pages/api/*), because page code is compiled into public JS chunks that
// an anonymous visitor can fetch without a session cookie.
//
// Where it is used:
//   - lib/dashboard/load.js retainersFromConfig() turns this map into the
//     `retainers` dataset the engine reads (weekly retainer revenue, paused
//     flag, the Windsor <-> Airtable name join for the per-client table).
//   - lib/dashboard/daily.js uses the same map to reconcile Facebook spend
//     with Airtable leads and billed revenue per client per day on /daily.
//   - The connectors join on these names: the Windsor connector resolves a
//     campaign's client from the longest key that prefixes the campaign name
//     (lib/dashboard/sources/windsor.js normaliseRows), and the Airtable Home
//     Service connector uses retainerClientNames() to treat every lead of an
//     active weekly-retainer client as billed at $0.
//
// Keys are the Windsor campaign client names ("(Owner) Business").
//   short      - label shown in the table / CSV
//   airtable   - primary name in the Airtable Clients table (the name leads are
//                joined on; see clientResolver in lib/dashboard/compute.js)
//   rule       - the commercial arrangement:
//                  { type: 'perLead', rate }        billed per lead. Revenue is taken from each
//                                                   lead's "Lead Cost" in Airtable; `rate` is only
//                                                   used to flag leads billed at a different price.
//                  { type: 'weekly',  perWeek, from?, to? }
//                                                   flat retainer: perWeek / 7 accrues every calendar
//                                                   day from `from` (default: first day of activity)
//                                                   through `to` (default: today). Every lead counts
//                                                   as billed at $0.
//                  { type: 'tiered',  tier1Leads, tier1Rate, tier2Rate }
//                                                   informational; the price actually billed is read
//                                                   from "Lead Cost" per lead.
//                  { type: 'none' }                 no revenue
//   paused     - true -> the retainer stops accruing and the client is listed as paused

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
