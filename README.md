# DAILY DYNASTY 🏆

**A real full-stack website** for a friend's daily puzzle competition: username/password accounts, seven games, historical scores, leaderboards, 2K-style ratings, game specialties, league percentiles, streaks, badges, profile images, and shareable player summaries. It has **no fake players or sample scores** in the actual app.

## Quick start (local)

Requires Python 3.12+.

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Open **http://127.0.0.1:8000** and register. To make a private friend-group league, set `DD_INVITE_CODE` in the environment before starting, then share the code privately. Everyone entering the **same hosted instance** sees the same scoreboard.

To run tests:

```bash
pip install pytest httpx
python -m pytest -q tests/
```

## What the ratings mean

**Overall league leaderboard:** For each game/date, players who submitted scores compete for placement points. With multiple submitters the top earns 100, the bottom 35, with linear points in between; ties get equal points. If only one player has submitted to a game/date, they earn 75. Scores for games you skip earn zero points. Overall standings sum placement points, rewarding both consistent participation and winning.

**Game leaderboards:** Sorted by each player's average raw result over the selected period. The lower the guess count, the better your Globle ranking; all six others rank higher first. The game units are Krillion pts (0–700), Plain meters (0–10,000), FactMap pts (0–5,000), Farflung kilometers (0–500), Perceptle pts (0–100), Globle guesses (1–200) and Wonderhop pts (0–2,800). For Wonderhop, optional Sky/Abyss/Past/Future mode breakdowns each have max 700 and must sum to the total.

**2K-style player attributes and percentiles:** Game percentile is calculated from the distribution of the current group's players' average scores in that period (ties are split). Overall OVR is the average of game-specific 65–99 ratings. If only one person has logged a game, there is no meaningful percentile; the app uses a provisional game rating based on the game's score ceiling and explicitly says **Not ranked yet**. Percentiles are within your group, not game-worldwide. Ratings change as more friends compete.

**Dates:** Daily score dates and streaks use America/New_York time; all entries are manual and may be edited. Players can change their own usernames, upload pictures, and see other people's scores but cannot overwrite other players' results.

## Hosting it for your friends

This folder includes a `Dockerfile`, so you can deploy it to **Railway, Render with persistent storage, or any always-on Docker/VPS host**. Hosts differ on free tiers and storage pricing. The app requires a **persistent writable volume** for its SQLite DB **and avatars**; an ephemeral free service may wipe both when restarted or redeployed. Do not deploy it using a standard Vercel serverless function with local SQLite as-is.

Deployment checklist:

1. Push this directory to a GitHub repository (you can open/edit the code in Codex).
2. Create a web service with this repository using the included `Dockerfile`.
3. Attach a persistent volume mounted at **`/app/data`**.
4. Set `DD_DATA_DIR=/app/data`, `DD_SECURE_COOKIES=1`, `DD_PUBLIC_ORIGIN=https://YOUR-PUBLISHED-HOSTNAME`, and optionally `DD_INVITE_CODE` to a private shared code.
5. Confirm the website uses HTTPS; log in, enter a score, restart the service, and ensure the score remains saved.
6. Back up the volume regularly. For a public-facing site, consider adding email-based account recovery, audit logging and a mature gateway rate limiter.

Never publish real login credentials, invite codes, or your database into a GitHub repository. Shared game scores are self-reported; this site does not have an official API integration with the seven games.

## Open with Codex

The files are organized so Codex can understand them immediately. `AGENTS.md` tells Codex about the scoring algorithm, technologies, security requirements, and test commands. Import or clone this repository into your Codex environment and ask it to implement a feature, fix a bug, or improve the visual design. Use `python -m pytest -q tests/` to verify changes.

## Files

- `app/main.py` — FastAPI backend, SQLite schema, login sessions, APIs, avatar uploads
- `static/index.html` — screens and forms
- `static/styles.css` — dark sports-dashboard style and responsive UI
- `static/app.js` — league math, leaderboards, player cards, score entry
- `tests/test_end_to_end.py` — authentication, multi-user scores, validation, photo tests
- `AGENTS.md` — AI coding instructions
- `Dockerfile` — container deployment

## Fast path: GitHub → Railway (Codex-editable)

1. Create a **private** GitHub repository named `daily-dynasty`, and **do not initialize it** with README, license or .gitignore (this project has its own files).
2. Push the project contents to the repo root. This repository includes a GitHub Actions test workflow, `AGENTS.md` for Codex, and `railway.json` with Docker build and healthcheck settings.
3. In Railway, create a service from that GitHub repository. Add a **persistent volume at `/app/data`** before opening public signups. Set `DD_DATA_DIR=/app/data` and `DD_SECURE_COOKIES=1`; set `DD_INVITE_CODE` to an unguessable private value so strangers cannot join your league. If Railway provides a public domain, set `DD_PUBLIC_ORIGIN` to that exact HTTPS origin.
4. Deploy, use its generated public URL, register your own username and password, then share the URL and invite code with friends.

**Important:** Railway hosting/volumes may require a paid plan or billing details. This app does not claim to offer free persistent hosting. A web service WITHOUT a durable volume can silently lose all logins, scores, and pictures on restart/deploy. Never commit `data/`, `.env`, or a real private invite code. If your group needs an entirely free setup, consider adapting the backend to an external free-tier database/storage provider rather than trusting an ephemeral local SQLite file.

For a quick local Docker launch with a persisted volume: `docker compose up --build -d`, then visit http://localhost:8000. Locally, `DD_SECURE_COOKIES` defaults to `0` since HTTP isn't HTTPS; for a hosted HTTPS domain set it to `1`.
