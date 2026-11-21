# Database design

## Multiple-board contract (Part 16)

Requested 2026-11-21. This section supersedes the historical one-board-per-user constraints below. Board sharing/membership is planned separately in Parts 19-21.

Schema migration 3 removes the unique constraint on `boards.user_id`, adds a nonblank board `name` of at most 100 characters (default `My board` for existing rows), and indexes `(user_id, id)`. Preserve every existing board ID, owner, JSON document, and revision. SQLite rebuilds only the boards table inside the migration transaction; PostgreSQL alters the existing table. Existing identities and OAuth attempts remain unchanged. Keep names outside board JSON; duplicate names are allowed.

Each owner can create several boards. New additional boards contain the five fixed columns with their standard titles and no cards. Initial Google/demo provisioning still creates just one seeded board, transactionally serialized per user. Returning sign-ins never reset or duplicate boards. Each board has its own revision; renaming the board and replacing its contents both conditionally increment that revision.

The session identifies the user; the route identifies the board. Every list/read/rename/save/chat operation filters by authenticated owner. A missing or foreign board returns the same 404. List/create/rename return only `{id, name, revision}` metadata; loading a board returns the existing `{revision, board}` document envelope. Board names are trimmed, nonblank strings, at most 100 characters; unknown request fields are rejected.

| Route | Request and result |
| --- | --- |
| `GET /api/boards` | Return the owner's metadata list in board-ID order; no card JSON. |
| `POST /api/boards` | `{name}`; create an empty board at revision 0; return metadata with 201. |
| `GET /api/boards/{board_id}` | Read that owned board's document/revision. |
| `PATCH /api/boards/{board_id}` | `{name, revision}`; conditional rename; return metadata. |
| `PUT /api/boards/{board_id}` | Existing `{revision, board}` contract; conditional document replacement. |
| `POST /api/boards/{board_id}/chat` | Existing `{revision, message, history}` contract; AI may read/update only this board. |

IDs must be positive signed 64-bit integers. Retain 401 for missing/expired authentication, 422 for malformed payloads/IDs, and 409 for stale revisions. Keep existing Origin checks and no-store headers. AI reads the selected board before calling the provider, holds no database transaction during that call, and saves/checks the same explicit board ID afterward. A change to another board must not conflict with this one.

Compatibility: legacy `/api/board` GET/PUT and `/api/chat` continue to select the owner's oldest board deterministically, preserving the Part 15 frontend until Part 17 adds the selector. They must never update all of an owner's boards. The operator import requires an explicit source and destination board ID plus a verified target Google subject; it verifies both owners, backs up the source, and requires `--replace` before modifying the selected existing destination. Other boards stay unchanged.

Apply migration 3 explicitly under the schema owner before starting the new cloud backend; take and rehearse a backup first. Local SQLite auto-upgrade creates a separate backup before upgrading a version-2 database. Deploy frontend/backend together for the Part 17 UI release. Earlier code rejects schema 3 and assumes unique ownership, so rollback requires a compatible application release or a deliberately restored backup; never roll back schema by discarding extra boards. Part 16 does not migrate or deploy production.

## Historical local MVP (Parts 5-7)

Status: approved by the user for Part 6 on 2026-11-16. The schema and authenticated board API were implemented, and Part 7 connected the frontend to them. See [backend validation](PART6_VALIDATION.md) and [frontend persistence validation](PART7_VALIDATION.md).

The sections through Approval describe the historical local MVP. Parts 12-13 implement PostgreSQL storage, additive SQLite migrations, Google identity provisioning, internal-ID sessions, and database-backed OAuth attempts. See [database operations](DATABASE_OPERATIONS.md) and [Google sign-in](GOOGLE_SIGN_IN.md). The Part 11 design below records the combined target.

## Storage and ownership

Use Python's standard `sqlite3` module and two tables. Each user owns one board, stored as JSON text in SQLite. No ORM, separate card/column tables, JSON database files, or chat tables are needed for the MVP.

The container already reserves `DATABASE_PATH=/data/kanban.db`; `/data` is mounted from the existing `kanban-data` named volume. Keep database access entirely in FastAPI, outside the public static directory.

| Table | Fields | Purpose |
| --- | --- | --- |
| `users` | `id`, `username` | Stable internal user identity; unique username. |
| `boards` | `id`, `user_id`, `board_json`, `revision` | One owned JSON board and a counter for detecting stale writes. |

`boards.user_id` is both a foreign key and unique: a user can have at most one board. Initialization creates the MVP user's board, so that user has exactly one. Additional users can own separate rows later without changing the schema.

Credentials remain the hardcoded Part 4 login check. Do not store the plaintext password in SQLite or introduce an unused password field. Future account/password management would require a separate change.

## SQL schema

`backend/app/database.py` initializes this schema at application startup.

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE
        CHECK (length(trim(username)) > 0)
);

CREATE TABLE IF NOT EXISTS boards (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE
        REFERENCES users(id) ON DELETE CASCADE,
    board_json TEXT NOT NULL CHECK (json_valid(board_json)),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
```

Enable foreign keys on every connection, before starting its transaction; SQLite does not enable their enforcement by default. Deleting a user then deletes that user's board. [SQLite foreign key documentation](https://www.sqlite.org/foreignkeys.html).

Use JSON text and `json_valid` for the database syntax check. Backend validation enforces the document structure and business rules below; SQL alone does not validate nested cards. SQLite supports storing JSON as ordinary text and checking it with JSON functions. [SQLite JSON documentation](https://www.sqlite.org/json1.html).

The primary-key and unique constraints provide the indexes needed for user lookup and board ownership. Do not add separate indexes, timestamps, a migration framework, or a JSON schema version until a concrete requirement needs them. `revision` is an edit counter, not a database schema version.

## Board document

The stored document is an object with one `columns` array. This wraps the existing frontend `Column[]` without changing its card or column fields.

```json
{
  "columns": [
    { "id": "backlog", "title": "Backlog", "cards": [] },
    { "id": "todo", "title": "To do", "cards": [] },
    { "id": "in-progress", "title": "In progress", "cards": [] },
    { "id": "review", "title": "Review", "cards": [] },
    { "id": "done", "title": "Done", "cards": [] }
  ]
}
```

The approved seed with the existing six cards is in [board.example.json](board.example.json). The backend's `app/seed.json` matches that example and is validated before initialization. These files supply initial defaults; live board state exists only in SQLite. Startup does not import TypeScript or depend on frontend assets.

Validation rules:

- Require exactly `columns` at the board level; exactly `id`, `title`, `cards` for each column; and exactly `id`, `title`, `details` for each card. Reject unknown fields, wrong types, and missing fields rather than silently discarding them.
- Require five columns, in this order: `backlog`, `todo`, `in-progress`, `review`, `done`. IDs cannot change; only display titles can be renamed.
- Column titles and card titles are strings, trimmed on save, and must contain non-whitespace text. Details are a string and may be empty or multiline.
- Card IDs are nonempty strings and unique across the entire board, including across columns. The same seed IDs may appear on another user's board because ownership is separate.
- Card creation uses a new unique ID. Editing and moving preserve that card's ID. Frontend and AI update instructions must follow this identity rule; whole-board validation checks uniqueness rather than inferring the user's intended edit operation.
- The containing column determines a card's location. Do not store a duplicate `column_id` inside each card. Array order records display order. A move removes the card from the source and appends it to an existing destination; a same-column drop is a no-op.
- Empty columns and a board with no cards are valid. Deleting the last card must not trigger reseeding.
- Keep ownership, board ID, and revision outside the JSON document. Do not accept client-supplied ownership or user identity.

The frontend allows a temporary blank column title while typing, commits on Enter/blur, and restores the saved title when a blank rename is submitted. Escape discards typing. Failed network saves retain the draft and display an error.

## Identity and API boundary

Keep Part 4's signed session flow. The `require_user` dependency now resolves its authenticated username to a database user containing `id` and `username`. A missing session or a username without a corresponding user row returns 401; requests never create users. Login still accepts only the hardcoded MVP credentials.

Two board routes are scoped to the authenticated user:

| Route | Behavior |
| --- | --- |
| `GET /api/board` | Read the session owner's board and revision. |
| `PUT /api/board` | Validate and replace that owner's entire board only if the supplied revision matches. |

Use the same envelope for a read response, update request, and successful update response:

```json
{
  "revision": 0,
  "board": {
    "columns": [
      { "id": "backlog", "title": "Backlog", "cards": [] },
      { "id": "todo", "title": "To do", "cards": [] },
      { "id": "in-progress", "title": "In progress", "cards": [] },
      { "id": "review", "title": "Review", "cards": [] },
      { "id": "done", "title": "Done", "cards": [] }
    ]
  }
}
```

Require an integer revision of zero or greater, rejecting booleans and numeric strings. Successful replacement increments it by one and returns the canonical validated board with the new revision. The database stores only the inner `board` object in `board_json`.

Return 401 for unauthenticated/unrecognized users, 404 for a missing owned board, 422 for invalid request data, and 409 for a stale revision. Unexpected storage errors must not be reported as successful saves; temporary database contention can return 503. Keep API responses uncached as in Part 4.

There are no board creation/deletion endpoints, user-ID route parameters, or board switching in the MVP. Card deletion is represented by removing the card from the submitted document.

## Initialization and persistence

In Part 6, before accepting application requests:

1. Read `DATABASE_PATH`, create its parent directory if needed, and connect to SQLite. Opening the configured path creates a database file if absent.
2. Enable foreign keys for that connection. Initialize the two tables and seed records in a transaction; commit only after the whole initialization succeeds.
3. Insert username `user` only if absent, then look up its generated ID. Do not rely on an assumed numeric ID.
4. Insert that user's seed board at revision 0 only if its board row is absent. Preserve every existing document and revision, including an intentionally empty board.
5. Close initialization connections. Use a short-lived connection per backend operation with foreign keys enabled and a bounded SQLite busy timeout. No global connection shared across request threads.

Backend database calls should run in synchronous routes/dependencies or the thread pool; do not block an async event loop with SQLite work. The local MVP can keep SQLite's default journal mode and normal short transactions; no WAL configuration or connection pool is required.

Refresh, logout, and container restart must not delete database records. Normal stop/start scripts preserve the named volume. Removing the named volume explicitly removes the database. User deletion cascades to its board; there is no user deletion feature in this MVP, and startup recreates the required MVP user/board if their records have been manually removed.

The database schema is introduced in Part 6; frontend persistence only becomes visible in Part 7. Login session lifetime remains governed by `SESSION_SECRET` and the cookie, separately from board storage.

## Atomic updates and revision conflicts

Validate the submitted board before acquiring a write transaction. Within a short transaction, update only the authenticated owner's row with the expected revision:

```sql
UPDATE boards
SET board_json = ?, revision = revision + 1
WHERE user_id = ? AND revision = ?;
```

All values are bound parameters. An explicit `BEGIN IMMEDIATE` obtains the write transaction. Read the owned row's current revision inside that transaction; return 404 if missing, or 409 if it differs from the submitted revision. Otherwise execute the conditional update, commit, and return the validated document plus the incremented revision. Roll back on any failure; rejected saves must not change the document or revision.

SQLite permits only one writer at a time; keep write transactions short. The conditional revision check additionally prevents a later stale request from replacing a newer committed board. [SQLite transaction documentation](https://www.sqlite.org/lang_transaction.html).

Example: two tabs read revision 3. Tab A saves and receives revision 4. Tab B submits revision 3 and receives 409; revision 4 stays intact. The UI should reload the latest server board and explain the conflict, with no silent overwrite or automatic replay of the rejected edit.

The same rule applies in Part 9: read the canonical board and revision, close the read operation, call OpenRouter outside any database transaction, validate the returned board, then conditionally save against the revision used for the AI call. If the board changed while AI was responding, reject that AI update as stale. A valid multi-card update commits once, so either all changes are saved or none are.

## Design review walkthrough

These scenarios formed the approved design review. Part 6 backend tests now verify them; browser persistence checks remain for Part 7.

| Scenario | Expected result under this proposal |
| --- | --- |
| First startup | One `user` row and its six-card board at revision 0. |
| Repeated startup | No duplicate users/boards and no reset of saved JSON or revision. |
| Create/edit card | Add a unique ID or retain the existing ID; save valid text and increment revision once. |
| Move card | Source loses it, destination gains it once; ID and total card count remain stable. |
| Rename column | Display title changes; the five IDs/order remain fixed. Blank committed titles are rejected. |
| Delete every card | Persist five empty columns; later startup leaves them empty. |
| Duplicate ID or changed column set/order | Reject with 422 before writing; prior JSON/revision remain unchanged. |
| Second hypothetical user | A separate user/board row, with all reads/writes filtered by that session owner's ID. Account creation/login for that user remains future work. |
| Second board for the same owner | Unique constraint rejects it. |
| Board without an existing owner | Foreign key rejects it. |
| User deletion | Cascade deletes only that user's board. |
| Two tabs or AI/manual conflict | First valid save increments revision; stale replacement returns 409 without losing the saved result. |
| Invalid JSON or write failure | Validation/constraint/transaction prevents a partial update. |
| Reload, logout/relogin, container restart | Board document/revision remain in the volume; authentication may require login again if its signing key changed. |

Part 6 tests use temporary databases, including actual rollback, foreign-key enforcement, second-user isolation, and reopening the same database. Part 7 must verify reload/restart persistence through the UI. Part 5 itself changed documentation only.

## Approval

- [x] Proposal matches the existing frontend fields, column IDs, seed cards, signed session flow, and Docker data path.
- [x] Proposed operations, ownership, constraints, and conflict behavior reviewed against the walkthrough above.
- [x] User approves this proposal before Part 6 begins.

## Google identity and production storage design (Part 11)

Design recorded 2026-11-18 for Parts 12-13. See [AUTH_DEPLOYMENT.md](AUTH_DEPLOYMENT.md) for hosting, OAuth validation, settings, and official sources. Keep the existing board document, stable IDs, ownership boundary, and API revision envelope.

### Target tables

| Table | Fields and constraints | Purpose |
| --- | --- | --- |
| `users` | Existing `id`, unique nonblank `username` | Internal owner ID. Local demo keeps `user`; a new Google user gets an internal `google:<sub>` username, never an email-derived key. |
| `google_identities` | `issuer`, `subject`, unique `user_id` FK to users with cascade delete, nullable `email`, nullable `display_name`; primary key `(issuer, subject)` | Verified Google identity and optional profile, one identity per user for this release. |
| `boards` | Existing `id`, unique owner FK with cascade delete, `board_json`, nonnegative `revision` | Exactly one initialized board per Google user. |
| `oauth_login_states` | `state_hash` primary key, `browser_binding_hash`, `nonce`, `code_verifier`, `expires_at` | Browser-bound, single-use, ten-minute OAuth attempts shared across instances. No provider tokens. |

Accept only the configured Google issuer; after validating it, normalize accepted Google spellings to `https://accounts.google.com`. Preserve the case-sensitive `sub` string exactly. A changed email updates optional profile fields for the same identity; different subjects with the same email remain separate accounts. Missing profile fields do not prevent login. Username is an internal compatibility field; display the optional name/email or a generic Google-user label in the UI. Do not expose the synthetic username as a display name.

PostgreSQL target schema (executed only by a migration command):

```sql
CREATE TABLE users (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    username TEXT NOT NULL UNIQUE CHECK (length(trim(username)) > 0)
);

CREATE TABLE google_identities (
    issuer TEXT NOT NULL CHECK (issuer = 'https://accounts.google.com'),
    subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
    user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    email TEXT,
    display_name TEXT,
    PRIMARY KEY (issuer, subject)
);

CREATE TABLE boards (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    board_json JSONB NOT NULL CHECK (jsonb_typeof(board_json) = 'object'),
    revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0)
);

CREATE TABLE oauth_login_states (
    state_hash TEXT PRIMARY KEY,
    browser_binding_hash TEXT NOT NULL,
    nonce TEXT NOT NULL,
    code_verifier TEXT NOT NULL,
    expires_at BIGINT NOT NULL
);
```

Use the existing SQLite users/boards tables unchanged and add equivalent identity/state tables with integer foreign keys. SQLite retains JSON text plus `json_valid`; PostgreSQL uses Psycopg JSONB adaptation and returns the same validated board object. SQLite and PostgreSQL generated-ID syntax differs; keep this difference inside the small storage layer. No card/column tables, ORM, provider-token table, or persistent chat history is needed.

### Initialization and first sign-in

Cloud startup checks configuration and connects to an already migrated database; it never seeds the shared demo user. Local SQLite initialization may seed the demo user/board only when local demo login is explicitly enabled. Preserve existing SQLite rows even when demo login is disabled.

After all Google/token/state validation succeeds, use one short transaction to resolve or create the internal user, identity, and seed board. Serialize same-subject first sign-ins using the unique internal username and identity constraints: insert the internal username with conflict handling, select its ID, then insert identity/board if absent. Check that any conflicting identity belongs to that internal user; roll back if inconsistent. Existing local `user` is never selected for Google sign-in. Use canonical `(issuer, subject)` for returning-user lookup, update only optional profile fields, and preserve the existing board/revision. No session is issued before commit. Failures roll back all newly created rows; repeated/concurrent successful sign-ins converge on one user/identity/board.

### OAuth attempts

Generate independent cryptographically random state, browser binding, nonce, and PKCE verifier. Store SHA-256 hashes of state and browser binding, the nonce/verifier, and Unix expiry seconds. Send raw state to Google and raw browser binding only in the short-lived HttpOnly cookie; do not put the verifier into browser storage or a signed-but-readable session payload.

At callback, atomically delete and return the matching unexpired row using state and browser-binding hashes. PostgreSQL can use `DELETE ... RETURNING`; SQLite can select/delete inside `BEGIN IMMEDIATE`. A missing/expired/already consumed row rejects login. Consume before token exchange so parallel callbacks cannot both succeed. Validate nonce against the returned attempt. A network/token failure requires a new login attempt. Delete expired rows during sign-in start to bound stale-state retention. Database credentials and logs must not expose these records; callback logs must exclude codes/state/tokens.

### Sessions and ownership

The signed app session changes from username lookup to internal `user_id` plus absolute expiry. `require_user` validates the session and resolves that ID through storage. General board/chat requests never create users. Cookie settings and Origin-based CSRF rules are in AUTH_DEPLOYMENT.md. Profile email/name is display data only. Session-secret rotation invalidates outstanding cookies; deleting a user makes its existing cookies fail lookup. Browser logout clears the cookie but does not revoke a copied signed cookie before expiry.

### PostgreSQL transactions and conflicts

Use parameter binding and short transactions via the pooled runtime connection. Preserve synchronous storage in FastAPI's thread pool/synchronous dependencies; do not block async handlers with database I/O. Read/release the board connection before OpenRouter; validate AI output before opening the write transaction.

For PostgreSQL, replace SQLite's `BEGIN IMMEDIATE` algorithm with a conditional atomic update:

```sql
UPDATE boards
SET board_json = %s, revision = revision + 1
WHERE user_id = %s AND revision = %s
RETURNING board_json, revision;
```

One concurrent writer succeeds; a stale writer returns no row and receives 409 when the owned board exists, or 404 when absent. Read the owned row to distinguish those cases, without returning another user's data. Roll back on validation/storage failure and return only committed canonical state. Preserve current 401/404/409/422 behavior; map transient database availability/contention to a useful retryable error without logging connection credentials. Configure `SET LOCAL statement_timeout` inside transactions. No connection or database transaction remains open during a provider call.

### Migration and validation

Part 12 will add explicit, repeatable schema setup/migration commands for PostgreSQL and the additive SQLite identity/state tables. Keep SQL in reviewed migration files and verify expected schema before/after; apply each migration transactionally and record its applied version. A migration failure must stop deployment rather than being hidden by `CREATE TABLE IF NOT EXISTS`. Schema management runs with the direct migration URL, outside function startup and ordinary preview builds. Runtime roles need data access, not schema ownership.

Use a new, empty production PostgreSQL database by default. Back up existing SQLite before applying local migrations or an optional board import. Import requires a deliberately selected, already verified Google identity: validate the source board, map its owner explicitly, preserve its revision, and refuse to overwrite an existing destination board without an explicit operator choice. Keep source SQLite intact. Never link `user` to the first Google account, infer an owner by email, or upload the demo database as a deployment asset.

Use separate empty preview/integration databases. Tests must cover both storage engines, concurrent first login, consumed/expired/wrong-browser OAuth state, changed email, matching emails on different subjects, rollback, owner isolation, stale manual/AI updates, and persistence after reconnect. Preview deployment/redeployment checks and optional import rehearsal remain Parts 14-15. The original Part 6 approval above applies only to the historical MVP design.
