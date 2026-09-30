import React from 'react';

/**
 * Collapsible list of every row's formula, grouped by section, so anyone can
 * verify how a number was produced.
 * @param {{ groups: Array<{ id: string, title: string, rows: Array<{ id: string, label: string, formula: string, unit: string, dir: string }> }> }} props
 */
export default function Formulas({ groups = [] }) {
  const nonEmpty = groups.filter(g => g && Array.isArray(g.rows) && g.rows.length);
  if (!nonEmpty.length) return null;
  return (
    <details className="cc-formulas" id="formulas">
      <summary>Formulas — how every number is computed</summary>
      <div className="cc-formulas-body">
        {nonEmpty.map(g => (
          <section key={g.id} aria-label={`${g.title} formulas`}>
            <h3>{g.title}</h3>
            <dl>
              {g.rows.map(r => (
                <React.Fragment key={`${g.id}:${r.id}`}>
                  <dt>{r.label} <code>{r.id}</code></dt>
                  <dd>
                    {r.formula || 'No formula recorded.'}
                    {' '}
                    <code>
                      {r.unit}{r.dir === 'lower' ? ' · lower is better' : r.dir === 'none' ? ' · context only' : ''}
                    </code>
                  </dd>
                </React.Fragment>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </details>
  );
}
