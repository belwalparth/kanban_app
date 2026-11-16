# Frontend instructions

Read the root `Agents.md` and `docs/Plan.md` before changes. Follow the approved part of the plan. This describes the Part 4 frontend; update it as implementation changes.

## Existing code

- Next.js 16.4.6 App Router, React 19.3.1, TypeScript 6.0.3, and plain global CSS. Dependencies/scripts are in `package.json`; `package-lock.json` records exact versions for `npm ci`. Use Node.js 24 or newer.
- `app/layout.tsx`: HTML layout, metadata, and global CSS import.
- `app/page.tsx`: renders `AuthGate` inside the page shell.
- `components/AuthGate.tsx`: checks the server session on load/window focus, gates board rendering, and handles logout/retry. A version ref prevents older session responses from undoing login/logout. Unmounting the board clears its local state.
- `components/SignIn.tsx`: labeled username/password form with pending/error states and demo credential guidance. The backend validates credentials.
- `lib/auth.ts`: same-origin login/session/logout fetch calls; session cookies are HttpOnly and never stored in browser storage.
- `app/globals.css`: palette, system fonts without external requests, board/card/dialog styles, responsive horizontal scrolling, focus styling, and reduced-motion rules.
- `components/KanbanBoard.tsx`: client component with board/drag/editor state, card CRUD, column rename, completion progress, live announcements, empty states, native HTML cross-column drag/drop, and signed-in username/logout controls.
- `components/CardEditor.tsx`: native modal dialog with labeled title/details fields, a column selector for keyboard/touch movement, save/create, cancel, and Escape dismissal.
- `lib/board.ts`: `Card`/`Column` types, seeded data, ID generation, and immutable add/edit/delete/rename/move helpers.
- `lib/board.test.ts` and `components/KanbanBoard.test.tsx`: helper and user interaction tests.
- `vitest.config.ts` / `vitest.setup.ts`: jsdom, Testing Library, alias resolution, current Vite Oxc JSX transform, and a dialog lifecycle shim for jsdom. Browser focus behavior is covered by Playwright.
- `components/AuthGate.test.tsx`: login, session restoration, pending/errors, logout cleanup, focus checks, and stale response regression coverage.
- `e2e/auth.spec.ts`, `e2e/board.spec.ts`, and `playwright.config.ts`: desktop/mobile Chromium tests against Docker, including login/logout and actual desktop drag/drop. Board tests authenticate through the API; auth tests use the real form. `PLAYWRIGHT_BASE_URL` overrides `http://localhost:8000`; `PLAYWRIGHT_CHANNEL=chrome` uses installed Chrome.
- `next.config.mjs`: static export in production, strict mode, and development-only `/api/*` proxy to FastAPI on port 8000. Docker copies `out/` to FastAPI's static directory; no production Node server.
- `eslint.config.mjs`: flat configuration with Next.js core-web-vitals and TypeScript rules.
- `tsconfig.json`: TypeScript configuration and `@/` import alias.

## Current behavior and gaps

Five fixed column IDs: `backlog`, `todo`, `in-progress`, `review`, `done`. Display titles are editable. Cards have `id`, `title`, and `details`. Moves append to the destination; same-column drops do nothing.

Sign-in uses `user` / `password` with a backend-signed session cookie. Reload restores authentication while the cookie is valid. Logout clears the cookie and unmounts private UI state. Board data still lives in component state and resets on reload/logout. Persistent board APIs and chat are absent. Do not describe planned features as implemented. Card creation/editing uses a modal; cancelling leaves the board unchanged and blank titles cannot be saved.

## Commands

Run from `frontend/`:

- `npm ci`: install locked dependencies.
- `npm run dev`: development server; requires Docker/FastAPI on port 8000 for auth API calls.
- `npm run build`: production export to `out/`; start the container via root scripts to serve through FastAPI.
- `npm run test:run`: single Vitest run; `npm test` starts watch mode.
- `npm run typecheck`: TypeScript check.
- `npm run lint`: ESLint CLI; Next.js no longer runs lint as part of its build.
- `npm run test:e2e`: Playwright tests; requires a running app and installed Chromium/Chrome.

Validation results and limitations are recorded in `docs/PART3_VALIDATION.md` and `docs/PART4_VALIDATION.md`.

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
