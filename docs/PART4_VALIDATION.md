# Part 4 validation

Validated on 2026-11-16 with Windows PowerShell, Google Chrome, and Docker Desktop Linux containers.

## Implemented behavior

- Opening `/` checks the server session before showing either sign-in or the board. The static export contains a loading state, not rendered board data.
- Only the exact credentials `user` / `password` authenticate. Credential checks run on the backend; the visible demo hint does not grant access.
- `POST /api/auth/login`, `GET /api/auth/session`, and `POST /api/auth/logout` implement the flow. Unauthorized session lookup returns 401. Health remains public.
- Starlette SessionMiddleware signs the `kanban_session` cookie using itsdangerous. It contains the username only, with HttpOnly, SameSite=Strict, Path=/, and an eight-hour maximum age. Secure is intentionally disabled for local HTTP.
- `SESSION_SECRET` can be supplied through root `.env`/Compose. Without it, a random key is generated at process startup, so restarting requires signing in again. No secret is baked into the image, and the OpenRouter key is not forwarded.
- API responses use `Cache-Control: no-store`. `require_user` protects session lookup and is ready to be reused by future board/chat routes; a test-only data route verifies its behavior.
- Login restores the board, reload restores authentication, and logout clears the browser cookie and unmounts board state. Window focus triggers a session check; expired/invalid sessions return to sign-in. Stale session responses cannot undo a later login/logout.
- Login has pending/error states; failed login clears the password. A failed session lookup can be retried, and failed logout keeps the board visible with an error rather than claiming success.
- Development-only Next.js rewrites proxy `/api/*` to FastAPI at port 8000. Production remains a static export served by Python.

## Checks

- Backend Docker tests: **24 passed**, covering valid/invalid/malformed login, missing/tampered/expired cookies, signed unknown users, cookie flags, logout, failed login clearing previous auth, same/different signing keys, protected-route dependency, and existing static/API routing.
- Frontend tests: **32 passed**, including 11 auth component tests, 9 board component tests, and 12 board helper tests.
- ESLint and TypeScript checks pass locally and in the clean Linux frontend test stage.
- Static production builds pass in Docker and locally. The app starts healthy at http://localhost:8000.
- Auth browser tests: **10 passed** across desktop/mobile Chrome. They exercise the actual form, rejected credentials, reload, logout/back/reload, HttpOnly cookie behavior, tampering, focus revalidation, retry after a mocked 503, viewport containment, and keyboard submission.
- Existing board browser tests: **11 passed, 1 intentionally skipped** after adding API authentication to their setup. Native mobile drag/drop remains skipped; the editor column selector provides touch movement.
- Reviewed desktop/mobile sign-in screenshots under ignored `frontend/test-results/`.
- A temporary Next.js development server on port 3100 successfully served the page and proxied login, session lookup, and logout to Docker. The temporary server was stopped afterward; the Docker app remains running.
- `git diff --check` passes, with possible Windows line-ending conversion notices.

## Issues resolved from evidence

- TypeScript rejected a Playwright-only `exact` option accidentally used in a Testing Library query; removed that unsupported option before the successful build.
- A deferred-response regression test demonstrated that a session lookup could restore the board after completed logout. Added a session version check and verified the regression passes.
- Real browser tests found Next.js adds its own route-announcer alert. Scoped login error assertions to the sign-in form instead of matching both alerts. All auth browser checks then passed.

## Manual check

1. Open http://localhost:8000 in an incognito/private window. Expect the login form and no board.
2. Try `user` with an incorrect password. Expect an error, an emptied password field, and no board.
3. Sign in with `user` / `password`. Expect five columns and six demo cards, plus a Sign out button.
4. Refresh. Authentication should remain; the board resets because persistence is still a later part.
5. Rename a column, then sign out. Expect the login form. Refresh and confirm it stays signed out.
6. Sign in again. Expect the default column name rather than the previous unsaved rename.
7. Narrow the window and use Tab/Enter to sign in. Check that the form fits the viewport.

Existing Docker test commands in README run the updated suites. Browser checks run from `frontend/` with `$env:PLAYWRIGHT_CHANNEL = 'chrome'` then `npm.cmd run test:e2e -- --workers=2`.

## Scope

This is the local MVP's hardcoded sign-in, using a stateless signed cookie. Logout removes the current browser's cookie; server-side token revocation and account management are outside this part. SQLite/user modeling, persistent board routes, and chat are not implemented yet. Static assets and synthetic demo data in the browser bundle remain public; future user data must be served through authenticated backend APIs.

Browser checks used Chrome with mobile emulation rather than physical devices. Native macOS/Linux start/stop checks remain unverified as recorded in Part 2. The Part 3 development-tool dependency audit findings are unchanged.

References: [Starlette session middleware source](https://github.com/Kludex/starlette/blob/main/starlette/middleware/sessions.py), [FastAPI security](https://fastapi.tiangolo.com/tutorial/security/), and the installed Next.js rewrites guide under `frontend/node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/rewrites.md`.
