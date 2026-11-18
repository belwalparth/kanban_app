# Database operations (Part 12)

Run from `backend/` with Python 3.14 and `uv`, or inside the app container using `python -m app.manage_db`. Psycopg 3.3.9 is locked with its binary wheel; current Python 3.14 support was verified against [official installation guidance](https://www.psycopg.org/psycopg3/docs/basic/install.html) and [release notes](https://www.psycopg.org/psycopg3/docs/news.html) on 2026-11-18.

## Schema setup

Use a new, empty PostgreSQL database for each preview/production environment. Supply the direct URL through the server environment as `DATABASE_MIGRATION_URL`; keep credentials out of shell arguments and repository files. Stop application traffic before migrations and imports. Back up an existing PostgreSQL destination with your provider snapshot or `pg_dump` before changing it. Runtime uses the separate pooled `DATABASE_URL`.

```sh
uv run --locked python -m app.manage_db migrate
```

Version 1 creates users, JSONB boards, and Google identities in one transaction, recording `schema_migrations.version = 1`. Repeating it preserves data. Concurrent PostgreSQL migration commands serialize through a transaction advisory lock. An incompatible schema or failed statement rolls back; do not edit an applied migration. Future schema changes require new versions. PostgreSQL startup only checks the recorded version; it never migrates or seeds demo records. Grant the runtime role SELECT/INSERT/UPDATE/DELETE on these tables and sequence usage; run migrations under the schema owner.

Local SQLite remains supported. Before an explicit migration of an existing file, create a consistent backup with SQLite's backup API:

```sh
uv run --locked python -m app.manage_db migrate --sqlite /data/kanban.db --backup /data/kanban-before-google.db
```

For a new file omit `--backup`. The command refuses an existing backup path. On the first normal local startup with the legacy schema, the application automatically backs up to `<DATABASE_PATH>.pre-google.db` before applying the additive migration. Preserve this file outside deployment assets. Existing board JSON, user IDs, and revisions remain intact. Later starts do not repeat the migration or backup.

Local Compose explicitly enables `APP_ENV=local` and `ALLOW_DEMO_LOGIN=true`. Outside Compose, demo login defaults to disabled. Cloud modes reject demo login and require PostgreSQL plus a configured session secret. `DATABASE_URL` never falls back to SQLite when unavailable. Google endpoints, production cookies, CSRF, and full OAuth settings validation are Part 13.

## Deliberate demo-board import

The default production database starts empty. Every newly verified Google identity receives a separate seed board. No sign-in claims the local demo board, and email never selects ownership. Google issuer/subject validation must finish before calling the internal provisioning function; no public provisioning endpoint exists in Part 12.

After the intended Google account has signed in successfully through Part 13, identify its exact verified `sub` from the database using an operator connection. Set the direct destination `DATABASE_MIGRATION_URL`. Stop the destination app and discard existing browser sessions before replacement: importing preserves the source revision, which may reuse a revision cached by a browser. Source and destination must differ.

```sh
uv run --locked python -m app.manage_db import-demo --source /data/kanban.db --backup /data/demo-import-backup.db --subject VERIFIED_GOOGLE_SUB
```

The command creates a consistent, new backup, validates the demo owner's board, requires an existing destination Google identity, and refuses to overwrite its board. The failed attempt leaves its backup available; use a different new backup filename when rerunning. To deliberately replace that account's board, supply `--replace`. The selected board JSON and revision are imported together in one transaction; source SQLite remains intact. The command neither creates an identity nor matches by email. Use `--sqlite /path/to/disposable-target.db` to rehearse locally. Back up the destination separately before replacement if its prior board matters.

To roll back an import, stop traffic and restore the destination backup/snapshot. Keep the source and backups private; do not add them to frontend assets or Git. This release's SQLite schema changes are additive, so the old local application can still read users/boards; old username-based sessions intentionally stop working with the new version and require sign-in again.

## Integration checks

Routine `uv run --locked pytest -q` exercises SQLite and skips PostgreSQL when `TEST_DATABASE_URL` is unset. For both engines, set `TEST_DATABASE_URL` to a dedicated disposable PostgreSQL database, then run the same command. The integration fixture drops and recreates its `public` schema for every PostgreSQL case. It never reads `DATABASE_URL` for test selection. Never point `TEST_DATABASE_URL` at preview, production, or any database containing wanted data.

The tests cover repeatable setup, legacy migration/backup, rollback, identity/board uniqueness, concurrent first sign-ins, profile changes, matching emails on distinct subjects, internal-ID sessions, owner isolation, stale writes, AI/manual conflicts, reconnects/app recreation, and explicit import. Hosted Neon/Vercel deployment and redeployment checks remain Parts 14-15.
