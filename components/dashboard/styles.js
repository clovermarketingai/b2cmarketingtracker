// The Command Center stylesheet. One string, injected once by pages/index.js.
// Light theme only; tokens live at the top so the palette can be changed in
// one place. The reserved status colours (good / warning / serious / critical)
// are never used for anything except status.

export const CSS = `
:root{
  --cc-page:#f4f5f7;--cc-card:#fff;--cc-line:#e5e7eb;--cc-ink:#141518;--cc-muted:#6b7280;
  --cc-dark:#0f172a;--cc-primary-wash:#e8f5ec;--cc-accent:#5b5bd6;
  --cc-good:#0ca30c;--cc-warning:#fab219;--cc-serious:#ec835a;--cc-critical:#d03b3b;--cc-neutral:#6b7280;
}
.cc{background:var(--cc-page);color:var(--cc-ink);font-family:system-ui,-apple-system,"Segoe UI",Inter,sans-serif;font-size:14px;line-height:1.45;min-height:100vh;-webkit-font-smoothing:antialiased;overflow-x:clip}
.cc *{box-sizing:border-box}
.cc a{color:var(--cc-accent)}
.cc button{font:inherit}
.cc-wrap{max-width:1600px;margin:0 auto;padding:0 16px 48px}

/* top bar */
.cc-top{position:sticky;top:48px;z-index:20;background:var(--cc-card);border-bottom:1px solid var(--cc-line)}
.cc-top-in{max-width:1600px;margin:0 auto;padding:10px 16px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.cc-title{font-size:18px;font-weight:700;letter-spacing:-0.01em;line-height:1.2}
.cc-sub{color:var(--cc-muted);font-size:12.5px;margin-top:2px}
.cc-top-right{margin-left:auto;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.cc-asof{font-size:12.5px;color:var(--cc-muted);white-space:nowrap}
.cc-asof b{color:var(--cc-ink);font-weight:600}
.cc-nav{display:flex;gap:2px;flex-wrap:wrap}
.cc-nav a{font-size:13px;text-decoration:none;color:var(--cc-muted);padding:6px 8px;border-radius:6px}
.cc-nav a:hover{color:var(--cc-ink);background:var(--cc-page)}
.cc-nav a.on{color:var(--cc-accent);font-weight:600}
.cc-btn{height:32px;padding:0 12px;border:1px solid var(--cc-line);border-radius:8px;background:var(--cc-card);color:var(--cc-ink);font-size:13px;font-weight:500;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
.cc-btn:hover{border-color:#c9ccd3}
.cc-btn:disabled{opacity:.6;cursor:default}
.cc-btn-primary{background:var(--cc-dark);color:#fff;border-color:var(--cc-dark)}
.cc-btn-primary:hover{border-color:var(--cc-dark);background:#1e293b}
@media (max-width:719.98px){.cc-top{position:static}}

/* range chips */
.cc-chips{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:14px 0 4px}
.cc-chips-label{font-size:12px;color:var(--cc-muted);margin-right:4px;text-transform:uppercase;letter-spacing:.04em;font-weight:600}
.cc-chip{height:30px;padding:0 12px;border-radius:999px;border:1px solid var(--cc-line);background:var(--cc-card);color:var(--cc-ink);font-size:13px;cursor:pointer;white-space:nowrap}
.cc-chip:hover{border-color:#c9ccd3}
.cc-chip[aria-pressed="true"]{background:var(--cc-dark);border-color:var(--cc-dark);color:#fff;font-weight:600}
.cc-chip-dates{font-size:12px;color:var(--cc-muted);margin-left:4px}

/* blocks */
.cc-block{margin-top:18px;background:var(--cc-card);border:1px solid var(--cc-line);border-radius:12px;overflow:hidden}
.cc-head{background:var(--cc-dark);color:#fff;padding:12px 16px;display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.cc-head h2{margin:0;font-size:14px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
.cc-head p{margin:0;font-size:12.5px;color:#cbd5e1;flex:1 1 320px}
.cc-head-tools{margin-left:auto;display:flex;gap:8px;align-items:center}
.cc-head .cc-btn{height:28px;background:transparent;color:#fff;border-color:#334155}
.cc-head .cc-btn:hover{background:#1e293b}
.cc-body{padding:12px 16px 16px}

/* tables */
.cc-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%}
.cc-tbl{border-collapse:separate;border-spacing:0;width:100%;min-width:720px;font-size:13px;font-variant-numeric:tabular-nums}
.cc-tbl th,.cc-tbl td{padding:7px 10px;border-bottom:1px solid var(--cc-line);text-align:right;white-space:nowrap;vertical-align:middle;background:var(--cc-card)}
.cc-tbl th{font-size:11.5px;font-weight:600;color:var(--cc-muted);text-transform:uppercase;letter-spacing:.04em;background:#f9fafb;border-bottom:1px solid #d9dce2}
.cc-tbl th:first-child,.cc-tbl td:first-child{text-align:left;position:sticky;left:0;z-index:1;border-right:1px solid var(--cc-line);min-width:180px;max-width:260px;white-space:normal}
.cc-tbl tbody tr:hover td{background:#fafbfc}
.cc-tbl tr.cc-primary td{font-weight:700;background:var(--cc-primary-wash)}
.cc-tbl tr.cc-primary:hover td{background:#dff0e4}
.cc-tbl tr.cc-unavail td{color:var(--cc-muted);font-weight:400}
.cc-tbl td.cc-sel{background:#f3f4ff}
.cc-tbl tr.cc-primary td.cc-sel{background:#d8ecdd}
.cc-tbl th.cc-sel{color:var(--cc-accent)}
.cc-tbl th.cc-sortable{cursor:pointer;user-select:none}
.cc-tbl th.cc-sortable:hover{color:var(--cc-ink)}
.cc-tbl th .cc-sort{font-size:9px;margin-left:3px;opacity:.7}
.cc-tbl th .cc-hint{display:block;font-size:10px;font-weight:500;letter-spacing:0;text-transform:none;color:var(--cc-muted)}
.cc-metric{display:flex;align-items:center;gap:8px;justify-content:space-between}
.cc-metric-label{flex:1 1 auto}
.cc-metric-note{display:block;font-size:11px;color:var(--cc-muted);font-weight:400}
.cc-dim{color:var(--cc-muted)}
.cc-num{font-variant-numeric:tabular-nums}
.cc-delta{font-weight:600}
.cc-delta.good{color:var(--cc-good)}
.cc-delta.bad{color:var(--cc-critical)}
.cc-delta.neutral{color:var(--cc-muted);font-weight:400}
.cc-target-in{width:96px;height:26px;border:1px solid var(--cc-line);border-radius:6px;padding:0 6px;font:inherit;font-size:12.5px;text-align:right}
.cc-empty{padding:18px 4px;color:var(--cc-muted);font-size:13px}
.cc-tbl td.cc-name{font-weight:600}
.cc-tbl td.cc-name small{display:block;font-weight:400;color:var(--cc-muted);font-size:11px}
.cc-tbl td.cc-text{text-align:left}
.cc-tbl th.cc-text{text-align:left}

/* pills */
.cc-pill{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:999px;font-size:11.5px;font-weight:600;white-space:nowrap;line-height:1;border:1px solid transparent}
.cc-pill .cc-glyph{font-size:10px;line-height:1}
.cc-pill.good{background:#e6f6e6;color:#0a7a0a;border-color:#bfe7bf}
.cc-pill.warning{background:#fff4d6;color:#8a5a00;border-color:#f7dfa0}
.cc-pill.serious{background:#fdeae2;color:#9c3f18;border-color:#f6c8b6}
.cc-pill.critical{background:#fbe3e3;color:#a12626;border-color:#f2bcbc}
.cc-pill.neutral{background:#f3f4f6;color:#4b5563;border-color:#e5e7eb}
.cc-pill.info{background:#eceefc;color:#3f3fb0;border-color:#d4d6f7}
.cc-dot{display:inline-block;width:8px;height:8px;border-radius:50%;flex:none}
.cc-dot.good{background:var(--cc-good)}.cc-dot.warning{background:var(--cc-warning)}.cc-dot.serious{background:var(--cc-serious)}.cc-dot.critical{background:var(--cc-critical)}.cc-dot.neutral{background:var(--cc-neutral)}.cc-dot.info{background:var(--cc-accent)}

/* sparkline */
.cc-spark{display:inline-block;vertical-align:middle;flex:none}
.cc-spark path{fill:none;stroke:#3f4a5a;stroke-width:1.4;stroke-linejoin:round;stroke-linecap:round}
.cc-spark .cc-spark-fill{fill:#3f4a5a;fill-opacity:.08;stroke:none}
.cc-spark circle{fill:#3f4a5a}

/* banners */
.cc-banner{margin-top:14px;border-radius:10px;padding:10px 14px;font-size:13px;border:1px solid}
.cc-banner.warn{background:#fff8e6;border-color:#f7dfa0;color:#7a4f00}
.cc-banner.err{background:#fbe3e3;border-color:#f2bcbc;color:#8f1d1d}
.cc-banner.info{background:#eef2ff;border-color:#d4d6f7;color:#2f2f8f}
.cc-banner ul{margin:6px 0 0;padding-left:18px}
.cc-banner li{margin:2px 0}

/* unlock card */
.cc-unlock{padding:20px 16px;display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}
.cc-unlock-copy{flex:1 1 320px}
.cc-unlock-copy h3{margin:0 0 4px;font-size:15px}
.cc-unlock-copy p{margin:0;color:var(--cc-muted);font-size:13px}
.cc-unlock form{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.cc-unlock input{height:34px;padding:0 10px;border:1px solid var(--cc-line);border-radius:8px;font:inherit;font-size:14px;min-width:200px}
.cc-unlock input:focus{outline:none;border-color:var(--cc-accent)}
.cc-unlock .cc-err{flex-basis:100%;color:var(--cc-critical);font-size:12.5px}

/* sources */
.cc-sources{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;padding:12px 16px 16px}
.cc-src{border:1px solid var(--cc-line);border-radius:10px;padding:10px 12px;background:#fbfbfc;min-width:0}
.cc-src-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
.cc-src-label{font-weight:600;font-size:13px}
.cc-src-meta{margin-top:6px;font-size:12px;color:var(--cc-muted);display:flex;gap:10px;flex-wrap:wrap}
.cc-src-msg{margin-top:6px;font-size:12px;color:var(--cc-ink);white-space:pre-wrap;word-break:break-word}
.cc-src-msg.err{color:var(--cc-critical)}
.cc-src-msg code{font-size:11.5px;background:#eef0f3;padding:1px 4px;border-radius:4px}

/* formulas */
.cc-formulas{margin-top:18px;background:var(--cc-card);border:1px solid var(--cc-line);border-radius:12px}
.cc-formulas summary{cursor:pointer;padding:12px 16px;font-weight:600;font-size:14px;list-style:none;display:flex;align-items:center;gap:8px}
.cc-formulas summary::-webkit-details-marker{display:none}
.cc-formulas summary::before{content:"\\25B8";font-size:12px;color:var(--cc-muted)}
.cc-formulas[open] summary::before{content:"\\25BE"}
.cc-formulas-body{padding:0 16px 16px}
.cc-formulas h3{font-size:12.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--cc-muted);margin:14px 0 6px}
.cc-formulas dl{margin:0;display:grid;grid-template-columns:minmax(160px,260px) 1fr;gap:4px 14px;font-size:13px}
.cc-formulas dt{font-weight:600}
.cc-formulas dd{margin:0;color:#374151}
.cc-formulas code{font-size:11.5px;color:var(--cc-muted)}
@media (max-width:640px){.cc-formulas dl{grid-template-columns:1fr}.cc-formulas dd{margin-bottom:8px}}

.cc-foot{margin-top:24px;color:var(--cc-muted);font-size:12px;display:flex;gap:14px;flex-wrap:wrap}
.cc-skel{height:180px;display:flex;align-items:center;justify-content:center;color:var(--cc-muted)}
.cc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;
