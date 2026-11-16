# Kanban app

A local project management MVP. FastAPI serves the statically built Next.js Kanban board and `/api/health` from one container. Cards can be created, edited, deleted, and moved; column names are editable. Board changes currently reset on refresh.

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

No environment settings are required yet. Keep the future `OPENROUTER_API_KEY` in root `.env`; it is excluded from images and is not needed or passed to the container yet.

## Tests

```sh
docker build --target test -t kanban-app-test .
docker run --rm kanban-app-test
docker build --target frontend-test -t kanban-frontend-test .
docker run --rm kanban-frontend-test
```

With local Python 3.14 and `uv`: `cd backend` then `uv run --locked pytest -q`.

For frontend development with Node.js 24 or newer: `cd frontend`, `npm ci`, `npm run dev`; open http://localhost:3000. `npm run build` exports the site to `frontend/out`.

Browser tests require the app running at port 8000. From `frontend/`, run `npx playwright install chromium` once, then `npm run test:e2e`. To use an installed Google Chrome instead, set `$env:PLAYWRIGHT_CHANNEL = 'chrome'` in PowerShell before running the tests.
