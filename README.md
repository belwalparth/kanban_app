# Kanban app

A local project management MVP. Sign in with `user` / `password` to manage cards and columns, or ask the board assistant to create, edit, and move cards. FastAPI serves the static Next.js UI and API from one container. Board changes persist in SQLite across refresh, logout, and container restarts.

Google sign-in is available when configured; see [Google setup](docs/GOOGLE_SIGN_IN.md) and [database migrations](docs/DATABASE_OPERATIONS.md). Compose enables local demo login by default; set `ALLOW_DEMO_LOGIN=false` when using Google. Demo login is disabled in preview/production.

Vercel preview setup and rollback steps are in [deployment instructions](docs/VERCEL_DEPLOYMENT.md). Cloud hosting uses PostgreSQL; local SQLite data stays in Docker.

## Getting started

Requires Docker with Compose (Docker Desktop on Windows/macOS), running Linux containers.

```powershell
# Windows
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stop.ps1
```

```sh
# macOS / Linux
sh scripts/start.sh
sh scripts/stop.sh
```

Open http://localhost:8000 after starting. Stop preserves the `kanban-data` volume at `/data`, containing `/data/kanban.db`. Column names save on Enter or blur; Escape cancels typing. Wait for the saved status before closing the page. [Manual checks](docs/PART7_VALIDATION.md) include persistence and revision conflicts.

The Windows commands permit the script for that process only; they do not change system execution policy.

No settings are required for the board. Optionally set a long random `SESSION_SECRET` in root `.env` to retain sessions across restarts; otherwise startup generates a key. Sessions use an eight-hour HttpOnly cookie. AI connectivity uses `OPENROUTER_API_KEY` from `.env`, passed only to the backend at runtime. Default model: `nvidia/nemotron-3.5-super-vl:free`; optionally override `OPENROUTER_MODEL` with another explicit `:free` model.

To check live AI connectivity after starting (one free-model arithmetic request):

```sh
docker compose exec -T app python -m app.check_ai
```

Expect `2+2 = 4; structured response validated.` To check chat and a combined board update against a disposable synthetic database:

```sh
docker compose exec -T app python -m app.check_chat
```

This makes two live requests and leaves your saved board untouched. In the browser, select **Board assistant** above the columns to open the popup; close it with Escape or its close button. All five columns fit across the desktop board, with wrapping columns on smaller screens. AI changes appear immediately and are saved. Drafts/history survive closing the popup and clear on reload or sign out. Failed requests retain the draft for explicit retry; conflicts load the latest board for review. See [Part 13 checks](docs/PART13_VALIDATION.md) and [chat API](docs/PART9_VALIDATION.md).

## Tests

```sh
docker build --target test -t kanban-app-test .
docker run --rm kanban-app-test
docker build --target frontend-test -t kanban-frontend-test .
docker run --rm kanban-frontend-test
```

With local Python 3.14 and `uv`: `cd backend` then `uv run --locked pytest -q`.

For frontend development with Node.js 24 or newer, keep Docker running at port 8000, then `cd frontend`, `npm ci`, `npm run dev`; open http://localhost:3000. The development server proxies `/api/*` to FastAPI. `npm run build` exports the site to `frontend/out`.

Browser tests require the app running at port 8000. From `frontend/`, run `npx playwright install chromium` once, then `npm run test:e2e`. To use an installed Google Chrome instead, set `$env:PLAYWRIGHT_CHANNEL = 'chrome'` in PowerShell before running the tests.

Most browser checks mock board/chat responses for isolation. The real persistence check creates and cleans up only its own temporary card; it does not reset your board. The live AI browser test is opt-in and requires a disposable app at port 8001; see the final checks document.
