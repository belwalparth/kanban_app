# Part 14 validation

Local implementation and checks completed 2026-11-18. **No hosted preview was deployed.** Vercel and Neon integrations were found but are not connected; team/project access, databases/roles, regions, stable hostnames, and cloud Google registrations remain pending. See [deployment procedure](VERCEL_DEPLOYMENT.md) and [PLAN.md](PLAN.md) for the remaining acceptance checks.

## Implemented configuration

- `backend/pyproject.toml`: FastAPI entrypoint `app.main:app`, post-install build hook `python build_frontend.py`, existing Python 3.14 and uv lock retained.
- `backend/vercel.json`: FastAPI preset, 60-second function duration keyed to `app/main.py`, API no-store headers, and exclusion of tests/caches/local database/environment files. No SPA rewrite intercepts `/api` or OAuth callbacks.
- `backend/build_frontend.py`: portable locked npm installation including build tools, static export, safe replacement of only generated `backend/app/static`, and removal of application credentials from the frontend subprocess environment. The matching npm cache is preferred; audit/funding queries are not part of the build.
- Root `.vercelignore` and Git/Docker exclusions keep local databases, credentials, dependencies, and generated artifacts out of source uploads. Root `.env.preview` and `.env.production` staging files have distinct generated session secrets, cloud mode, disabled demo login, and empty account-specific values. Git ignores both; actual databases/Google clients/environment uploads were not created.
- Vercel execution refuses to default to local mode. PostgreSQL startup checks the already applied schema and never initializes/seeds. Short connections retain 5-second connect and transaction-local statement timeouts. There is no provider call inside a database transaction.
- OpenRouter now has a 40-second total network deadline in addition to 30-second phase limits. Timeout returns safe 504, does not retry, and occurs before board mutation.
- API bodies over 2,000,000 bytes return uncached 413, including requests with chunked/no Content-Length bodies. Board JSON over 1,000,000 UTF-8 bytes is rejected before writes. Validation responses omit input and contain at most 20 errors, avoiding password/board echoes and oversized failure bodies. The UI retains drafts and explains rejected large requests/boards.

## Actual checks

| Check | Result |
| --- | --- |
| Backend suite using exported Vercel-hook artifact, SQLite, and disposable PostgreSQL 18 | **234 passed, 1 intentional skip** |
| Frontend component/helper suite | **63 passed** |
| ESLint and TypeScript | Passed |
| Portable Vercel build hook on Node 24 + Python 3.14 + locked uv | Passed |
| Next.js production static export | Passed |
| Chrome desktop/mobile browser suite on disposable port 8001 app | **46 passed, 4 intentional skips** |
| Separate live free-model answer plus combined create/edit/move check | Passed on disposable synthetic SQLite data |
| Final local runtime build/restart | Healthy; frontend HTTP 200; Google enabled; demo disabled |
| Saved local board checksum across runtime recreation | Exact match; private content was not printed |
| Runtime Python dev dependency exclusion | Verified pytest absent |
| Official Vercel schema | FastAPI preset/function configuration supported |
| `git diff --check` | Passed |
| Actual hosted preview/CDN/HTTPS/Google/AI verification | Pending external account setup |

The single backend skip is the cloud-mode scenario for the SQLite parameter: the same scenario runs against PostgreSQL because cloud mode forbids SQLite. Browser skips are two opt-in live-provider browser cases, duplicate mobile real-data persistence, and mobile native drag/drop. Mobile card movement through the editor remains covered. The separate live provider check ran outside the routine browser suite.

The PostgreSQL cloud simulation uses HTTPS ASGI TestClient transport, a stable signing secret, and a disposable local PostgreSQL server. It validates Secure/HttpOnly/SameSite=Lax session issuance, the same session on a fresh app instance, no-store private responses, owner-filtered persistent writes, callback errors, and missing API/static resources. This is not a real Vercel function, hosted TLS, Neon pool, CDN, or redeployment check.

The provider deadline test uses a response stream yielding small chunks, so per-phase timeouts alone would not stop it. A shortened total deadline causes one safe 504, closes the stream, and makes no retry. An authenticated chat integration case confirms stored JSON/revision remain unchanged after that timeout. Existing manual/AI conflict tests pass on both databases.

The live check used `nvidia/nemotron-3.5-super-vl:free`, passed the runtime key through a process environment variable by name, and printed only model/results. It validated an answer-only reply and a combined card creation/edit/move against a temporary seeded database, then removed that database. The actual user board and Google identity were not used for live AI testing.

## Build and test diagnosis

The first combined Linux test image copied npm's symlink as a regular file, producing `Cannot find module '../lib/cli.js'` from `/usr/local/bin/npm`. Recreated the proper symlink to the copied npm installation; the installed application source was not changed to work around this test-image issue.

Fresh npm registry downloads then showed repeated `FETCH_ERROR`/`ECONNRESET` failures and slow successful fetches, despite a successful registry ping. Confirmed all lockfile tarball URLs use the official npm registry. Stopped the two identified stalled validation builds and used the existing matching frontend-dependency npm cache for the Docker verification. `npm ci` still verifies the exact lockfile/integrity; only this Docker check sets offline mode. The actual Vercel hook prefers cached tarballs and can download uncached packages normally. The final hook installed 422 packages, built Next.js 16.4.6, and exported static assets successfully. Fresh uncached registry installation in this local network was not verified.

An existing callback-message component test observed the alert before React's URL-cleanup effect finished. Awaiting the effect fixed the timing assertion; the application behavior was not changed. The new HTTPS instance test initially expected a cookie to be reissued on an unchanged read; it now checks the actual issuance response, then verifies that cookie across app instances. The final suites pass.

## Commands and isolation

- `docker build --target vercel-test -t kanban-part14-test .`
- `docker run --rm --network <isolated-network> -e TEST_DATABASE_URL=<disposable-database> kanban-part14-test`
- In `frontend/`: `npm run test:run`, `npm run lint`, `npm run typecheck`.
- `npm run test:e2e -- --workers=2` with Chrome and `PLAYWRIGHT_BASE_URL=http://localhost:8001`.
- Separate disposable `python -m app.check_chat` using the runtime key only through environment inheritance.
- `docker compose up -d --build --wait`, followed by health/config/timeout/dev-dependency checks and before/after board checksum comparison.

No real database was dropped or migrated for cloud use. Integration fixtures use only their dedicated disposable database. Local data fit the new board-size limit; its largest saved document was 1,298 bytes when checked. The final local checksum matched before/after container recreation, Google configuration stayed enabled, and demo login stayed disabled. Local API no-store and the 40-second provider setting were verified in the running runtime.

## External work still required

Vercel/Neon plugin discovery returned eligible, unconnected integrations. No corresponding service tools became available during this work. Install/connect both or perform the console steps in [VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md). Do not send secret values in chat.

After access is available: select the team/project and regions; provision separate empty preview/production databases/roles; choose stable aliases; register cloud Google callbacks; fill and upload correctly scoped runtime settings; apply explicit migrations; deploy a preview; record its URL; verify actual routing/CDN, cookies, cache behavior, durable writes across redeployment, and live AI behavior. Provider credentials/callbacks for localhost were not reused as cloud account setup.

Official guidance was fetched directly as Markdown after the web reader rejected its content type: [FastAPI](https://vercel.com/docs/frameworks/backend/fastapi), [Python](https://vercel.com/docs/functions/runtimes/python), [limits](https://vercel.com/docs/functions/limitations), [monorepo access](https://vercel.com/docs/monorepos/monorepo-faq), [configuration schema](https://openapi.vercel.sh/vercel.json), and [Neon pooling](https://neon.com/docs/connect/connection-pooling), rechecked 2026-11-18. The build hook was executed on Linux; its Windows npm.cmd branch was not executed. Native macOS/Linux script checks were not rerun; those scripts are unchanged.
