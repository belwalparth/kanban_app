# Vercel preview deployment (Part 14)

Use one Vercel FastAPI project, with `backend/` as Root Directory, to serve the Next.js static export and same-origin API. Local Docker/SQLite remains available and is independent of cloud storage. This procedure does not import local boards.

## Account setup

1. Install/connect the Vercel and Neon integrations to let the agent provision and verify resources, or perform the equivalent steps in those services' consoles. No hosting/database account access was confirmed during local preparation.
2. Choose the Vercel team and repository, and import it with framework **FastAPI** and Root Directory **backend**. Enable **Include source files outside of the Root Directory in the Build Step**. Select Node **24.x**, Python **3.14**, and Fluid compute. Leave Build Command at the default so `[tool.vercel.scripts] build` runs; do not set Output Directory to `frontend/out`. The project uses a 60-second function maximum from `backend/vercel.json`.
3. Pick a stable preview branch alias/custom hostname and a separate final production hostname. Use the preview alias as `APP_BASE_URL`; do not derive callbacks from each random deployment URL. Choose the function region near Neon in project settings before deployment. A stable branch alias needs a Git-connected project; production promotion remains Part 15.
4. Create separate, empty Neon preview and production projects/databases. Do not copy production data to preview. Record the selected regions and `SHOW max_connections` result. Use pooled TLS URLs (`-pooler`, `sslmode=require` or stricter) for runtime, direct URLs for migrations/backup, and a schema-owner role for migrations. Grant a restricted runtime role table SELECT/INSERT/UPDATE/DELETE and sequence usage; never grant runtime schema ownership.
5. Create Google Web application OAuth clients for preview and production, following [Google setup](AUTH_DEPLOYMENT.md#google-cloud-setup). Register `https://<stable-preview-host>/api/auth/google/callback` for preview and the equivalent production URL in its own client. Localhost registrations remain independent. Only request `openid email profile`.

The actual team/project IDs, repository linkage, hostnames, regions, account-specific Google clients, and Neon URLs must be confirmed before deploying. Placeholder hostnames are not registered callbacks. Vercel Deployment Protection can keep previews private; verify it permits the browser's Google return. Identity-only Google scopes do not make an app private through a test-user list alone.

## Environment settings

Ignored root `.env.preview` and `.env.production` staging files were prepared locally with independent random session secrets. They are templates until account-specific values are filled. Do not commit them, paste their contents into chat, include them in deployment source, or load both into one runtime. The local root `.env` remains for Docker and was not repurposed for cloud.

| Setting | Vercel Preview | Vercel Production |
| --- | --- | --- |
| `APP_ENV` | `preview` | `production` |
| `APP_BASE_URL` | Stable HTTPS preview origin | Final HTTPS production origin |
| `ALLOW_DEMO_LOGIN` | `false` | `false` |
| `SESSION_SECRET` | Independent preview signing secret | Independent production signing secret |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Preview Google client | Production Google client |
| `DATABASE_URL` | Preview pooled TLS URL | Production pooled TLS URL |
| `OPENROUTER_API_KEY` | Runtime chat key | Runtime chat key |
| `OPENROUTER_MODEL` | Verified explicit `:free` model | Verified explicit `:free` model |
| `UV_NO_DEV` | `1` | `1` |

Apply variables to their specific Vercel environment, preferably targeting only the intended preview branch. Mark server secrets sensitive in Vercel. Do not set `NEXT_PUBLIC_` secret variables, upload `DATABASE_MIGRATION_URL`, or set a cloud `DATABASE_PATH`. Vercel requires explicit preview/production mode and cannot silently start the local SQLite/demo path.

The separate **direct** `DATABASE_MIGRATION_URL` belongs only in the operator's environment. Keep it out of serving-function settings. A missing chat key leaves manual board/auth usable and causes a safe chat error; missing identity/storage configuration fails startup.

## Migration and build

Before the first deployment, set the direct preview migration URL securely in the operator environment. From `backend/`:

```sh
uv run --locked python -m app.manage_db migrate
```

The current source applies schema versions 1, 2, and 3 transactionally without demo seeding. Version 3 enables multiple named boards and was applied to production on 2026-11-22 after a backup/restore/migration rehearsal; see [Part 18 validation](PART18_VALIDATION.md). Older application releases reject schema 3; see [database operations](DATABASE_OPERATIONS.md) for compatibility. The build hook never runs migrations; do not add them to ordinary preview builds or function startup.

`backend/build_frontend.py` installs locked frontend dependencies, including build-time dev tools, builds the static export, and replaces only the generated `backend/app/static/` directory. It removes application credentials from the frontend subprocess environment. Vercel installs backend Python dependencies from `pyproject.toml`/`uv.lock`; `UV_NO_DEV=1` excludes the Python test group. `tool.vercel.entrypoint` resolves to `app.main:app`.

Local verification of the Vercel hook with Python 3.14, Node 24, and locked `uv` dependencies:

```sh
docker build --target vercel-test -t kanban-vercel-test .
docker run --rm kanban-vercel-test
```

For PostgreSQL integration, set `TEST_DATABASE_URL` only to an isolated disposable database; the test fixture drops its public schema. See [database operations](DATABASE_OPERATIONS.md).

Create a preview deployment through the connected Vercel integration, Git preview branch, or authenticated Vercel CLI from the repository root after linking the project. Keep the project Root Directory at `backend`. Never use `--prod` for the preview release. Record the returned deployment URL/ID and stable alias. Do not deploy a temporary anonymous project as a substitute for the configured preview.

## Routing and limits

`/api` is mounted before `/` static files. There are no SPA catch-all rewrites. Public static assets may be promoted to Vercel's CDN; private routes retain session/Origin/no-store middleware. API-level `Cache-Control: no-store` is also configured at Vercel's routing layer. Keep static files in the function bundle as a runtime fallback.

- Function maximum: 60 seconds.
- OpenRouter: 40-second total network operation, with 30-second per-phase limits, no automatic request/write retry. Failure occurs before any AI board save.
- PostgreSQL: 5-second connect timeout and transaction-local 5-second statement timeout; short connections per operation through the managed pool. No connection/transaction spans the provider call. Durable identity/state/session validation uses PostgreSQL plus a stable configured signing secret, not process memory or function files.
- Requests: at most 2,000,000 bytes; oversized requests return uncached 413 before route handling. Board JSON: at most 1,000,000 UTF-8 bytes; oversized manual/AI boards are rejected before writing. Validation errors omit input and are bounded to 20 items, keeping error responses small and avoiding password/text echoes. These limits leave space below Vercel's 4.5 MB buffered request/response ceiling.

Timeouts/availability errors retain board contents. An uncertain connection failure after a possible save requires loading canonical state before retrying. A Vercel hard duration failure also requires reloading before repeating a write; the external function limit remains the final platform boundary.

## Preview acceptance checks

Use the stable HTTPS preview origin and record actual results:

- `/` renders; generated JS/CSS load; a missing asset/page returns 404. `/api/health` returns JSON. Missing `/api/*` returns JSON 404 rather than frontend HTML.
- Google start/callback use the exact registered HTTPS URL; cancelled/expired/replayed attempts give a safe retry. Demo login is disabled. Verify HttpOnly/Secure/SameSite=Lax cookies and session continuity after another function instance handles a request.
- API, auth redirects, failures, and private data remain uncached. Missing/foreign Origin on writes/logout returns 403. Two real accounts own isolated boards, including manual and AI edits.
- Create/edit/move/delete cards, rename columns, reload, sign out/in, and verify persistence. A new deployment retains PostgreSQL boards and sessions when the signing secret is unchanged. Verify preview uses its own database.
- Run a separate live AI answer/update on disposable preview data. Check provider errors/timeouts and concurrent manual/AI conflicts preserve saved state with no silent retries. Routine tests use mocked providers.
- Verify platform request logs redact OAuth code/state/query parameters; application Uvicorn filtering does not control Vercel's external access logs. Do not enable protocol/request-body debugging.

These hosted checks require a real configured preview; passing local tests is not evidence that Vercel CDN/function routes or Google account setup are correct.

## Rollback

Keep the prior deployment ID and a database backup/snapshot before schema changes. Reassign the preview alias to the previous compatible deployment, with the same environment database and session secret. Do not restore SQLite into Vercel or point preview at production. Versions 1-2 are additive; schema 3 removes the one-board-per-owner constraint and requires a compatible backend. An incompatible application rollback requires a planned restore or forward fix with traffic stopped. Keep both the app release and schema compatibility in the rollback record.

Official guidance rechecked 2026-11-18: [FastAPI](https://vercel.com/docs/frameworks/backend/fastapi), [Python runtime](https://vercel.com/docs/functions/runtimes/python), [limits](https://vercel.com/docs/functions/limitations), [monorepo source access](https://vercel.com/docs/monorepos/monorepo-faq), and [Neon pooling](https://neon.com/docs/connect/connection-pooling).
