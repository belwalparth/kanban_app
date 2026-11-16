# Part 7 validation

Validated on 2026-11-16 with Windows, Docker Desktop Linux containers, and Chrome desktop/mobile emulation.

## Result

The visual board now reads and writes the signed-in user's SQLite board through `/api/board`. Existing saved names and cards appear on login. Creation, editing, deletion, drag/drop, editor-based movement, and column renaming persist across reload, logout/login, and container restart.

`useBoard` holds one canonical board/revision state for the board and future chat integration. Requests include the last saved revision. Saves apply the server response and disable overlapping operations, with an immediate in-flight guard preventing duplicate requests before React renders the disabled controls.

Column names save on Enter/blur rather than every keystroke. Escape cancels typing; blank names restore the saved name. Card dialogs remain open with their draft after failed saves, and rename drafts retain an error. Failed moves/deletes leave the saved board unchanged. Pending card saves disable dismissal so success cannot arrive after a draft was apparently cancelled.

Conflicts reload the latest canonical board and explain that the edit was not saved, without automatically replaying it. Obsolete card/rename drafts are discarded on conflict. If reloading fails, changes are blocked until an explicit reload succeeds. Unauthorized board loads/saves return the app to login and unmount private board/editor state. Failed loads offer retry; no demo board is substituted.

## Checks

- Frontend: **41 tests passed** (17 board component tests, 12 auth component tests, 12 helper tests). Includes loading/retry, save failures, retained drafts, failed deletes/moves, duplicate-save prevention, conflict reload success/failure, rename commit/cancel, and expiry on load/save.
- Frontend ESLint and TypeScript checks passed locally and in the clean Docker frontend test stage.
- Backend: **73 tests passed** against temporary databases, including existing transactions, ownership, and revision protection.
- Docker production export built successfully and the application started healthy.
- Browser suite: **30 passed, 2 intentionally skipped**. Skips are native mobile drag/drop and the mobile duplicate of the real-database check. Keyboard/touch movement is covered through the editor.
- Ordinary browser tests use per-test board API fixtures to isolate changes; real authentication requests still reach FastAPI. They cover every interaction, reload/login retention, failed saves/retry, conflicts, expired sessions during save, initial load failure/retry, responsive layouts, and focus behavior.
- `e2e/persistence.spec.ts` uses the real API/SQLite board. A uniquely named temporary card was created through the UI, reloaded, edited, moved, retained across logout/login, deleted, and confirmed absent after reload. Only its own card is cleaned up; no reset of existing user data occurs.
- A separate real-browser check created another unique card, stopped/recreated the Docker container through the scripts, authenticated again, reloaded the UI, and verified the card survived. It deleted that temporary card and confirmed the original board content was preserved. Revisions advance normally during these checks.
- Reviewed the desktop board screenshot after integration. Existing responsive browser tests also passed.
- `git diff --check` passed, with normal Windows LF/CRLF notices possible.

One existing logout-error component test initially targeted the temporary loading screen's Sign out button before the board finished loading. It now waits for the loaded board, matching the scenario it tests. All final checks passed.

## Check yourself

1. Open http://localhost:8000 and sign in with `user` / `password`. Previously saved API changes, including column names, should now appear in the board.
2. Add a uniquely named card with details. Wait for the dialog to close and saved status, then refresh. The card should remain.
3. Edit its title/details and move it using the Column selector. Refresh; the text and destination should remain.
4. Drag it to another column, wait for saved status, then refresh. The move should remain.
5. Rename a column and press Enter, or leave the field. Refresh; the name should remain. Escape cancels a pending rename; a blank committed name restores the saved name.
6. Sign out/in. The saved board should remain. Stopping/starting through the scripts and signing in again should also retain it.
7. Delete the test card, wait for saved status, and refresh. It should stay deleted.
8. For a conflict check, load the board in two tabs. Save a change in tab A, then attempt a different edit in the still-stale tab B. Tab B should load the latest board and show a conflict message; A's saved change must remain.

For failure recovery, temporarily block `/api/board` requests in browser developer tools, attempt a card save, and confirm the draft stays open with an error. Unblock requests and retry. Do not refresh while testing recovery: drafts are retained in the current UI, not browser storage.

## Reproduce automated checks

With Docker running, from the project root:

```powershell
docker build --target test -t kanban-app-test .
docker run --rm kanban-app-test
docker build --target frontend-test -t kanban-frontend-test .
docker run --rm kanban-frontend-test
```

From `frontend/`, using installed Chrome against the running app:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npm.cmd run test:e2e -- --workers=2
```

Browser checks create/remove a unique temporary card on the real board for one integration test. Other browser checks mock board data and do not reset the real database. The container restart check was run separately and is not performed automatically by the browser suite.

## Limits

Unsaved drafts are not retained through refresh/logout. Conflicts require reviewing the latest board and making the edit again; there is no automatic merge or replay. Other-tab changes are detected on save or reload, with no live collaboration subscription. AI/chat integration has not started. Browser checks use Chrome with mobile emulation; native macOS/Linux script execution remains unverified as noted in earlier parts.
