# Project Management MVP plan

## Agreed decisions and scope

- Completed local MVP: one Docker container where FastAPI serves the statically exported Next.js UI and `/api/*`; SQLite lives in a persistent Docker volume. Use `uv` for Python dependencies. Retain this local development option.
- Next release (requested 2026-11-18): add Google sign-in and deploy the app on Vercel. Google authentication replaces the shared `user` / `password` login in production. Each Google user owns one private board, created on first sign-in; no board switching or password registration.
- Deployment target: Vercel-hosted frontend and FastAPI API with same-origin `/api/*` routing, plus managed PostgreSQL for durable production storage. Vercel function storage cannot replace the local SQLite volume. Verify current Vercel Python/runtime, routing, and execution limits before choosing the exact project configuration in Part 11.
- Store each board as JSON inside SQLite, rather than in a JSON file.
- Preserve the existing five column IDs. Columns can be renamed, but not added, deleted, or reordered. Support card creation, title/details editing, deletion, and cross-column movement. Moves append to the destination; no card reordering feature is required.
- Use root `Agents.md` colors: yellow `#ecad0a`, blue `#209dd7`, purple `#753991`, navy `#032147`, and supporting gray `#888888`. This supersedes brown and cream.
- Any free OpenRouter model is permitted. Verify current chat and structured-output support before selecting one; the originally named Recraft model is not mandatory.
- Keep local secrets in the root `.env`, passed to the backend at runtime. Configure production secrets in Vercel environment settings. Never put `OPENROUTER_API_KEY`, Google client secrets, session secrets, or database credentials in browser code, generated assets, logs, or the image.
- Verify current supported library versions using official sources during implementation; update configuration and lockfiles together. No dependency versions or provider capabilities were verified during Part 1.
- Keep implementation simple. Diagnose failures with evidence before fixing them. Record actual validation results and any checks that could not be run.git

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

Completed 2026-11-16. See `docs/PART7_VALIDATION.md`: 41 frontend tests, 73 backend tests, 30 browser checks (2 intentional skips), and browser-created card persistence through full container stop/start passed. User subsequently approved Part 8.

## Part 8: OpenRouter connectivity

- [x] Consult official documentation/model metadata for a currently available free chat model with Part 9 structured-output support.
- [x] Configure the backend model and runtime API key; document selected model and verification date.
- [x] Add a small backend OpenRouter client with timeouts and useful errors, without logging credentials.
- [x] Run an explicit live `2+2` check, separately from routine tests.

Tests:

- [x] Mock successful responses, missing credentials, timeouts, rate limits, and provider errors.
- [x] Verify a real call to the chosen free model answers `4`; record results without secrets.

Success: real backend connectivity works with a free model; ordinary tests need neither network nor API key. If no suitable free model is available, document the evidence and resolve the blocker before claiming completion.

Completed 2026-11-17 using `inclusionai/ling-3.2-flash:free`. Live arithmetic returned integer 4 in valid structured JSON. Final backend suite: 104 passed with mocked provider calls. See `docs/PART8_VALIDATION.md`. User subsequently approved Part 9; its fuller contract validation selected a different free model.

## Part 9: Structured AI board updates

- [x] Add an authenticated chat endpoint accepting a user message, conversation history, and board revision.
- [x] Load the canonical board from SQLite and send its JSON, message, and bounded history to OpenRouter.
- [x] Define structured output with assistant text and an optional complete updated board. Preserve fixed columns and unchanged IDs; support multiple create/edit/move actions per request.
- [x] Validate structured responses and proposed board state before writing. Commit valid changes atomically using the revision read before the AI call.
- [x] Reject stale/invalid updates without changing storage; return canonical saved board/revision for successful changes.
- [x] Accept bounded client-held history without storing it in database tables. Browser session history and logout clearing will be wired with the sidebar in Part 10.

Tests:

- [x] Mock answer-only replies and single/multiple create/edit/move actions, including combinations.
- [x] Test malformed output, duplicate IDs, changed columns, provider errors, unauthorized requests, and stale revisions after concurrent edits.
- [x] Verify rejected responses preserve the board and valid multi-card changes commit together.
- [x] Run a separate live structured-output smoke test for an answer and a board update.

Success: AI replies and validated multi-card changes work for the authenticated user's board without overwriting newer edits.

Completed 2026-11-17. Final backend suite: 147 passed with networking disabled. Live answer-only and combined create/edit/move checks passed using `nvidia/nemotron-3.5-super-vl:free` and a disposable synthetic database. See `docs/PART9_VALIDATION.md`. User subsequently approved Part 10.

## Part 10: Chat sidebar and final verification

- [x] Build a responsive sidebar with history, input, submit, pending, and error states using the agreed palette.
- [x] Connect authenticated chat and prevent duplicate pending submissions.
- [x] Apply returned canonical board/revision immediately to shared board state after AI changes.
- [x] Provide errors/conflict feedback and explicit retry, retaining drafts where useful; do not silently repeat writes.
- [x] Render assistant text safely, support labels/focus/keyboard access, and clear chat on logout.
- [x] Update minimal run/test documentation and record validation results and untested platforms in `docs/`.

Tests:

- [x] Component tests cover history/submission, pending state, errors/retry, answer-only replies, and board refresh.
- [x] Browser tests cover login, persistent manual edits, mocked AI multi-card changes, reload, and logout.
- [x] Run backend/frontend suites, type/lint checks, production build, and Docker smoke checks.
- [x] Perform a separate live end-to-end AI check and inspect desktop/narrow layouts and keyboard interactions.

Success: users manage a persistent board manually and through chat, see AI changes immediately, and retain board data across container restarts. Report actual check results and limitations.

Completed 2026-11-17. Backend: 147 passed with networking disabled. Frontend: 55 passed; lint, typecheck, and production export passed. Browser: 40 passed, 4 intentional skips; separate live AI browser check passed against a disposable container, including exact combined create/edit/move validation and persistence through its restart. See `docs/PART10_VALIDATION.md` for checks, isolation, and platform limits.

## Part 11: Google authentication and Vercel architecture

Parts 1-10 describe the completed local MVP. Parts 11-15 are planned work; the new production requirements supersede the earlier local-only and shared-login limitations.

- [x] Verify current official Vercel guidance for deploying the static Next.js frontend and Python FastAPI API, including project roots, build outputs, `/api/*` routing, supported Python versions, lifespan behavior, and function duration limits. Record the supported configuration before implementation.
- [x] Keep FastAPI responsible for authentication, board storage, and OpenRouter calls. Preserve same-origin browser API requests and keep frontend routing from swallowing API or OAuth callback routes.
- [x] Select managed PostgreSQL with serverless-compatible connections; document provider setup, connection limits, and separate development/preview/production databases. Retain SQLite for local Docker use without changing board JSON or revision behavior.
- [x] Select a maintained Python Google OpenID Connect integration using authorization code flow with state, nonce, and PKCE. Verify library and provider support using current official documentation.
- [x] Document Google OAuth consent-screen setup, required `openid email profile` scopes, test-user behavior, and exact callback paths for localhost and stable preview/production hostnames. Cloud hostnames remain explicit placeholders until account setup; test-user lists do not restrict basic identity scopes.
- [x] Document server-only settings: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `APP_BASE_URL`, `DATABASE_URL`, and existing OpenRouter settings. Production requires configured secrets and HTTPS; no generated per-instance session secret or shared-password fallback.
- [x] Update `docs/DATABASE.md` with identity and PostgreSQL migration details before implementation. Keep historical validation documents unchanged.

Validation: review the proposed hosting configuration against official platform documentation and trace sign-in, callback, authenticated board/chat requests, and durable writes across function instances. Record verified capabilities and unresolved account/setup prerequisites in `docs/`.

Success: a documented, supported deployment architecture and Google callback configuration, with production storage and authentication requirements defined.

Completed 2026-11-18. See `docs/AUTH_DEPLOYMENT.md` for the selected single-project FastAPI/static-export Vercel architecture, Neon/Psycopg storage, Authlib Google flow, environment contract, and setup instructions. `docs/DATABASE.md` adds the planned identity/OAuth-state schema and migration behavior. See `docs/PART11_VALIDATION.md` for official sources, design walkthroughs, and checks still requiring implementation/account access. No runtime code or cloud resources changed.

## Part 12: Durable production storage and Google identities

- [ ] Add the PostgreSQL connection path and explicit schema migration/setup command; do not run destructive migrations during function startup. Preserve SQLite support for local Docker development.
- [ ] Add a unique Google identity keyed by validated issuer and subject (`iss`, `sub`) linked to the internal user ID. Store display name/email only as profile information; never match or merge accounts by email alone.
- [ ] Create the user identity and its initial board transactionally on the first successful Google sign-in. Concurrent or repeated callbacks must not create duplicate identities/boards or reset saved data.
- [ ] Resolve authenticated sessions through the internal user ID. Keep ownership outside client-controlled board JSON and apply it to board and chat operations.
- [ ] Preserve atomic whole-board writes, validation, and conditional revision updates on both databases. Keep provider calls outside database transactions.
- [ ] Define the existing demo board migration explicitly: back up SQLite, preserve JSON and revisions, and import into a deliberately selected Google account through an operator command if wanted. Never assign the shared demo board to the first public sign-in automatically.

Tests:

- [ ] Run storage integration tests against SQLite and an isolated PostgreSQL database for initialization, rollback, uniqueness, ownership, and stale revisions.
- [ ] Test repeated/concurrent first sign-ins, two Google identities, changed email for the same subject, and the same email on different subjects.
- [ ] Verify production data survives new connections, function restarts, and redeployment; verify any migration against a disposable database before importing real data.

Success: each Google identity has exactly one isolated, durable board; saved data and conflict protection survive deployment lifecycle changes.

## Part 13: Google sign-in and authenticated sessions

- [ ] Add Google sign-in start/callback endpoints and replace the production login form with a clearly labeled Google sign-in action. Keep demo credentials available only through explicit local development configuration, disabled in production.
- [ ] Validate OAuth state, nonce, PKCE, token signature, issuer, audience, and expiration using the selected library. Reject replayed/mismatched callbacks and restrict post-login redirects to approved application paths. Request no Google API scopes or offline refresh tokens beyond sign-in needs.
- [ ] Establish an expiring app session after verified sign-in and clear the temporary OAuth state. Keep provider tokens out of browser storage and app session payloads.
- [ ] Configure HttpOnly, Secure production cookies and SameSite behavior compatible with Google's callback. Protect cookie-authenticated mutation endpoints, including logout, against CSRF through an explicit origin/token strategy.
- [ ] Keep session lookup and logout behavior, restore sessions on reload, and clear private board/chat state on logout or expiration. App logout clears the app session without signing the user out of Google.
- [ ] Require authenticated ownership on every board/chat route. Preserve no-store responses for session and private data; static UI assets can remain public.
- [ ] Handle cancelled consent, provider errors, expired sessions, and unavailable configuration with clear retry behavior and no credential/token logging.

Tests:

- [ ] Mock Google authorization/token responses for success, cancellation, invalid/replayed state, nonce mismatch, bad/expired tokens, provider failure, and unsafe redirect attempts.
- [ ] Verify cookie attributes, expiration, tampering rejection, logout, CSRF rejection, and disabled demo login in production configuration.
- [ ] Verify two signed-in users cannot read, manually edit, or AI-edit each other's boards; unauthenticated board/chat calls return 401.
- [ ] Component/browser tests cover sign-in navigation, callback errors, session restoration, logout, expiration, and private-state clearing. Use mocked identity flows in routine tests; perform real Google sign-in separately with a test account.

Success: verified Google users can sign in, resume their own board, and sign out securely; production never grants access through the shared MVP password.

## Part 14: Vercel configuration and preview deployment

- [ ] Add the verified Vercel build/entrypoint/routing configuration for frontend and FastAPI. Adjust Python/dependency configuration to supported runtimes and verify the backend's `uv` dependency installation path.
- [ ] Configure database connections and app initialization for short-lived/concurrent function instances. No production database file, identity, or session state may depend on an instance's memory or filesystem.
- [ ] Configure server-side OpenRouter timeout and function duration so AI requests fit platform limits and failures leave the board unchanged. Return useful errors without silently replaying writes.
- [ ] Prepare separate preview and production secrets/databases, Google callback registrations, and stable `APP_BASE_URL` values. Keep preview traffic isolated from production boards.
- [ ] Document a minimal deployment procedure, schema migration step, Google setup, environment variables, and rollback procedure in `docs/`; keep README concise.
- [ ] Run all local checks and prepare a reviewable deployment configuration. When account access/settings are available, deploy a preview and configure its stable callback URL.

Tests:

- [ ] Run backend/frontend suites, lint, TypeScript checks, and production builds; retain local Docker sign-in/board/chat regression coverage.
- [ ] Verify preview `/`, static assets, `/api/health`, auth/callback routes, and missing-resource behavior over HTTPS.
- [ ] Verify session continuity across function instances, cookie forwarding, no caching of private responses, and durable board writes with PostgreSQL.
- [ ] Run a separate preview AI smoke test and confirm provider failures/timeouts and revision conflicts preserve saved state.

Success: a working HTTPS preview supports Google authentication and persistent manual/AI board updates using external storage and server-only secrets.

## Part 15: Production release and verification

- [ ] Configure the final Vercel production hostname, Google authorized callback, consent-screen publishing requirements, production database, and production environment settings.
- [ ] Back up any data being migrated, apply verified migrations, and deploy the tested release. Keep existing local data intact unless an explicit import is performed.
- [ ] Complete a real Google sign-in smoke test with two accounts: create/edit/move cards, rename columns, use AI, reload, sign out/in, and verify account isolation. Record any checks requiring interactive account access as pending until performed.
- [ ] Verify saved boards survive a new deployment and concurrent manual/AI edits still return conflicts without lost writes.
- [ ] Verify production error logging excludes secrets and tokens; document database backup/restore and app rollback steps, including schema compatibility.
- [ ] Record deployed URL, actual check results, deployment/runtime limits, and remaining limitations in `docs/PART15_VALIDATION.md`.

Success: the production Vercel app supports Google sign-in and private persistent boards with working chat; deployment and data recovery procedures are documented and verified where access permits.

