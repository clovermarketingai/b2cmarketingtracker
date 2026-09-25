# Clover B2C Tracker

Live Facebook ad performance + per-client P&L. Pulls from Windsor.ai on every page load.

## Deploy

1. Push these files to a new GitHub repo
2. Import the repo in Vercel
3. Add env var: `WINDSOR_API_KEY` = your Windsor API key
4. Deploy

## To update later

Edit `pages/index.js` (UI) or `pages/api/windsor.js` (data fetch) in GitHub web editor.
Vercel auto-deploys on push.
