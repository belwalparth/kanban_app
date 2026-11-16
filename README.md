# Kanban app

A local project management MVP. Sign in with `user` / `password` to create, edit, delete, and move cards or rename columns. FastAPI serves the static Next.js UI and API from one container. Board changes currently reset on refresh or logout.

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

Open http://localhost:8000 after starting. Stop preserves the `kanban-data` volume mounted at `/data`; `DATABASE_PATH` is reserved for `/data/kanban.db` in the later database step.

The Windows commands permit the script for that process only; they do not change system execution policy.

No settings are required to start. Optionally set a long random `SESSION_SECRET` in root `.env` to keep sessions valid across container restarts; otherwise a new signing key is generated on startup. Sessions use an eight-hour HttpOnly cookie. Keep the future `OPENROUTER_API_KEY` in `.env`; it is excluded from images and not passed to the container yet.

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
