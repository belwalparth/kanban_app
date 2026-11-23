# Part 20 validation

Completed locally 2026-11-23. Sharing UI uses the Part 19/schema-4 API. Production and hosted preview were not migrated or deployed; Part 18's pending acceptance remains unchanged. Real Google collaboration and hosted persistence are Part 21.

## User behavior

- Owners use **Share board** to invite a Google email, copy the single-display link, revoke pending invitations, list accepted members, and confirm member removal. The native dialog supports keyboard focus, Escape, and focus restoration. Clipboard failures offer manual copying.
- Invitation fragments are removed from history and retained only as a pending token in tab session storage through Google navigation/account switching. The board name appears only after authenticated inspection. Joining requires **Accept invitation**; acceptance/dismissal clears the token. Invalid/expired/revoked/consumed links and wrong-account failures provide recovery without private contents.
- Joined boards show **(Shared)** and **Shared with you**; members have no sharing or board-name controls. Normal sign-in still opens the user's initial owned board even if an older joined board sorts first. Invitation acceptance selects the existing shared board.
- Returning window focus loads current saved content when no local draft, management action or save/AI request is pending. A response started before a mutation cannot overwrite its result. No polling/WebSockets were added. Refreshing the browser also reloads saved changes.
- Revision conflicts load canonical state but retain drafts for explicit retry/cancel. Removed cards cannot be silently recreated by stale edits. Failed column saves require a changed draft or Enter to retry; blur does not automatically repeat a failed write.
- Access removal clears the board, editor and that board's AI memory on the next API/focus check, then opens an accessible board with a message. Late responses cannot restore inaccessible chat memory. Chat remains private per user/session/board.

Usage: [Google sign-in and sharing](GOOGLE_SIGN_IN.md#sharing-boards). Contract: [SHARING_API.md](SHARING_API.md).

## Results

| Check | Result |
| --- | --- |
| Frontend Vitest | 88 passed |
| TypeScript and ESLint | Passed |
| Backend SQLite/PostgreSQL regression | 321 passed, 3 expected skips |
| Final Playwright desktop/mobile run | 62 passed, 6 expected skips |
| Container test target and Next.js production export | Passed |
| `git diff --check` | Passed |

Backend tests ran from `kanban-part20-test` against the existing disposable PostgreSQL 18 `kanban_test` database on the `kanban-part18` network and temporary SQLite files. Three skips are engine-specific checks. The backend implementation is unchanged from Part 19. No provider key or real Google login was needed.

The final browser run used Chrome at `http://localhost:8003` and separate owner/member contexts. `e2e/sharing-real.spec.ts` exercised the real API and SQLite for inviting two users, explicit acceptance, member controls, shared manual changes and columns, revocation, conflicts, removal/reinvitation, and private chat memory. Its synthetic AI result was persisted through the real revisioned API. The removal case delayed an outgoing chat request until membership removal, then the actual API returned 404 and the UI cleared access; Part 19 backend tests separately cover removal during an external AI call. Existing browser cases cover manual/AI concurrency, expiry, switching/history, drag/drop, persistence and layout.

Six browser skips: live-provider checks in both projects; the Part 17 multi-board persistence fixture in both projects (restricted to localhost:8002); duplicate real persistence on mobile; native drag/drop on mobile. Real API persistence and additional shared-board persistence were exercised on desktop/localhost:8003. Mobile card movement uses its editor.

`Sharing.test.tsx` covers invitation persistence through simulated OAuth page replacement, wrong-account sign-out/recovery, name withholding before inspection, no implicit acceptance, unavailable links, explicit owner management, member controls, safe focus refresh, retained conflict drafts/retry, initial-board selection, and removal during an open editor. Real Google round-trip acceptance remains unverified here. Agent-browser also inspected the owner dialog's accessible controls on the local app; its isolated session was closed.

The access-removal test reproduced a stale draft lock: column cleanup still saw an open editor after its board unmounted. Clearing editor/draft refs during layout cleanup fixed the lock; the regression now proves the selector and chat recovery work. Sharing focus restoration also waits until the launcher's disabled state has cleared. Initial browser failures were ambiguous status/alert locators (including Next.js's route announcer); scoped the assertions and verified the full final suite.

## Reproduce locally

Run from the repository root. Choose a new container name if one already exists. This fixture uses only `/tmp/part20-disposable.db` inside its test container; do not mount a wanted database or credentials. Do not use it for production or expose its port publicly.

```powershell
docker build --target test -t kanban-part20-test .
docker run -d --name kanban-part20-review -p 127.0.0.1:8003:8000 -e APP_ENV=local -e APP_BASE_URL=http://localhost:8003 -e KANBAN_DISPOSABLE_E2E=1 kanban-part20-test uv run --locked python tests/browser_server.py
docker cp kanban-part20-review:/tmp/part20-sessions.json .vercel/part20-sessions.json
```

Wait for the fixture's startup before copying. The committed fixture seeds synthetic verified identities and writes test-only signed cookies. These files and browser traces are ignored; keep them out of commits. The test target contains the fixture; the runtime image does not. An earlier private helper with equivalent fixture behavior served the review runs. The committed fixture is separately checked for initialization from the built image.

From `frontend/`:

```powershell
npm.cmd run test:run
npm.cmd run typecheck
npm.cmd run lint
$env:PLAYWRIGHT_BASE_URL = 'http://localhost:8003'
$env:PLAYWRIGHT_CHANNEL = 'chrome'
$env:KANBAN_SHARING_E2E = '1'
npm.cmd run test:e2e -- --workers=2
```

The current isolated review container is `kanban-part20-preview-final` on localhost:8003. The previous `kanban-part20-browser` is stopped. Demo login (`user` / `password`) lets the user inspect sharing controls on synthetic data; this fixture does not configure real Google OAuth. Stop the preview with `docker stop kanban-part20-preview-final` when finished. The existing local app on port 8000 and prior preview on 8002 were not changed. No commit or push was made; coordinate schema 4 and release before an automatic production deployment.
