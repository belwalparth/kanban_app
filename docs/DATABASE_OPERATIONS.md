# Database operations

Run from `backend/` with Python 3.14 and `uv`, or inside the app container using `python -m app.manage_db`. Psycopg 3.3.9 is locked with its binary wheel; current Python 3.14 support was verified against [official installation guidance](https://www.psycopg.org/psycopg3/docs/basic/install.html) and [release notes](https://www.psycopg.org/psycopg3/docs/news.html) on 2026-11-18.

## Schema setup

Use a new, empty PostgreSQL database for each preview/production environment. Supply the direct URL through the server environment as `DATABASE_MIGRATION_URL`; keep credentials out of shell arguments and repository files. Stop application traffic before migrations and imports. Back up an existing PostgreSQL destination with your provider snapshot or `pg_dump` before changing it. Runtime uses the separate pooled `DATABASE_URL`.

```sh
uv run --locked python -m app.manage_db migrate
```

Version 1 creates users, JSONB boards, and Google identities; version 2 adds one-time OAuth attempts. Version 3 adds board names and removes the one-board-per-owner constraint, preserving existing IDs, JSON, revisions, identities, and OAuth state. The current backend requires versions 1, 2, and 3. The command applies missing migrations transactionally; repeating it preserves data. Concurrent PostgreSQL migrations serialize through an advisory lock. Failed migration statements roll back schema changes and version records. PostgreSQL startup never migrates or seeds demo records. Grant the runtime role SELECT/INSERT/UPDATE/DELETE on these tables and sequence usage; run migrations under the schema owner.

Back up and rehearse the upgrade before applying version 3 to hosted data. Stop writes, migrate explicitly, then start the matching backend. Keep frontend/backend releases coordinated when Part 17 adds board selection. Code from Parts 12-15 rejects schema 3 and assumes one board per owner, so reverting only the application is unsafe; use a schema-compatible release or deliberately restore a backup with traffic stopped. Do not discard additional boards to satisfy the old unique constraint. Part 16 is prepared/tested locally and has not been applied to the production database.

Local SQLite remains supported. Before an explicit migration of an existing file, create a consistent backup with SQLite's backup API:

```sh
uv run --locked python -m app.manage_db migrate --sqlite /data/kanban.db --backup /data/kanban-before-google.db
```

For a new file omit `--backup`. The command refuses an existing backup path. Local startup automatically backs up a legacy schema to `<DATABASE_PATH>.pre-google.db`, version 1 to `<DATABASE_PATH>.pre-oauth.db`, or version 2 to `<DATABASE_PATH>.pre-multiple-boards.db` before upgrading. Preserve these files outside deployment assets. Existing board JSON, user IDs, and revisions remain intact. Later starts do not repeat the migration or backup.

Local Compose defaults to `APP_ENV=local` and `ALLOW_DEMO_LOGIN=true`; root `.env` can disable demo login. Outside Compose, demo login defaults to disabled. Cloud modes reject demo login and require PostgreSQL, HTTPS, Google client settings, and a configured session secret. `DATABASE_URL` never falls back to SQLite when unavailable. See [Google sign-in](GOOGLE_SIGN_IN.md) for cookies, CSRF, and settings.

## Deliberate demo-board import

The default production database starts empty. Every newly verified Google identity receives a separate seed board. No sign-in claims the local demo board, and email never selects ownership. Google issuer/subject validation must finish before calling the internal provisioning function; no public provisioning endpoint exists in Part 12.

After the intended Google account has signed in successfully, identify its exact verified `sub` and the chosen destination board ID using an operator connection or the owner's `GET /api/boards` metadata. Select the source demo user's exact board ID as well. Both IDs are required; no import guesses among multiple boards. Set the direct destination `DATABASE_MIGRATION_URL`. Stop the destination app and discard existing browser sessions before replacement: importing preserves the source revision, which may reuse a revision cached by a browser. Source and destination must differ.

```sh
uv run --locked python -m app.manage_db import-demo --source /data/kanban.db --backup /data/demo-import-backup.db --source-board-id SOURCE_BOARD_ID --subject VERIFIED_GOOGLE_SUB --board-id DESTINATION_BOARD_ID --replace
```

The command creates a consistent, new source backup, verifies the selected source belongs to the demo user, and requires the destination board to belong to the selected verified Google identity. Existing destination replacement requires `--replace`. Create an additional empty destination board first if the original should remain untouched. The failed attempt leaves its backup available; use a different new backup filename when rerunning. Import the selected JSON/revision in one transaction while preserving its destination ID/name and all other boards. The command never creates or merges identities by email. Use `--sqlite /path/to/disposable-target.db` to rehearse locally. Back up the destination separately before replacement.

To roll back an import, stop traffic and restore the destination backup/snapshot. Keep the source and backups private; do not add them to frontend assets or Git. This release's SQLite schema changes are additive, so the old local application can still read users/boards; old username-based sessions intentionally stop working with the new version and require sign-in again.

## Integration checks

Routine `uv run --locked pytest -q` exercises SQLite and skips PostgreSQL when `TEST_DATABASE_URL` is unset. For both engines, set `TEST_DATABASE_URL` to a dedicated disposable PostgreSQL database, then run the same command. The integration fixture drops and recreates its `public` schema for every PostgreSQL case. It never reads `DATABASE_URL` for test selection. Never point `TEST_DATABASE_URL` at preview, production, or any database containing wanted data.

The tests cover repeatable setup, legacy migration/backup, rollback, identity/board uniqueness, concurrent first sign-ins, profile changes, matching emails on distinct subjects, internal-ID sessions, owner isolation, stale writes, AI/manual conflicts, reconnects/app recreation, and explicit import. Hosted Neon/Vercel deployment and redeployment checks remain Parts 14-15.
