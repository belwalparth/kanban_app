# Kanban App

A full-stack Kanban board for creating, editing, moving, and organizing cards across five workflow columns. The app combines a Next.js static UI with a FastAPI backend, persistent SQLite or PostgreSQL storage, Google and demo authentication, and an optional OpenRouter board assistant.

**Live deployment:** [https://kanban-app-seven-nu.vercel.app/](https://kanban-app-seven-nu.vercel.app/)  
**Repository:** [https://github.com/belwalparth/kanban_app](https://github.com/belwalparth/kanban_app)

Use the **Board** selector to switch boards, **New board** to create an empty board, and **Rename board** to change its name. Selection stays in the URL for refresh and Back/Forward. Each board keeps its own AI draft/conversation during the signed-in session; reload or sign-out clears conversations. Production uses schema 4; see [release checks and acceptance status](docs/PART21_VALIDATION.md).

Vercel setup is in [deployment instructions](docs/VERCEL_DEPLOYMENT.md); see [production verification](docs/PART15_VALIDATION.md) and [recovery steps](docs/PRODUCTION_OPERATIONS.md). Cloud hosting uses PostgreSQL; local SQLite data stays in Docker.

Owners can use **Share board**, beside **Rename board**, to invite Google users and copy their invitation links. Recipients sign in with the invited email and explicitly accept. Members edit cards, columns and use AI; owners manage invitations and membership. Saved changes load on refresh or returning focus when no draft/save is pending. Real three-account acceptance remains pending; see [sharing instructions](docs/GOOGLE_SIGN_IN.md#sharing-boards) and [hosted validation](docs/PART21_VALIDATION.md).

## Features

- Five default columns: Backlog, To Do, In Progress, Review, and Done
- Create, edit, move, and delete cards
- Rename columns with keyboard-friendly save and cancel behavior
- Persistent revisioned board state
- Google sign-in and local demo login
- Account-isolated boards and HttpOnly, Secure session cookies
- Board Assistant powered by OpenRouter
- Natural-language card creation, editing, and movement
- SQLite support for local Docker deployments
- PostgreSQL support for preview and production deployments
- Responsive desktop and mobile interface
- Origin validation, no-store private API responses, request limits, and bounded AI/provider timeouts
- Dockerized runtime, testing, and Vercel build paths

## Tech Stack

- **Frontend:** Next.js, React, TypeScript, CSS, Vitest, Testing Library, Playwright
- **Backend:** Python 3.14, FastAPI, Uvicorn, Pydantic
- **AI:** OpenRouter API
- **Databases:** SQLite for local use; PostgreSQL for cloud use
- **Deployment:** Vercel FastAPI functions, static Next.js export, Neon/PostgreSQL
- **Packaging:** Docker, Docker Compose, uv

## Project Structure

```text
backend/
  app/             FastAPI routes, authentication, board logic, AI integration
  tests/           Backend, database, authentication, chat, and deployment tests
  build_frontend.py
  vercel.json
frontend/
  app/             Next.js application
  components/      Kanban and authentication UI
  lib/             API and state utilities
  test/            Vitest unit/component tests
  e2e/             Playwright browser tests
 docs/             Setup, authentication, database, and deployment guides
```

## Deployment

The live Vercel deployment is:

**https://kanban-app-seven-nu.vercel.app/**

Vercel serves the Next.js static export and FastAPI API from the same origin. Cloud deployments require PostgreSQL, an explicit `APP_ENV`, a stable session secret, and Google OAuth configuration. The Vercel project should use `backend/` as its root directory and enable source files outside the root directory for the frontend build.

The deployment configuration is in [`backend/vercel.json`](backend/vercel.json) and [`backend/pyproject.toml`](backend/pyproject.toml). Complete setup and rollback instructions are documented in [`docs/VERCEL_DEPLOYMENT.md`](docs/VERCEL_DEPLOYMENT.md).

## Tests

Validation documented in the repository includes:

- Backend suite: **321 passed, 3 expected skips**
- Frontend component/helper suite: **88 passed**
- Playwright desktop/mobile suite: **62 passed, 6 expected skips**
- ESLint: passed
- TypeScript typecheck: passed
- Next.js static production build: passed
- Vercel build hook with Node 24 and Python 3.14: passed
- Separate live OpenRouter answer/update smoke check: passed against disposable synthetic data
- PostgreSQL and cloud-mode integration checks: passed against disposable storage
- Final Docker runtime health check: passed
- Local Google sign-in: real account consent completed and verified in the local database

The backend suite is run in Docker with:

```sh
docker build --target test -t kanban-app-test .
docker run --rm kanban-app-test
```

Frontend unit and static checks:

```sh
cd frontend
npm ci
npm run test:run
npm run lint
npm run typecheck
npm run build
```

Browser tests:

```sh
cd frontend
npx playwright install chromium
npm run test:e2e
```

## Run Locally with Docker

Docker Compose requires Docker Desktop or Docker Engine with Linux containers.

```sh
docker compose up --build --wait
```

Open <http://localhost:8000>. Stop the app while preserving data with:

```sh
docker compose down
```

Optional environment variables include `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, and `ALLOW_DEMO_LOGIN`. Demo login is enabled by default in local Compose mode.

Windows users can use:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stop.ps1
```

macOS/Linux users can use:

```sh
sh scripts/start.sh
sh scripts/stop.sh
```

## Local Backend Development

```sh
cd backend
uv sync --locked
uv run --locked pytest -q
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Python 3.14 and [`uv`](https://docs.astral.sh/uv/) are required by the backend configuration.

## Architecture and Security

- FastAPI mounts the API at `/api` and the static frontend at `/`
- Mutating requests validate Origin and reject oversized payloads
- Private API responses use `Cache-Control: no-store`
- Sessions use signed, HttpOnly cookies
- Cloud storage uses PostgreSQL rather than instance-local files
- Board writes are revisioned and ownership-protected
- AI operations preserve the saved board on provider, validation, timeout, or conflict failures
- Request and board-size limits prevent oversized writes

## Documentation

- [Google sign-in setup](docs/GOOGLE_SIGN_IN.md)
- [Database operations](docs/DATABASE_OPERATIONS.md)
- [Vercel deployment](docs/VERCEL_DEPLOYMENT.md)
- [Part 14 validation](docs/PART14_VALIDATION.md)
- [Implementation plan](docs/Plan.md)

## License

No license has been specified for this repository.
