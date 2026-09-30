import React, { useState } from 'react';

/**
 * Inline unlock for the CEO block. Posts the password to /api/ceo and asks
 * the page to refetch on success.
 * @param {{ configured: boolean|undefined, onUnlocked: () => void }} props
 */
export default function UnlockCard({ configured, onUnlocked }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const r = await fetch('/api/ceo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ password }),
      });
      let data = {};
      try { data = await r.json(); } catch { data = {}; }
      if (r.ok && (data.ok || data.unlocked)) {
        setPassword('');
        onUnlocked();
      } else if (r.status === 404) {
        setError('The /api/ceo route is not deployed yet.');
      } else {
        setError((data && data.error) || `Unlock failed (${r.status}).`);
      }
    } catch {
      setError('Network error. Please try again.');
    }
    setPending(false);
  };

  return (
    <div className="cc-unlock">
      <div className="cc-unlock-copy">
        <h3>CEO section is locked</h3>
        <p>
          {configured === false
            ? 'CEO_PASSWORD is not set on this deployment, so the CEO section cannot be unlocked here.'
            : 'Enter the CEO password to see cash collected, costs and profit. The unlock lasts 12 hours on this browser.'}
        </p>
      </div>
      <form onSubmit={submit} noValidate>
        <label className="cc-sr" htmlFor="cc-ceo-password">CEO password</label>
        <input
          id="cc-ceo-password"
          type="password"
          autoComplete="off"
          placeholder="CEO password"
          value={password}
          disabled={configured === false || pending}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" className="cc-btn cc-btn-primary" disabled={configured === false || pending || !password}>
          {pending ? 'Unlocking…' : 'Unlock'}
        </button>
        {error ? <div className="cc-err" role="alert">{error}</div> : null}
      </form>
    </div>
  );
}
