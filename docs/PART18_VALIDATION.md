# Part 18: Multiple-board release

Released to production, 2026-11-22. Two-real-account production acceptance and the final redeployment persistence check remain pending.

## Starting state and diagnosis

- Target: `belwalparth/kanban-app`, FastAPI with root `backend`, Node 24, PostgreSQL 18.
- Git integration had already deployed commit `df4d9415942b0b3da375f9a79d724ce062b08940` to production as `dpl_DkemSBiDRYHBkChKoCpZCcWUm26b` before this release work.
- Health, authentication configuration, and board-list requests returned HTTP 500. Sanitized runtime logs confirmed `Run the database migration command before starting the app`.
- The supplied direct operator connection confirmed schema versions 1 and 2, with three users, three boards, and three Google identities. No private board contents or credentials were recorded.
- Preview and production initially shared database and session-secret environment records. New preview deployments must use separate database credentials and a separate session secret.

## Backup and rehearsal

- Created a PostgreSQL 18 custom-format backup in Docker volume `kanban-part18-private-backups`, file `/private/before-schema3-verified.dump`. This private volume is outside the repository and deployment source. Preserve it and Docker's storage until another verified backup is available.
- Recorded private SHA-256 fingerprints and row counts for users, boards, Google identities, and OAuth attempts in the same volume, `/private/before-schema3.json`.
- Restored the archive into the initially empty `kanban-part18-restore` container on an isolated Docker network, without publishing a port. Verified original schema and all table fingerprints.
- Applied migration 3 to that restored copy using the unchanged operator command. Verified schema versions 1–3, valid board names, and unchanged identities, board IDs, ownership, JSON, revisions, and OAuth attempts.
- Did not run the destructive PostgreSQL test fixture against the restored backup. Regression tests used a separate synthetic database.
- Initial backup attempts produced empty files because the client did not interpret a connection URI supplied through `PGDATABASE` as connection parameters. The successful attempt used separate PostgreSQL environment variables; credentials were not passed as command arguments.

## Fresh checks

| Check | Result |
| --- | --- |
| Frontend unit/component suite | 78 passed |
| TypeScript and ESLint | Passed |
| Node 24 / Python 3.14 Vercel build hook and static export | Passed in Docker |
| Backend suite with SQLite and disposable PostgreSQL | 277 passed, 2 expected skips |
| Full desktop/mobile browser suite on disposable localhost:8002 | 59 passed, 5 expected skips |

Browser checks included real multiple-board persistence, reload/login, independent board contents, URL/history selection, per-board AI memory, and pending-save/AI navigation. Live-provider cases were excluded from that local browser run. The local review app and its synthetic SQLite database are separate from production.

## Preview preparation

Created an empty `kanban_part18_preview` database in the existing Neon project, with schema 3, a dedicated restricted runtime login, pooled TLS connection, and independent session secret. It contains no copied production data. Verified that the preview login can read its own empty tables, cannot create objects in the public schema, and has no SELECT permission on production boards. This is database separation on the same Neon branch, rather than a separate compute or project.

Removed Preview scope from the previously shared environment records while preserving their Production values. Configured Preview with its own database login, session secret, explicit environment and origin. Preview continues to use the Google client and OpenRouter credentials available in the operator's local configuration; distinct OAuth clients/provider keys are not claimed. The direct migration URL is not a serving-function variable.

## Hosted preview

- Deployment `dpl_4Vbr93xAMErG19gQM2WmnCoxGKYE`, Ready, commit `df4d941`, 33-second build.
- Stable origin: `https://kanban-app-git-part18-preview-belwalparth.vercel.app`; deployment URL: `https://kanban-hb7okr782-belwalparth.vercel.app`.
- Deployment Protection remains enabled. API automation used a short-lived project development OIDC token; no production session/signing secret was retrieved.
- Created two explicitly synthetic operator test users, without claiming they completed Google authentication. Each had an initial board and additional boards created through the hosted API. Tests used preview-only signed sessions and left synthetic acceptance boards in preview.
- Passed 38 hosted HTTP cases: authenticated metadata/read/create/rename/update, empty new boards, card editing/movement, column renaming, reload-equivalent reads, unchanged initial boards, rejected stale revisions, and cross-account read/write/rename/AI rejection.
- Live OpenRouter answer left the board unchanged. Live card creation saved exactly the requested new card without changing the initial board. The first test's ambiguous wording put `in todo` into the details; an explicit quoted-details/destination request passed the exact comparison. No application change was needed.
- A separate real hosted overlap check started an AI card update, saved a manual card while the AI request remained pending, and observed HTTP 409 from AI. The complete final board/revision matched the winning manual save; the AI could not overwrite it.
- Isolated browser rendered all five columns, selected the additional board, displayed its manual and live-AI cards, retained selection/content on refresh, and reported no page errors.
- User registered the stable preview callback and reported `Google sign-in works` in their normal browser. This is user-reported real Google authentication evidence, separate from synthetic API automation.

## Production release

- Before migration, rechecked all original table fingerprints against the backup baseline.
- Applied migration 3 explicitly. Verified versions 1–3, valid names, and unchanged original identities, board IDs/owners, JSON, revisions, and OAuth records immediately afterward.
- Staged production deployment `dpl_4RrVRh8fnfard7GGMeKfwaNNJbXw` at `https://kanban-jgg32wywp-belwalparth.vercel.app`, using the same tested source, without assigning the live domain. Build: 33 seconds; post-build: 12 seconds.
- The first staged health request still reported the migration startup error; a subsequent authenticated check returned `{"status":"ok"}` after migration. The original live deployment also recovered after the schema update.
- Promoted the staged deployment to `https://kanban-app-seven-nu.vercel.app` after its successful startup check. Production environment values/signing secret were retained.
- Fresh public smoke: 18 successful requests covering HTML, three JS/CSS assets, health, Google-only configuration, unauthenticated board/session/write/AI rejection, disabled demo login, foreign-origin rejection, 404 routing, and the exact Google callback with Secure/HttpOnly/SameSite cookie attributes. Checked API responses were no-store.
- A bounded two-minute production log sample contained one runtime record, no error/fatal/startup-failure pattern, and no obvious database URL/API key/OAuth-query pattern. This does not establish complete platform-log redaction or monitoring coverage.
- `vercel curl` created a persistent Protection Bypass for Automation secret when checking staged production. Deployment Protection remains enabled; the bypass can be revoked in the project's Deployment Protection settings after operator verification.

Two-real-account production behavior and new multi-board state across redeployment remain pending. The real-provider concurrency check above ran only against synthetic preview data; no production provider outage or forced timeout was induced.

Final persistence deployment is built and Ready as `dpl_8Y1y4K16SamS712oh4P1oRRf72iT`, `https://kanban-lly1oqo57-belwalparth.vercel.app`, with domain assignment skipped. It has not been promoted: first complete the production two-account checklist, record the resulting board/identity fingerprints, then promote and verify those saved fingerprints plus browser session/content continuity. Current live deployment remains `dpl_4RrVRh8fnfard7GGMeKfwaNNJbXw`. A final read-only check still showed three production users and three boards on schema 3; no synthetic acceptance users/boards were inserted into production.

## Recovery boundary

Before schema 3, the old Part 14/15 release expects one board per owner. After schema 3, use a schema-3-compatible application release. Reverting only the application to Parts 12–15 is unsafe. Do not discard additional boards or recreate the old unique constraint as a rollback shortcut. Rehearse any database restoration separately and stop writes before a deliberate production restore.
