# Project Management MVP plan

## Agreed decisions and scope

- One local Docker container: FastAPI serves the statically exported Next.js UI and `/api/*`; SQLite lives in a persistent Docker volume. Use `uv` for Python dependencies.
- MVP credentials are `user` / `password`. One board per signed-in user; database design supports future users. No registration or board switching.
- Store each board as JSON inside SQLite, rather than in a JSON file.
- Preserve the existing five column IDs. Columns can be renamed, but not added, deleted, or reordered. Support card creation, title/details editing, deletion, and cross-column movement. Moves append to the destination; no card reordering feature is required.
- Use root `Agents.md` colors: yellow `#ecad0a`, blue `#209dd7`, purple `#753991`, navy `#032147`, and supporting gray `#888888`. This supersedes brown and cream.
- Any free OpenRouter model is permitted. Verify current chat and structured-output support before selecting one; the originally named Recraft model is not mandatory.
- Keep `OPENROUTER_API_KEY` in the root `.env`, passed to the backend at runtime. Never put it in browser code, generated assets, logs, or the image.
- Verify current supported library versions using official sources during implementation; update configuration and lockfiles together. No dependency versions or provider capabilities were verified during Part 1.
- Keep implementation simple. Diagnose failures with evidence before fixing them. Record actual validation results and any checks that could not be run.

## Baseline at Part 1

The inspected frontend uses Next.js 14.2.15, React 18.3.1, TypeScript, and global CSS. `KanbanBoard.tsx` holds a demo board in React state, so reload resets it. `lib/board.ts` defines cards (`id`, `title`, `details`) and five seeded columns: Backlog, To do, In progress, Review, Done.

Existing interactions are card creation/deletion, column renaming, and native drag/drop between columns. Card editing, login, backend, Docker packaging, persistence, and chat are missing. Four Vitest helper tests exist; component and browser integration tests are absent. Next.js is not configured for static export. CSS currently loads Google Fonts externally.

## Part 1: Plan

- [x] Read root instructions and original plan; inspect frontend source, configuration, and tests.
- [x] Record the user's color, SQLite JSON, and free-model decisions.
- [x] Expand all parts into checklists with tests and success criteria.
- [x] Create `frontend/AGENTS.md` describing existing code and working conventions.
- [x] Obtain user approval of this plan before Part 2.

Validation: compare documentation against inspected code and agreed requirements; no application tests are required for documentation-only changes.

Success: both documents were reviewed and the user approved proceeding to Part 2 on 2026-11-16.

## Part 2: Scaffolding

- [x] Create `backend/` with a small FastAPI app, Python project metadata, and a `uv` lockfile.
- [x] Serve example HTML at `/` and JSON at `/api/health`; the example page calls the health endpoint.
- [x] Add Docker/Compose configuration for one app service and a persistent database volume.
- [x] Exclude `.env`, databases, caches, dependencies, and Git data from the image build context.
- [x] Add Windows PowerShell and macOS/Linux shell start/stop scripts in `scripts/`, following directory instructions. Use Compose and preserve data on stop.
- [x] Keep README setup/run/test instructions minimal; document environment settings without secrets.

Tests:

- [x] Backend tests verify HTML and health JSON responses.
- [x] Build/start the container and verify the page's same-origin API call succeeds.
- [x] Check script syntax and start/stop behavior on available platforms; record unavailable platform checks.
- [x] Confirm stop/start retains the mounted data directory.

Success: scripts start and stop the local container, HTML and API work, and stopping does not delete persistent data.

Completed 2026-11-16. See `docs/PART2_VALIDATION.md` for actual results and platform limitations. The original scaffold was subsequently replaced by the Part 3 board at http://localhost:8000.

## Part 3: Frontend integration and presentation

- [x] Review supported frontend/tooling versions and update dependencies/configuration for a reproducible static build.
- [x] Configure static export and a frontend Docker build stage. Serve exported assets through FastAPI while preserving API routing and correct missing-resource responses; no final Node runtime is needed.
- [x] Replace example HTML with the demo Kanban at `/`.
- [x] Refine layout, typography, narrow-screen behavior, and focus states using the root palette. Prefer local/system fonts if needed to avoid external font loading.
- [x] Add card title/details editing with explicit save/cancel. Preserve create/delete, column rename, counts, and cross-column drag/drop.

Tests:

- [x] Extend helper tests for editing, no-op/invalid moves, and preserving untouched data.
- [x] Add component tests for create/edit/cancel/delete, rename, counts, and movement.
- [x] Run frontend tests, TypeScript checking, configured lint, and production export; adjust lint tooling if required by the chosen Next.js version.
- [x] Test exported HTML/assets through FastAPI and Docker; browser-test core interactions and actual drag/drop.
- [x] Inspect wide/narrow layouts and keyboard access to forms.

Success: the container serves the interactive demo, including editing, with the agreed palette and passing checks. Persistence comes in Part 7.

Completed 2026-11-16. See `docs/PART3_VALIDATION.md` for results, test commands, and a manual checklist. User subsequently approved Part 4.

## Part 4: Dummy sign-in

- [x] Add backend login/logout/current-session endpoints; check fixed credentials on the server.
- [x] Use a simple server-validated session cookie with HttpOnly and SameSite settings suitable for local HTTP; configure signing through server environment settings.
- [x] Show login before the board; restore authenticated sessions on reload and clear private UI state on logout.
- [x] Provide a reusable authentication dependency for future board/chat APIs. Static UI assets remain public; apply the dependency to user data routes when introduced in Parts 6 and 9.

Tests:

- [x] Test valid/invalid credentials, missing/tampered session cookies, session lookup, and logout cookie clearing.
- [x] Component/browser tests cover errors, successful login, reload, and logout.
- [x] Verify session data requires authentication and the reusable dependency protects a test-only data route. Repeat data ownership checks when board/chat APIs are added.

Success: only the MVP credentials grant access, session restoration works, and logout returns the UI to login.

Completed 2026-11-16. See `docs/PART4_VALIDATION.md` for test results and manual checks. User subsequently approved Part 5.

## Part 5: Database modeling and approval

- [x] Write `docs/DATABASE.md` proposing users and boards tables, primary/foreign keys, ownership, and one-board-per-user uniqueness.
- [x] Define board JSON preserving stable column/card IDs, titles/details, column order, and card order. Keep ownership outside client-controlled JSON.
- [x] Define validation: fixed column IDs, unique card IDs, valid text fields, and valid move destinations.
- [x] Document first-run user/board seeding and SQLite path within the mounted volume.
- [x] Propose transactional updates and a simple board revision check to prevent stale manual/AI writes.
- [x] Include example JSON and explain initialization, persistence, and deletion behavior.
- [x] Obtain user approval before Part 6. These schema details remain proposals until approved.

Validation: walk through every card operation, column rename, a second hypothetical user, stale writes, and container restart against the design.

Success: the approved design stores board JSON in SQLite, supports future user ownership, and avoids unnecessary card/column tables.

Proposal prepared in `docs/DATABASE.md`, with the full seed example in `docs/board.example.json`. Reviewed against existing code and the documented scenarios. User approved proceeding to Part 6 on 2026-11-16. Part 5 changed documentation only.

## Part 6: Persistent backend API

- [x] Implement the approved schema and idempotent initialization/seeding when the database does not exist.
- [x] Resolve database user ownership from authenticated identity, never a client-supplied user ID.
- [x] Add authenticated board read/update endpoints using validated whole-board JSON updates to keep the API small.
- [x] Enforce column/card invariants, ownership, transactions, and revision conflict checks.
- [x] Return consistent validation/authentication/conflict errors without partial writes.

Tests:

- [x] Use temporary SQLite databases for fresh/repeated startup, seeding, round trips, and rejected-write rollback.
- [x] Persist every supported card operation and column rename through API tests.
- [x] Test invalid structures, changed fixed columns, duplicate IDs, missing authentication, and stale revisions.
- [x] Seed a second test user and verify read/write isolation.

Success: valid updates survive reopening SQLite; rejected requests preserve stored data and cannot affect another user's board.

Completed 2026-11-16. See `docs/PART6_VALIDATION.md`: 73 backend tests, 10 browser auth regression checks, and live API persistence through container stop/start passed. User subsequently approved Part 7.

## Part 7: Frontend and persistent backend

- [x] Replace demo initialization with authenticated API loading and canonical server board/revision state.
- [x] Persist create/edit/delete/move and column renames; commit renames rather than saving every keystroke.
- [x] Keep shared board state for later chat integration and serialize or disable overlapping saves.
- [x] Show loading/save errors, retain recoverable failed edits, and reload server state on revision conflicts.
- [x] Return to login and clear private board/chat state when authentication expires.

Tests:

- [x] Component/API tests cover load/save, failed saves, conflicts, and expired sessions.
- [x] Browser tests perform all board operations and reload to verify persistence.
- [x] Restart the container and log out/in; verify saved data remains.

Success: all board interactions persist through FastAPI/SQLite, and failed saves are not presented as successful.

Completed 2026-11-16. See `docs/PART7_VALIDATION.md`: 41 frontend tests, 73 backend tests, 30 browser checks (2 intentional skips), and browser-created card persistence through full container stop/start passed. Part 8 has not started.

## Part 8: OpenRouter connectivity

- [ ] Consult official documentation/model metadata for a currently available free chat model with Part 9 structured-output support.
- [ ] Configure the backend model and runtime API key; document selected model and verification date.
- [ ] Add a small backend OpenRouter client with timeouts and useful errors, without logging credentials.
- [ ] Run an explicit live `2+2` check, separately from routine tests.

Tests:

- [ ] Mock successful responses, missing credentials, timeouts, rate limits, and provider errors.
- [ ] Verify a real call to the chosen free model answers `4`; record results without secrets.

Success: real backend connectivity works with a free model; ordinary tests need neither network nor API key. If no suitable free model is available, document the evidence and resolve the blocker before claiming completion.

## Part 9: Structured AI board updates

- [ ] Add an authenticated chat endpoint accepting a user message, conversation history, and board revision.
- [ ] Load the canonical board from SQLite and send its JSON, message, and bounded history to OpenRouter.
- [ ] Define structured output with assistant text and an optional complete updated board. Preserve fixed columns and unchanged IDs; support multiple create/edit/move actions per request.
- [ ] Validate structured responses and proposed board state before writing. Commit valid changes atomically using the revision read before the AI call.
- [ ] Reject stale/invalid updates without changing storage; return canonical saved board/revision for successful changes.
- [ ] Keep chat history in browser-session memory for the MVP, bounded by message/history limits; clear it on logout. No chat database tables are required.

Tests:

- [ ] Mock answer-only replies and single/multiple create/edit/move actions, including combinations.
- [ ] Test malformed output, duplicate IDs, changed columns, provider errors, unauthorized requests, and stale revisions after concurrent edits.
- [ ] Verify rejected responses preserve the board and valid multi-card changes commit together.
- [ ] Run a separate live structured-output smoke test for an answer and a board update.

Success: AI replies and validated multi-card changes work for the authenticated user's board without overwriting newer edits.

## Part 10: Chat sidebar and final verification

- [ ] Build a responsive sidebar with history, input, submit, pending, and error states using the agreed palette.
- [ ] Connect authenticated chat and prevent duplicate pending submissions.
- [ ] Apply returned canonical board/revision immediately to shared board state after AI changes.
- [ ] Provide errors/conflict feedback and explicit retry, retaining drafts where useful; do not silently repeat writes.
- [ ] Render assistant text safely, support labels/focus/keyboard access, and clear chat on logout.
- [ ] Update minimal run/test documentation and record validation results and untested platforms in `docs/`.

Tests:

- [ ] Component tests cover history/submission, pending state, errors/retry, answer-only replies, and board refresh.
- [ ] Browser tests cover login, persistent manual edits, mocked AI multi-card changes, reload, and logout.
- [ ] Run backend/frontend suites, type/lint checks, production build, and Docker smoke checks.
- [ ] Perform a separate live end-to-end AI check and inspect desktop/narrow layouts and keyboard interactions.

Success: users manage a persistent board manually and through chat, see AI changes immediately, and retain board data across container restarts. Report actual check results and limitations.

