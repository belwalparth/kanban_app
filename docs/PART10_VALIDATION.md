# Part 10: chat sidebar and final verification

Completed 2026-11-17 on Windows with Docker Desktop Linux containers and installed Chrome.

## Delivered behavior

The signed-in board has a Board assistant sidebar, below the board on narrow screens. It supports labeled text input, conversation history, pending feedback, plain-text replies, and explicit retry with retained failed drafts. Messages are limited to 4000 characters; the last 20 successful conversation entries are kept in component memory. Reload, logout, or session expiry clears conversation and drafts. No chat is stored in browser storage or database tables.

Chat uses the same canonical board/revision state and immediate request guard as manual saves. AI changes apply only from the saved API response. During AI requests, manual edits, reload, and logout are disabled; chat is disabled during manual saves, blocked/loading states, or an open card editor. Duplicate submissions cannot start overlapping calls.

Conflicts load the latest board, preserve the message draft, and require explicit resubmission after review. If conflict reload fails, writes remain blocked until Reload board succeeds. Network failures with an uncertain commit result also require board reload/review before resubmission. Provider/validation failures retain the draft without automatic retries. A 401 unmounts private UI and returns to sign-in.

Assistant text is rendered through React text nodes, without HTML or Markdown interpretation. The conversation is a labeled live log with keyboard scrolling. Tab reaches Send message from the textarea, Enter activates the focused button, and focus returns to the textarea after completed requests. Enter inside the textarea inserts a newline.

## Results

| Check | Result |
| --- | --- |
| Frontend Vitest suite | 55 passed. |
| ESLint | Passed, no errors or warnings. |
| TypeScript | Passed. |
| Next.js static production export | Passed in Docker; FastAPI serves the exported app. |
| Backend pytest suite | 147 passed with `--network none`. |
| Desktop/mobile browser suite | 40 passed, 4 intentional skips. |
| Separate live AI browser check | 1 passed, two real free-model requests. |
| AI changes after temporary container restart | Saved revision and created/moved cards verified. |
| Desktop/narrow layout | Screenshots inspected; no page overflow, sidebar fits, board scrolls horizontally. |

The four normal-suite skips are the two opt-in live-provider cases, mobile native HTML drag/drop, and the duplicate mobile real-data persistence check. Mobile movement is tested through the editor. The live-provider case was separately enabled for desktop and passed.

Component/API tests cover revision/history submission, bounded history, answer-only replies, exact canonical updates followed by manual saves, duplicate prevention, pending controls/focus, HTTP 422/502/503/504 failures and explicit retry, conflicts, failed reload recovery, uncertain network results, logout, expiry, and HTML-like assistant text rendered literally.

Browser tests cover existing login/manual persistence and all sidebar flows on desktop and emulated Pixel 7. The real manual persistence test creates, edits, moves, reloads, logs out/in, and deletes only its own uniquely named temporary card. Normal board/chat browser checks share an isolated per-test mock board store and make no provider calls.

Two test issues were diagnosed and fixed: new global alert selectors also matched Next.js's route announcer, so they now target the sidebar; the existing immediate-reload test sometimes cancelled the initial board fetch (`net::ERR_ABORTED`, followed by a successful 200 response), so it now waits for initial cards before measuring reload failures. No application workaround was needed.

## Live check isolation

The live browser check ran against a separate production-image container at `http://localhost:8001`, with an anonymous `/data` volume. Mount inspection confirmed it differed from the normal app's `kanban-app_kanban-data` volume. The normal app remained at port 8000.

Using `nvidia/nemotron-3.5-super-vl:free`, the browser signed in, asked for the six-card count without changing the board, then requested one card creation, one title edit, and one move. The test compared the entire saved board to the exact expected result at revision 1, verified immediate UI updates, and reloaded. The temporary container was restarted and the saved revision and AI changes were verified again. It was then stopped with automatic container/anonymous-volume removal. The live AI requests never read or changed the user's saved board.

To repeat against a fresh disposable container, from the project root:

```powershell
docker compose run --rm -d --name kanban-part10-live -p 127.0.0.1:8001:8000 -v /data app
docker inspect --format '{{range .Mounts}}{{.Type}} {{.Name}} {{.Destination}}{{println}}{{end}}' kanban-part10-live kanban-app-app-1
```

Confirm different `/data` volume names. From `frontend/`:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
$env:PLAYWRIGHT_BASE_URL = 'http://localhost:8001'
$env:KANBAN_LIVE_AI = '1'
npm.cmd run test:e2e -- e2e/live-chat.spec.ts --project=desktop --workers=1
Remove-Item Env:KANBAN_LIVE_AI
Remove-Item Env:PLAYWRIGHT_BASE_URL
docker stop kanban-part10-live
```

The live test requires a fresh seeded disposable database and explicitly refuses a base URL other than port 8001. Provider availability/rate limits can vary; normal regression tests mock provider calls. Runtime credentials remain backend-only.

## Manual acceptance checks

1. Open http://localhost:8000, refresh, and sign in with `user` / `password`.
2. In Board assistant, ask “How many cards are on my board? Do not change anything.” Expect a reply with no board changes.
3. Ask “Create a card named Part 10 test in To do with details Test from chat.” Expect the card immediately and “Board updated and saved.”
4. Ask “Rename Part 10 test to Part 10 complete and move it to Done.” Verify both changes, then refresh and confirm the card remains while conversation clears.
5. Edit that card manually, save, sign out/in, and confirm the saved change remains. Delete the temporary card when finished.
6. Narrow the browser: the assistant appears below the horizontally scrollable board. Tab through the labeled input/button and send using the keyboard.

Manual AI requests change your real board and send its contents to OpenRouter. For a live check that leaves it untouched, run `docker compose exec -T app python -m app.check_chat` instead.

## Regression commands

From `frontend/`, with the app running:

```powershell
npm.cmd run test:run
npm.cmd run lint
npm.cmd run typecheck
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npm.cmd run test:e2e -- --workers=2
```

From the project root:

```powershell
docker build --target test -t kanban-app-test .
docker run --rm --network none kanban-app-test
docker compose up --build -d --wait
```

macOS/Linux script execution, Safari/Firefox, physical touch devices, and screen-reader output were not exercised in this Windows session. Keyboard interactions and mobile viewport behavior were tested in Chrome. Earlier platform/script checks remain documented in the preceding validation files.
