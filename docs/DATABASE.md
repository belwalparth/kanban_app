# Database design

Status: approved by the user for Part 6 on 2026-11-16. The schema and authenticated board API are implemented, and Part 7 connects the frontend to them. See [backend validation](PART6_VALIDATION.md) and [frontend persistence validation](PART7_VALIDATION.md).

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
