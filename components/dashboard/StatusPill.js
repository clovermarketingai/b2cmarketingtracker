import React from 'react';

// Each tone carries a glyph so a status is never colour alone.
const GLYPH = {
  good: '✓',      // check
  warning: '!',
  serious: '▲',   // triangle
  critical: '✕',  // cross
  neutral: '•',   // bullet
  info: '●',      // disc
};

const TONES = new Set(Object.keys(GLYPH));

/** Map a source status string to a pill tone. */
export function sourceTone(status) {
  switch (status) {
    case 'ok': return 'good';
    case 'stale': return 'warning';
    case 'error': return 'critical';
    case 'unconfigured': return 'neutral';
    case 'demo': return 'info';
    default: return 'neutral';
  }
}

/** Map a client health string to { label, tone }. */
export function healthPill(health) {
  switch (health) {
    case 'healthy': return { label: 'Healthy', tone: 'good' };
    case 'stalled': return { label: 'Stalled', tone: 'warning' };
    case 'at_risk': return { label: 'At risk', tone: 'serious' };
    case 'inactive': return { label: 'Inactive', tone: 'neutral' };
    case 'paused': return { label: 'Paused', tone: 'neutral' };
    default: return { label: health || 'Unknown', tone: 'neutral' };
  }
}

/**
 * Small status pill: glyph + text, coloured by tone.
 * @param {{ tone: string, label: string, title?: string }} props
 */
export default function StatusPill({ tone = 'neutral', label, title }) {
  const t = TONES.has(tone) ? tone : 'neutral';
  return (
    <span className={`cc-pill ${t}`} title={title || undefined}>
      <span className="cc-glyph" aria-hidden="true">{GLYPH[t]}</span>
      <span>{label}</span>
    </span>
  );
}
