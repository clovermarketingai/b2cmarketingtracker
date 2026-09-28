import React, { useState } from 'react';

const APP_NAME = 'B2C Tracker';

const CSS = `
.clogin{min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px 16px;box-sizing:border-box;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,system-ui,sans-serif;color:#141518;-webkit-font-smoothing:antialiased}
.clogin *{box-sizing:border-box}
.clogin-card{width:100%;max-width:352px;background:#fff;border:1px solid #ececf0;border-radius:16px;padding:32px}
.clogin-brand{font-weight:700;font-size:17px;line-height:1.2}
.clogin-sub{color:#8b8f99;font-size:11.5px;margin-top:3px}
.clogin-err{color:#dc2626;font-size:12.5px;margin-top:14px;line-height:1.4}
.clogin-input{display:block;width:100%;margin-top:18px;padding:11px 13px;font:inherit;font-size:16px;line-height:1.3;color:#141518;background:#fff;border:1px solid #e2e3e8;border-radius:9px;outline:none;-webkit-appearance:none;appearance:none}
.clogin-input:focus{border-color:#5b5bd6}
.clogin-trust{display:flex;align-items:center;gap:8px;margin-top:14px;font-size:13px;color:#4b4f59;cursor:pointer;user-select:none}
.clogin-trust input{width:16px;height:16px;margin:0;accent-color:#5b5bd6;cursor:pointer}
.clogin-btn{display:block;width:100%;height:40px;margin-top:16px;border:none;border-radius:9px;background:#5b5bd6;color:#fff;font:inherit;font-size:14px;font-weight:600;cursor:pointer;-webkit-appearance:none;appearance:none}
.clogin-btn:disabled{opacity:.7;cursor:default}
`;

// Where to land after sign-in when there is no usable ?next= param.
const HOME = '/daily';

// Only ever redirect to a same-origin path. The value is resolved with the URL
// parser and its origin re-checked, so tricks like "/\t/evil.com" (tab/newline
// stripped by the parser -> "//evil.com") or "/\\evil.com" cannot escape.
function safeNext() {
  if (typeof window === 'undefined') return HOME;
  const raw = new URLSearchParams(window.location.search).get('next') || '';
  if (!raw || !raw.startsWith('/') || /[\x00-\x20\x7f\\]/.test(raw)) return HOME;
  try {
    const u = new URL(raw, window.location.origin);
    if (u.origin !== window.location.origin) return HOME;
    if (u.pathname === '/login') return HOME;
    return u.pathname + u.search + u.hash;
  } catch {
    return HOME;
  }
}

export default function Login() {
  const [password, setPassword] = useState('');
  const [trust, setTrust] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ password, trust }),
      });
      let data = {};
      try { data = await r.json(); } catch { data = {}; }
      if (r.ok && data && data.ok) {
        window.location.href = safeNext();
        return;
      }
      setError((data && data.error) || `Sign in failed (${r.status}).`);
    } catch {
      setError('Network error. Please try again.');
    }
    setPending(false);
  };

  return (
    <div className="clogin">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <form className="clogin-card" onSubmit={submit} noValidate>
        <div className="clogin-brand">Clover</div>
        <div className="clogin-sub">{APP_NAME}</div>
        {error ? <div className="clogin-err" role="alert">{error}</div> : null}
        <input
          className="clogin-input"
          type="password"
          name="password"
          placeholder="Password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <label className="clogin-trust">
          <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
          Trust this browser for 100 days
        </label>
        <button className="clogin-btn" type="submit" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
