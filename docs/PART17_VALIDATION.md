# Part 17: Board switching and board-scoped AI

Completed locally 2026-11-21. The frontend now uses the Part 16 named-board APIs. Hosted migration/deployment remains Part 18.

## Changes

- Added a compact labeled Board selector, New board and Rename board forms, and Reload list. Names use the backend's 100-character limit. Failed requests retain the form draft and current board; rename conflicts refresh canonical metadata/content without replaying the rename.
- The workspace loads board metadata and only the selected document. Selection uses `?board=<id>` with the native History API supported by the installed Next.js guide. Refresh and Back/Forward restore selection. Missing/foreign selection links show recovery controls rather than another board's data.
- Without a selection URL, the first owned board is selected. A confirmed new board is selected unless a later browser-history navigation is waiting; in that case the new board remains in the list and the queued navigation wins.
- Extracted a keyed `BoardView` for each selected board. The canonical board hook reads/saves/chats with that explicit ID, ignores obsolete loads, reloads conflicts, and reports revisions back to the metadata list.
- Immediate request/draft/form locks prevent unsafe switches. Browser history waits for pending saves/AI or the user to finish/cancel an open draft. Failed drafts stay available; obsolete responses cannot replace a different board.
- Each board retains its own bounded AI history, draft, error, and notice in workspace memory. Dialog close/reopen and switching back restore it; reload, logout, expiry, and account changes clear it. Neither board JSON nor chat content is written to browser storage.
- Kept AI in its native modal popup, with focus restoration and Escape support. Board creation/naming are explicit UI actions. Five columns still fit on desktop and wrap on smaller screens.

## Validation

| Check | Result |
| --- | --- |
| Frontend unit/component suite | 78 passed across six files |
| TypeScript | Passed, including new component/browser tests |
| ESLint / React review | Passed; reviewed hooks, keyed state ownership, labels, focus, and cleanup |
| Production static export / runtime image | Passed with Node 24 in Docker; `/` remains statically exported |
| Existing browser regressions | 46 passed, four expected skips, on desktop/mobile |
| Final multiple-board browser suite | 13 passed, one expected mobile duplicate skip |

The 59 distinct passing browser cases and five expected skips were exercised across the regression and targeted feature runs, rather than reported as one fresh full-suite invocation. Expected skips are two opt-in live-provider cases, mobile native drag/drop, and the two duplicate mobile real-data checks.

Local frontend checks ran with Node 26.13.1 and the unchanged lockfile. Docker built the exported UI with Node 24 and packaged the unchanged Part 16 backend; no dependency upgrade or backend modification was needed in Part 17. Part 16's 276 backend tests remain the latest backend regression run and were not rerun for frontend-only changes.

Component cases cover creation/rename errors, metadata/list errors, unavailable selections, rename conflicts, URL history, independent board state, per-board AI memory, old loads returning after a switch, an obsolete 401, delayed saves/AI, queued navigation, and clearing both boards' private drafts on account change. Browser cases verify actual modal focus, native keyboard selection, mobile selection, long-name layout, Back/Forward, refresh, AI context separation, and pending-response behavior.

### Issues found and corrected

The unavailable-link browser test initially matched both the application's error and Next.js's route announcer. Scoped its alert lookup to the recovery panel; both desktop and mobile checks passed afterward.

A focused component test reproduced a navigation race during board creation: queued history displayed board 1 while the success handler changed the URL to board 3. Creation now leaves the URL alone when navigation is queued. The focused test and final desktop/mobile browser cases verify the displayed board, URL, and newly created metadata agree.

## Real API/data flow

Ran `e2e/boards-persistence.spec.ts` against the packaged app and an internal disposable SQLite database, without board API mocks. It created an additional empty board, saved a card, renamed a column and the board, switched to the original board, refreshed the selected URL, signed out/in, and deleted the temporary card. Names, contents, and selection persisted. The original board document/revision matched its prior snapshot throughout.

This additional-board test requires `KANBAN_DISPOSABLE_E2E=1`, the desktop project, and `http://localhost:8002`; it leaves an empty acceptance board only in the disposable database. Normal browser tests mock board APIs and never reset the user's saved boards.

AI success/failure and history/board isolation were exercised with mocked provider responses. No live OpenRouter request was made in Part 17. The review preview has no provider API key; its AI popup/drafts can be reviewed, but sending a live request gives the normal unavailable message. Hosted live-AI verification remains Part 18.

## Review and release boundary

The final review container `kanban-part17-preview-final` runs at `http://localhost:8002` using its own temporary database. Local demo credentials: `user` / `password`. It has schema versions 1, 2, and 3 and contains synthetic data only.

To review: create a board, add a card, rename the board, switch back to the original, and use Back/Forward or refresh. Open the assistant, enter a draft, close it, switch boards, and return; each board retains its own draft within the session. Keyboard focus returns to the appropriate launcher after closing dialogs/forms.

The original app on localhost:8000 was not restarted or migrated. A read-only check still showed versions 1 and 2 and SHA-256 `7c4d3af39c77f9e13a3ab52353dc0215f6058eac7fd5b3ed6c9bf613ca5a5533`, matching the Part 16 check. No production settings, database, or deployment changed.

The multi-board frontend requires schema 3 and the Part 16 backend. Apply the reviewed backup/migration/release procedure in Part 18 before publishing it. Shared-board invitations remain Parts 19-21.
