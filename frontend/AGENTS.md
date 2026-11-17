# Frontend instructions

Read the root `Agents.md` and `docs/Plan.md` before changes. Follow the approved part of the plan. This describes the Part 10 frontend; update it as implementation changes.

## Existing code

- Next.js 16.4.6 App Router, React 19.3.1, TypeScript 6.0.3, and plain global CSS. Dependencies/scripts are in `package.json`; `package-lock.json` records exact versions for `npm ci`. Use Node.js 24 or newer.
- `app/layout.tsx`: HTML layout, metadata, and global CSS import.
- `app/page.tsx`: renders `AuthGate` inside the page shell.
- `components/AuthGate.tsx`: checks the server session on load/window focus, gates board rendering, and handles logout/retry. A version ref prevents older session responses from undoing login/logout. Unmounting the board clears its local state.
- `components/SignIn.tsx`: labeled username/password form with pending/error states and demo credential guidance. The backend validates credentials.
- `lib/auth.ts`: same-origin login/session/logout fetch calls; session cookies are HttpOnly and never stored in browser storage.
- `lib/board-api.ts`: authenticated board reads/replacements using the backend revision envelope and typed HTTP status errors.
- `lib/use-board.ts`: single canonical board/revision state owned by the board component. Loads server data and serializes manual saves and AI requests through one immediate in-flight guard. Applies canonical responses, reloads conflicts, blocks writes after uncertain network results until board reload, and reports session expiry. Do not introduce a second independent board state for chat.
- `lib/chat-api.ts`: same-origin authenticated `/api/chat` calls with current revision and at most 20 previous conversation entries. No automatic retries.
- `components/ChatSidebar.tsx`: responsive sidebar (below the board on narrow screens), bounded memory-only history, labeled draft, pending/error/retry states, plain-text replies, and keyboard focus restoration. Successful replies clear the draft; failures retain it. Unmounting on logout/expiry clears history and drafts; page reload also clears them.
- `app/globals.css`: palette, system fonts without external requests, board/card/dialog styles, responsive horizontal scrolling, focus styling, and reduced-motion rules.
- `components/KanbanBoard.tsx`: client component with board/drag/editor state, card CRUD, column rename, completion progress, live announcements, empty states, native HTML cross-column drag/drop, and signed-in username/logout controls.
- `components/CardEditor.tsx`: native modal dialog with title/details/column fields, async save feedback, and retained drafts on failure. Pending saves disable inputs and dismissal. Conflicts close the obsolete draft after attempting a canonical reload.
- `components/ColumnTitle.tsx`: local rename draft; Enter/blur commits, Escape cancels. Blank names restore the saved title; failed saves retain the draft with an error. Reload generation keys discard obsolete rename drafts after conflicts.
- `lib/board.ts`: `Card`/`Column` types, seeded data, ID generation, and immutable add/edit/delete/rename/move helpers.
- `lib/board.test.ts` and `components/KanbanBoard.test.tsx`: helper and user interaction tests.
- `vitest.config.ts` / `vitest.setup.ts`: jsdom, Testing Library, alias resolution, current Vite Oxc JSX transform, and a dialog lifecycle shim for jsdom. Browser focus behavior is covered by Playwright.
- `components/AuthGate.test.tsx`: login, session restoration, pending/errors, logout cleanup, focus checks, and stale response regression coverage.
- `test/board-server.ts`: isolated mocked API state for component tests. Test data does not initialize the production board.
- `e2e/fixtures.ts`: per-test shared mock board store for normal desktop/mobile checks; authentication uses the running backend. `e2e/board-errors.spec.ts` covers save failures, conflicts, retry, and expiry. `e2e/chat.spec.ts` covers mocked chat updates, history, pending/retry, conflicts/expiry, keyboard access, and layout. `e2e/live-chat.spec.ts` is an explicit live-provider check, gated by `KANBAN_LIVE_AI=1`, desktop project, and base URL `http://localhost:8001`; use a disposable database only.
- `e2e/persistence.spec.ts`: a desktop check against the real board API. Uses a unique temporary card and cleans up only that card. Never reset the user's board to test defaults. Mobile skips this duplicate real-data check and native drag/drop; touch movement is tested through the editor.
- `playwright.config.ts`: `PLAYWRIGHT_BASE_URL` overrides `http://localhost:8000`; `PLAYWRIGHT_CHANNEL=chrome` uses installed Chrome.
- `next.config.mjs`: static export in production, strict mode, and development-only `/api/*` proxy to FastAPI on port 8000. Docker copies `out/` to FastAPI's static directory; no production Node server.
- `eslint.config.mjs`: flat configuration with Next.js core-web-vitals and TypeScript rules.
- `tsconfig.json`: TypeScript configuration and `@/` import alias.

## Current behavior and gaps

Five fixed column IDs: `backlog`, `todo`, `in-progress`, `review`, `done`. Display titles are editable. Cards have `id`, `title`, and `details`. Moves append to the destination; same-column drops do nothing.

Sign-in uses `user` / `password` with a backend-signed cookie. Board data loads from SQLite through `/api/board` and persists across reload/logout/restart. Logout/expired sessions unmount private UI; signing in loads the saved board. Chat uses `/api/chat` and applies the returned canonical board immediately. Manual edits, reload, and logout are disabled during AI requests; chat is disabled during manual saves or open card editors. Conflicts retain the chat draft for explicit resubmission after review, without replaying it.

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

Current validation and manual checks are in `docs/PART10_VALIDATION.md`; prior parts document earlier milestones.

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
