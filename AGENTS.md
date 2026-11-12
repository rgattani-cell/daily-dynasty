# Instructions for Codex and other coding agents

This repository is **Daily Dynasty**, an authenticated daily puzzle scores league for a small friend group. Preserve the working user journey: username/password registration and login, 7-game scoring, daily league standings, 2K-style player cards with OVR and specialties, custom avatar uploads, and historical score edits. Prioritize real functionality over mock data.

## Stack
- Python 3.12+, FastAPI, SQLite, Pillow, Uvicorn
- Vanilla JavaScript + HTML/CSS frontend; no bundler
- API in `app/main.py`, frontend in `static/`.
- The SQLite database and avatar images live inside `DD_DATA_DIR`, a durable filesystem mount. NEVER commit those files. Dockerfile already exists.
- Frontend uses requests to `/api`, custom `X-Daily-Dynasty: 1` anti-CSRF header, secure HttpOnly cookie session.

## Core rules
- Game source-of-truth configuration: `GAMES` in `app/main.py`. All 7 games are external links; scores are MANUALLY entered. Do not fake score import.
- Higher is better for Krillion (0–700 pts), Plain (0–10,000 m), FactMap (0–5,000 pts), Farflung (0–500 km), Perceptle (0–100 pts), Wonderhop (0–2,800 pts). **Globle (1–200 guesses) is LOWER IS BETTER.**
- Wonderhop has optional all-four-mode (Sky, Abyss, Past, Future) breakdown, 0–700 each; if provided, total must match sum.
- Each user can update only their own daily result. One `(user_id, game, day)` per date. Show no invented entrants.
- Leaderboard overall points represent daily placement; `calc()` in `static/app.js`. Other game tabs are average scores with correct sort direction.
- 2K-style OVR ratings 65–99 are calculated per game; percentage labels are relative only to the league (never internet-wide). With a single player don't show a misleading percentile — use a provisional OVR.
- Account creation may be invite-code restricted via `DD_INVITE_CODE`. Passwords use scrypt; sessions are random tokens whose SHA-256 hashes are persisted in DB.
- Avatar uploads under 2MB are decoded, resized and converted to JPG. Do not store untrusted image content without sanitization.
- Preserve accessible navigation and all mobile layouts.

## Before changing code
Run tests: `python -m pytest -q tests/` after `pip install -r requirements.txt pytest httpx`.
Check JavaScript syntax: `node --check static/app.js` (Node is optional for running the app).
If adding client functionality, add a browser-level test if available. Do not weaken authorization boundaries.

## Next feature ideas
- Head-to-head rivalry cards and daily champion badge
- Weekly champions history and optional seasons
- Better admin/owner invite access and password reset/recovery
- More tests around tie ranks, timezone, and standings scoring
- Production migration from SQLite+local avatars to PostgreSQL+object storage if scaling beyond a small group
