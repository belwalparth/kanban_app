# Frontend instructions

Read the root `Agents.md` and `docs/Plan.md` before changes. Follow the approved part of the plan. This describes the Part 20 frontend; update it as implementation changes.

## Part 20 collaboration behavior

- `components/ShareDialog.tsx` and `lib/sharing-api.ts`: owner-only sharing, single-display invitation links/copy fallback, pending revocation, member listing and explicit removal confirmation. Native modal traps focus, supports Escape, and restores focus after the launcher is enabled. API authorization is authoritative.
- `components/InvitationLanding.tsx`: signed-in inspection before showing the board name, explicit acceptance, generic unavailable/wrong-account recovery, and account switching. `AuthGate` captures `#invite=...`, strips it from history, and retains only the pending token in tab session storage through Google navigation. Clear it on acceptance/dismissal. Never put invite tokens in request URLs, board JSON, analytics or logs.
- Metadata reports owner/member role. Joined boards show `(Shared)` and omit rename/share actions; normal sign-in still chooses the first owned board unless a board URL or accepted invitation selects another.
- Focus checks read the selected board without applying a response over an open card/column draft or pending request. A mutation version prevents older focus responses from overwriting newer saves. A 404 clears the inaccessible board and its chat memory, releases workspace locks and chooses an accessible board. Ignore late memory updates from inaccessible views.
- Conflicted card/column drafts remain for explicit retry/cancel after canonical reload. Do not remount column inputs on revision changes. Missing/deleted cards cannot be recreated by stale edits; current card location is resolved by ID before explicit retry. Failed column saves require Enter or a changed draft before another attempt; blur alone must not retry.
- `components/Sharing.test.tsx` covers sharing, invitation persistence/account recovery, role controls, focus/draft safety and removal cleanup. `e2e/sharing-real.spec.ts` uses separate synthetic sessions with real API/SQLite storage on localhost:8003; opt in with `KANBAN_SHARING_E2E=1`. `backend/tests/browser_server.py` creates disposable identities/cookies for this fixture and is excluded from the runtime image. See `docs/PART20_VALIDATION.md` for reproduction.
- Sharing requires schema 4, released to production in Part 21 on 2026-11-23 after migration rehearsal and hosted synthetic verification. Real three-account Google acceptance remains pending; see `docs/PART21_VALIDATION.md`. Coordinate future migrations and deployments before pushing to the deployment branch.

## Existing code

- Next.js 16.4.6 App Router, React 19.3.1, TypeScript 6.0.3, and plain global CSS. Dependencies/scripts are in `package.json`; `package-lock.json` records exact versions for `npm ci`. Use Node.js 24 or newer.
- `app/layout.tsx`: HTML layout, metadata, and global CSS import.
- `app/page.tsx`: renders `AuthGate` inside the page shell.
- `components/AuthGate.tsx`: checks the server session on load/window focus, gates board rendering, and handles logout/retry. A version ref prevents older session responses from undoing login/logout. Unmounting the board clears its local state.
- `components/SignIn.tsx`: labeled username/password form with pending/error states and demo credential guidance. The backend validates credentials.
- `lib/auth.ts`: same-origin login/session/logout fetch calls; session cookies are HttpOnly and never stored in browser storage.
- `lib/board-api.ts`: authenticated list/create/rename and board-specific reads/replacements under `/api/boards`, with metadata types, revision envelopes, and typed HTTP status errors. Optional legacy helpers remain for compatibility checks.
- `lib/use-board.ts`: single canonical board/revision state for the selected `BoardView`. Serializes manual/AI work, reports immediate operation locks and canonical revisions to the workspace, reloads conflicts, and ignores responses after that view unmounts. Do not introduce a second independent board state for chat.
- `lib/chat-api.ts`: same-origin `/api/boards/{id}/chat` calls with current revision and at most 20 history entries. No automatic retries. `ChatMemory` holds only per-board in-session UI data.
- `components/ChatSidebar.tsx`: on-demand native dialog with bounded history, draft/errors/notices, plain-text replies, and focus restoration. Memory is retained per board by the signed-in workspace; closing/reopening or switching back restores it. Logout, expiry, account change, and page reload clear it.
- `app/globals.css`: palette, system fonts, compact board controls, five desktop columns with responsive wrapping, modal styles, visible focus, and reduced-motion rules.
- `components/KanbanBoard.tsx`: workspace shell with owned-board metadata, compact selector, create/rename forms, `?board=<id>` history, and per-board chat memory. Immediate lock refs prevent switches during pending mutations/open edits; browser history navigation is queued until they finish or are cancelled. The keyed `BoardView` prevents obsolete responses from replacing another board.
- `components/BoardView.tsx`: selected-board card/drag/editor state, CRUD, column rename, progress, announcements, and AI dialog. Remounts on selection or a board-name revision refresh; canonical content comes only from the selected board API.
- `components/CardEditor.tsx`: native modal dialog with title/details/column fields, async save feedback, and retained drafts on failure/conflict. Pending saves disable inputs and dismissal. An error offers explicit canonical reload without discarding the draft.
- `components/ColumnTitle.tsx`: local rename draft; Enter/blur commits, Escape cancels. Reports dirty drafts to prevent accidental board switching; cleanup after canonical conflict reload clears obsolete draft locks.
- `lib/board.ts`: `Card`/`Column` types, seeded data, ID generation, and immutable add/edit/delete/rename/move helpers.
- `lib/board.test.ts` and `components/KanbanBoard.test.tsx`: helper and user interaction tests.
- `vitest.config.ts` / `vitest.setup.ts`: jsdom, Testing Library, alias resolution, current Vite Oxc JSX transform, and a dialog lifecycle shim for jsdom. Browser focus behavior is covered by Playwright.
- `components/AuthGate.test.tsx`: login, session restoration, pending/errors, logout cleanup, focus checks, and stale response regression coverage.
- `components/BoardWorkspace.test.tsx`: creation/rename failures, selection/history, per-board AI memory, pending switch races, obsolete loads, and all-board memory cleanup on account changes.
- `test/board-server.ts`: isolated mocked API state for component tests. Test data does not initialize the production board.
- `e2e/fixtures.ts`: per-test shared mock board store for normal desktop/mobile checks; authentication uses the running backend. `e2e/board-errors.spec.ts` covers save failures, conflicts, retry, and expiry. `e2e/chat.spec.ts` covers mocked chat updates, history, pending/retry, conflicts/expiry, keyboard access, and layout. `e2e/live-chat.spec.ts` is an explicit live-provider check, gated by `KANBAN_LIVE_AI=1`, desktop project, and base URL `http://localhost:8001`; use a disposable database only.
- `e2e/persistence.spec.ts`: a desktop check against the real board API. Uses a unique temporary card and cleans up only that card. Never reset the user's board to test defaults. Mobile skips this duplicate real-data check and native drag/drop; touch movement is tested through the editor.
- `e2e/boards.spec.ts`: desktop/mobile board selection, create/rename, history/reload, AI memory, pending AI navigation, unavailable links, and keyboard/long-name layout. `e2e/boards-persistence.spec.ts` is gated by `KANBAN_DISPOSABLE_E2E=1`, desktop, and localhost:8002; it creates a board only in a disposable database.
- `playwright.config.ts`: `PLAYWRIGHT_BASE_URL` overrides `http://localhost:8000`; `PLAYWRIGHT_CHANNEL=chrome` uses installed Chrome.
- `next.config.mjs`: static export in production, strict mode, and development-only `/api/*` proxy to FastAPI on port 8000. Docker copies `out/` to FastAPI's static directory; no production Node server.
- `eslint.config.mjs`: flat configuration with Next.js core-web-vitals and TypeScript rules.
- `tsconfig.json`: TypeScript configuration and `@/` import alias.

## Current behavior and gaps

Five fixed column IDs: `backlog`, `todo`, `in-progress`, `review`, `done`. Display titles are editable. Cards have `id`, `title`, and `details`. Moves append to the destination; same-column drops do nothing.

Sign-in options come from `/api/auth/config`: Google when configured, and `user` / `password` only in explicit local demo mode. Sessions use an eight-hour backend-signed cookie and an internal user ID. The workspace lists owned-board metadata, then loads only the selected board through `/api/boards/{id}`. Without a selection URL it opens the first board; invalid/foreign selections offer recovery without loading another board silently. Create selects the confirmed new board; rename uses the selected metadata revision. Board/AI saves apply canonical responses to that board only. Switches and management actions are locked during pending work or open drafts; browser Back/Forward waits instead of discarding edits. Logout/expiry/account changes unmount the workspace and all private board/chat state. No board JSON or chat history is stored in browser storage.

`ChatSidebar.tsx` now renders an on-demand native modal dialog, launched by **Board assistant** above the columns. It stays mounted to retain drafts/history on close, restores launcher focus, and supports Escape. All five columns fit on desktop; smaller screens wrap columns without horizontal scrolling. Do not restore the permanent sidebar or a fixed minimum board width.

All supported operations save through the same board/revision state. Do not show optimistic data as committed: apply the canonical API response on success. Retain failed card/rename drafts and leave failed deletes/moves unchanged. On 409, load the current server board without replaying the edit; if loading fails, block edits until reload succeeds. A 401 returns the app to sign-in. `DEFAULT_COLUMNS` is a test reference, not a production loading fallback.

## Commands

Run from `frontend/`:

- `npm ci`: install locked dependencies.
- `npm run dev`: development server; requires Docker/FastAPI on port 8000 for auth API calls.
- `npm run build`: production export to `out/`; start the container via root scripts to serve through FastAPI.
- `npm run test:run`: single Vitest run; `npm test` starts watch mode.
- `npm run typecheck`: TypeScript check.
- `npm run lint`: ESLint CLI; Next.js no longer runs lint as part of its build.
- `npm run test:e2e`: Playwright tests; requires a running app and installed Chromium/Chrome.

Current validation and manual checks are in `docs/PART21_VALIDATION.md` and `docs/GOOGLE_SIGN_IN.md`; prior parts document earlier milestones. The collaboration frontend requires schema 4 and its matching backend, now deployed; real Google collaboration acceptance remains pending.

## Change conventions

- Keep the existing structure simple; separate pure board transformations from UI/network requests.
- Preserve stable IDs and five fixed columns. Add title/details editing; renaming a column must not change its ID.
- Use yellow `#ecad0a`, blue `#209dd7`, purple `#753991`, navy `#032147`, and gray `#888888` in the roles specified by root instructions. Brown and cream are superseded.
- Preserve labels, focus states, readable forms, narrow-screen usability, and reduced-motion support.
- Target static export served by FastAPI. Authentication, SQLite, and OpenRouter belong in the backend. Never expose `.env` secrets in browser code.
- Add meaningful helper/component tests for changed behavior and browser integration checks for actual drag/drop, login, persistence, and chat as introduced.
- Verify supported dependency versions with official sources during implementation. Diagnose failures before fixes; report checks that were not run.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
