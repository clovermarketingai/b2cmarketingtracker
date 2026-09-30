import React from 'react';

const APPS = [
  { key: 'hq', href: 'https://hq.clovermarketing.ai', label: 'Command Center' },
  { key: 'closing', href: 'https://closing.clovermarketing.ai', label: 'Closing Tracker' },
  { key: 'b2c', href: 'https://b2c.clovermarketing.ai/', label: 'Command Center' },
];

const CSS = `
.cbar{position:sticky;top:0;z-index:30;box-sizing:border-box;display:flex;align-items:center;gap:4px;height:48px;padding:0 16px;background:#fff;border-bottom:1px solid #ececf0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,system-ui,sans-serif;font-size:13px;color:#141518;max-width:100%;overflow:hidden}
.cbar *{box-sizing:border-box}
.cbar-brand{display:flex;align-items:center;height:48px;font-weight:700;font-size:15px;letter-spacing:-0.01em;white-space:nowrap;margin-right:12px;gap:5px}
.cbar-brand small{font-weight:500;font-size:12px;color:#8b8f99}
.cbar-links{display:flex;align-items:center;gap:4px;min-width:0}
.cbar-links a{display:inline-flex;align-items:center;height:40px;padding:0 12px;color:#8b8f99;text-decoration:none;white-space:nowrap;border-bottom:2px solid transparent;border-radius:0;transition:color .12s}
.cbar-links a:hover{color:#141518}
.cbar-links a.on{color:#5b5bd6;font-weight:600;border-bottom-color:#5b5bd6}
.cbar-out{margin-left:auto;height:30px;padding:0 10px;border:1px solid #e2e3e8;border-radius:8px;background:#fff;color:#8b8f99;font:inherit;font-size:13px;line-height:1;cursor:pointer;white-space:nowrap;-webkit-appearance:none;appearance:none}
.cbar-out:hover{color:#141518}
@media (max-width:719.98px){
  .cbar{height:auto;flex-wrap:wrap;padding:0}
  .cbar-brand{flex:1 1 auto;margin:0;padding-left:16px}
  .cbar-out{margin-right:16px}
  .cbar-links{order:3;flex:0 0 100%;width:100%;height:40px;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;flex-wrap:nowrap;padding:0 12px;scrollbar-width:none;-ms-overflow-style:none}
  .cbar-links::-webkit-scrollbar{display:none}
  .cbar-links a{flex:0 0 auto}
}
`;

export default function CloverBar({ currentApp = 'closing' }) {
  const signOut = async () => {
    try {
      await fetch('/api/login', { method: 'DELETE', credentials: 'same-origin' });
    } catch {
      // ignore; still send them to the login screen
    }
    window.location.href = '/login';
  };

  return (
    <header className="cbar" data-app={currentApp}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="cbar-brand">Clover <small>Marketing</small></div>
      <nav className="cbar-links">
        {APPS.map((a) => (
          <a
            key={a.key}
            href={a.href}
            data-app={a.key}
            className={a.key === currentApp ? 'on' : undefined}
          >
            {a.label}
          </a>
        ))}
      </nav>
      <button type="button" className="cbar-out" onClick={signOut}>Sign out</button>
    </header>
  );
}
