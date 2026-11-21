# Part 16: Multiple-board storage and API

Completed locally 2026-11-21. The backend supports multiple private named boards per user. Board-selection UI remains Part 17; hosted migration and deployment remain Part 18. Production and the running local app were not upgraded during this work.

## Changes

- Migration 3 adds board names and removes unique ownership while preserving existing IDs, owners, JSON, revisions, identities, and OAuth attempts. SQLite rebuilds the board table transactionally; PostgreSQL alters it. Both index owner/ID lookups.
- Local version-2 upgrades create a `.pre-multiple-boards.db` backup. Cloud startup requires explicit migration to versions 1, 2, and 3.
- Added list/create/read/rename/save endpoints under `/api/boards`; list/create/rename return metadata only. Additional boards start with five empty columns. Names are trimmed nonblank strings, at most 100 characters; duplicate names are allowed.
- Added `/api/boards/{board_id}/chat`. Ownership is checked before the provider call and during save; other boards' revisions do not affect the selected board. Board renames and document saves share that board's revision.
- Legacy `/api/board` and `/api/chat` select only the owner's oldest board for the existing UI. They cannot update several boards accidentally.
- First/returning sign-ins preserve existing boards. SQLite write transactions and PostgreSQL per-user row locks serialize initial-board creation even for an existing user with no board.
- Demo import now requires explicit source/destination board IDs, verifies their owners, backs up the source, and requires `--replace` for the chosen existing destination. It preserves destination name/ID and all other boards.

See [database/API contract](DATABASE.md#multiple-board-contract-part-16) and [upgrade/import instructions](DATABASE_OPERATIONS.md).

## Validation

Final complete backend suite: **276 passed, 3 expected skips** on Python 3.14.2, using temporary SQLite files and a dedicated PostgreSQL 18 container (`kanban-part16-postgres`, database `kanban_part16_test`). No production credentials were supplied. The integration fixture deliberately resets only this disposable PostgreSQL database.

Expected skips: production static export checked through the runtime image, the SQLite-only backup case on PostgreSQL, and the PostgreSQL-only cloud-runtime case on SQLite.

Validated:

- Upgrade from actual version-2 SQL with two owners preserves every selected board field, identity row, and OAuth attempt. Repeated migrations preserve the result; forced late migration failures roll back schema/data/version changes on both engines.
- The SQLite pre-upgrade backup retains the original schema and saved revision; repeated startup does not repeat the backup.
- Create/list, empty-board defaults, metadata-only responses, trimming/length checks, malformed IDs, owner injection rejection, and independent board updates.
- Rename/save races on one board yield one success and one conflict; simultaneous saves to distinct boards both succeed. Stale saves preserve the winning state.
- Unauthenticated access returns 401; foreign/unknown boards return equivalent 404s, including AI. Origin protection and no-store responses apply to new routes.
- New and returning concurrent sign-ins create only one initial board, preserve multiple existing boards, and retain their saved content.
- AI sees only the selected document, saves only that board, rejects same-board races for both update/no-change responses, and permits independent changes on another board. Unauthorized AI calls do not invoke the provider.
- Import updates only the explicitly selected owned destination and rejects foreign destinations and missing source boards; existing backup/replace/identity safeguards remain covered.
- Existing backend auth, Google sign-in, legacy board/chat, request limits, storage, and deployment regressions pass.

The suite used the existing test image with current `backend/app` and `backend/tests` mounted read-only. Dependencies and lockfiles were unchanged.

## Runtime packaging and HTTP smoke test

Built `kanban-part16-runtime` with `docker build --target runtime`. Existing frontend build/dependency layers were reused; the new backend and migration files were packaged. Confirmed Python 3.14.2, both version-3 SQL files present, and no pytest in the runtime.

Started a separate app on localhost:8002 with an internal disposable SQLite file. Actual HTTP checks passed for static `/`, health, demo login, initial-board loading, additional empty-board creation, card saving, board rename, stale-save 409, missing-AI-key 503 without writes, unknown-board 404, and API no-store headers. The additional board reached revision 2; the initial board document and revision were unchanged. This smoke test made no live provider call; AI behavior is covered with mocked responses in the backend suite. The disposable app and PostgreSQL test containers were stopped after verification.

The running local app was checked read-only and remains on schema versions 1 and 2. Its database SHA-256 was `7c4d3af39c77f9e13a3ab52353dc0215f6058eac7fd5b3ed6c9bf613ca5a5533`. No local volume was mounted into the test app or integration runner.

## Release boundary

No production migration, deployment, Google setting change, or board-data import was performed. Take/rehearse a hosted backup before migration 3. Older code rejects schema 3 and assumes a unique board per user; rollback must use a compatible application or an explicitly restored backup. Board switching and per-board client drafts/history are Part 17; shared boards and invitations remain Parts 19-21.
