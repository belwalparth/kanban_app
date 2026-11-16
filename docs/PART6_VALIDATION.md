# Part 6 validation

Validated on 2026-11-16 using Docker Desktop Linux containers, Windows PowerShell, and Chrome.

## Implemented

- `backend/app/database.py`: approved two-table SQLite schema, transactional initialization, idempotent seeding, per-operation connections with foreign keys and a five-second busy timeout, and database user lookup.
- `backend/app/seed.json`: initial board defaults, verified to match `docs/board.example.json` exactly. Live data is stored in SQLite, not this file.
- `backend/app/models.py`: strict board validation, fixed column IDs/order, required fields, nonblank titles/IDs, globally unique card IDs within a board, and integer revisions. Titles are trimmed; empty/multiline details and empty boards are valid.
- `backend/app/boards.py`: authenticated `GET /api/board` and `PUT /api/board`. Updates replace the owner's complete board inside a short `BEGIN IMMEDIATE` transaction, check its revision, and increment it on success.
- `require_user` now resolves the signed session username to a database user ID. Missing/removed users cannot authenticate or trigger user creation. Login remains hardcoded to `user` / `password`.
- Root application lifespan initializes SQLite before requests are accepted, using the thread pool. Synchronous routes/dependencies keep SQLite work off the event loop. Database failures return generic 500 responses; temporary lock contention returns 503. Existing API no-cache behavior remains.
- Database defaults to `/data/kanban.db` in Docker's named volume; local backend default is `backend/kanban.db`. `DATABASE_PATH` can configure the path.

## Verification

- `docker build --target test -t kanban-app-test .` succeeded, including the frontend static production build/type checking.
- `docker run --rm kanban-app-test`: **73 passed**, no skipped tests or warnings.
- Existing authentication/static routing tests now use isolated temporary database paths.
- Database tests cover parent-directory creation, first/repeated initialization, real constraints, foreign keys, cascade deletion, actual user IDs, initialization rollback, environment configuration, and reopening saved data.
- API tests cover create/edit/move/delete/rename, normalization, empty-board persistence, malformed JSON, missing/extra/wrong-type fields, column removal/addition/reordering, duplicate card IDs, invalid revisions, missing authentication, missing boards, and deleted users.
- Second-user tests use a signed test session for a manually seeded user. Each session reads/writes only its owner's board; injected ownership fields are rejected. No registration or second-user login feature was added.
- A simultaneous two-client test submits the same revision: exactly one update succeeds and one returns 409; the winning document remains intact.
- A real SQLite trigger fails after an update starts and creates a side effect. Both the board/revision change and the trigger's extra user are rolled back; the API returns 500.
- An actual write lock yields a bounded 503 without modifying data.
- Live HTTP check against the rebuilt app authenticated, read the board, saved its content unchanged, observed the revision increment, and rejected a replay of the old revision with 409.
- Stopped and recreated the container through the existing scripts, signed in again, and confirmed the exact saved JSON and revision survived. The check incremented the revision but did not alter board content. Compose reports healthy.
- Chrome auth regression suite: **10 passed** across desktop/mobile emulation, including login errors, session restoration, logout, tampering, and retry behavior.
- `git diff --check` passes, with normal Windows line-ending conversion notices possible.

No frontend source was changed. Its standalone unit/lint suites were not repeated; production build/type checks and browser auth integration were run because the backend identity flow changed. Existing board UI behavior remains the Part 4 demo until Part 7.

## Check manually

Start the app normally. Sign in in your browser, then open http://localhost:8000/api/board in the same browser to inspect the stored board and revision. A signed-out/private window should receive 401.

For a read/write check in PowerShell, run these from the project root:

```powershell
$null = Invoke-RestMethod -Method Post -Uri http://localhost:8000/api/auth/login -ContentType 'application/json' -Body '{"username":"user","password":"password"}' -SessionVariable boardSession
$board = Invoke-RestMethod -Uri http://localhost:8000/api/board -WebSession $boardSession
$payload = $board | ConvertTo-Json -Depth 20 -Compress
$saved = Invoke-RestMethod -Method Put -Uri http://localhost:8000/api/board -ContentType 'application/json' -Body $payload -WebSession $boardSession
$saved.revision
```

The revision should be one greater than `$board.revision`; the content is unchanged. Submitting `$payload` again should return 409 because it contains the older revision.

To verify persistence, retain `$saved` in that PowerShell session:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stop.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start.ps1
$null = Invoke-RestMethod -Method Post -Uri http://localhost:8000/api/auth/login -ContentType 'application/json' -Body '{"username":"user","password":"password"}' -SessionVariable restoredSession
$restored = Invoke-RestMethod -Uri http://localhost:8000/api/board -WebSession $restoredSession
($restored | ConvertTo-Json -Depth 20 -Compress) -eq ($saved | ConvertTo-Json -Depth 20 -Compress)
```

Expect `True`. API saves persist now; editing the visual board does not call these routes until Part 7.

## Boundaries and references

The live Docker app remains running. No account management, chat, frontend persistence, ORM, migration framework, or extra database tables were introduced. Native macOS/Linux start/stop execution remains untested as previously recorded.

Implementation references: [Python 3.14 sqlite3 transactions](https://docs.python.org/3.14/library/sqlite3.html#transaction-control), [Pydantic validators](https://docs.pydantic.dev/latest/concepts/validators/), and [FastAPI lifespan](https://fastapi.tiangolo.com/advanced/events/). The approved schema and API contract are in [DATABASE.md](DATABASE.md).
