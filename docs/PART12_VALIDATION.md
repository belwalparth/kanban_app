# Part 12 validation

Implemented 2026-11-18: durable PostgreSQL storage alongside SQLite, transactional Google identity provisioning, internal-ID session ownership, migrations, backup, and deliberate demo-board import. Google authorization/token validation and OAuth attempt storage remain Part 13. Hosted deployment verification remains Parts 14-15.

## Changes

- Psycopg 3.3.9 with Python 3.14 binary support, resolved with `uv lock`; existing dependencies retained. Official version/support references are linked in [database operations](DATABASE_OPERATIONS.md).
- Short-lived PostgreSQL connections, 5-second connection/statement limits, JSONB adaptation, bound SQL, transaction rollback, and conditional revision updates. Provider calls retain no open database connection/transaction. SQLite retains its existing JSON text schema and bounded write locking.
- Transactional version-1 SQL migrations with an applied-version record. PostgreSQL setup is an explicit operator action; app startup checks the version without creating users/tables. SQLite legacy upgrade backs up first and preserves stored JSON/revisions. No production demo seed or shared-password fallback.
- Canonical Google issuer plus case-sensitive subject ownership. User/identity/initial board commit together, concurrent callbacks converge on one owner, profile changes preserve the board, and identical emails never merge accounts. Provisioning is internal and must only receive verified OIDC claims in Part 13.
- Signed sessions resolve an internal user ID with absolute expiry. Old username sessions require sign-in again. Board and AI operations retain session-derived ownership. Local demo login is explicitly enabled in Compose and disabled by default elsewhere.
- Operator import creates a consistent SQLite backup, validates source data, requires a deliberately selected existing identity, refuses overwrite by default, and preserves the source board document/revision. Replacement is explicit and requires stopped traffic/discarded browser sessions. No real data was imported.

## Actual checks

Environment: Windows host with Docker Desktop Linux containers; Python 3.14.2, Psycopg 3.3.9, disposable PostgreSQL 18. The integration database was created only for these checks, never connected to application `.env`/live data. Test selection uses `TEST_DATABASE_URL`, separately from runtime and migration settings.

- `uv lock`: passed; added Psycopg, binary wheel, and Windows timezone dependency to the lockfile.
- `docker build --target test -t kanban-part12-test .`: passed, including locked dependency installation and packaging SQL migrations/static export. Existing unchanged frontend build layers were cached.
- Complete backend suite with both database engines and exported assets: **175 passed**. TestClient checks cover actual HTTP auth/board/chat boundaries and static assets. Provider requests are mocked; no OpenRouter key/network request is needed for tests.
- Source-mounted full suite with PostgreSQL enabled: **174 passed, 1 skipped** (production static export is not present in the source tree).
- Operator command smoke: `python -m app.manage_db migrate --sqlite /tmp/part12-cli.db` in a disposable container completed successfully.
- PostgreSQL server restart: selected subjects/revisions were `one|2` and `other|0` before restart and identical after `docker restart kanban-part12-postgres`, using fresh `psql` connections.
- One subsequent suite run reported 12 connection errors because the restart changed the disposable container IP from `172.17.0.4` to `172.17.0.3`. `docker inspect` confirmed the cause; the suite was rerun using the new address. Runtime deployment uses a stable provider hostname, not these test-only IPs.
- Migration/import rehearsals cover new/repeated schema setup, failed-DDL rollback, preserved legacy JSON/revision, automatic SQLite backup, explicit import overwrite refusal, selected-owner replacement, distinct source/destination, and unknown-identity refusal.
- Both database engines cover six concurrent first sign-ins, profile changes, issuer normalization/rejection, same email on different subjects, unique identity/board and foreign-key constraints, transactional rollback on board failure, two-user isolation, expiring ID sessions, simultaneous revision writes, app recreation, and AI/manual conflict preservation.
- `git diff --check`: passed (Windows line-ending notices only).

## Limits and remaining checks

No Neon/Vercel/Google account changes, public deployments, provider calls, or real data imports were performed. New app instances and a real PostgreSQL server restart passed locally; actual Vercel function replacement/redeployment and managed production durability remain unchecked until Parts 14-15. Existing local application/container/database were left untouched.

Google endpoints, token validation, OAuth state persistence, profile display, production cookie settings, and CSRF protection belong to Part 13. This intermediate version is not a production authentication release. Frontend source is unchanged; browser suites and native macOS/Linux scripts were not rerun for this backend storage change. The Docker build reused the previously built frontend export.

Use [DATABASE_OPERATIONS.md](DATABASE_OPERATIONS.md) for setup, backup, import, rollback, and disposable integration-test instructions.
