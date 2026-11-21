# Production deployment verification

Checked 2026-11-21. Production smoke verification is complete with the evidence limits below. Public checks passed automatically; the user exercised real Google sign-in, manual/AI changes, two-account isolation, persistence across redeployment, deletion, and concurrent-edit conflicts in their normal browser. Operational follow-ups remain documented.

## Confirmed deployment

- Vercel account/team: `belwalparth`.
- Project: `kanban-app`, using FastAPI, Root Directory `backend`, Node 24.x.
- Repository: `belwalparth/kanban_app`; production branch `main`.
- Deployed commit: `7ef079b43651c54045158798312b3b42f0b2d6cf` (Part 14).
- Production origin: `https://kanban-app-seven-nu.vercel.app`.
- Current deployment: `dpl_4E8HePvEXTgDE96Dy9ueUH3S1jCF`, Ready, at `https://kanban-qgxvncq1y-belwalparth.vercel.app`.
- Prior working deployment: `dpl_HefJe5wV7vE5iygSfDmNG3dgDnpC`. Redeployed that same Part 14 release without changing its secrets or schema to test persistence.
- The similarly named `kanban_app` project is a separate Next.js project and was not changed.

## Database and configuration

- Ran `python -m app.manage_db migrate` against the selected Neon database using the existing app Docker image and current backend source.
- Command returned `Database operation completed`; a separate `check_schema` call verified the required schema.
- Removed the temporary migration environment file and shell variable afterward.
- Initial production rebuild passed the build but failed at startup with `Cloud mode requires HTTPS APP_BASE_URL and Google client settings`.
- Retained the prior shared `APP_BASE_URL` record for Preview and created a separate Production Config value, `https://kanban-app-seven-nu.vercel.app`.
- Rebuilt production with that correction; startup and public API checks then passed.
- Secret values were not retrieved or printed. The pooled database URL and restricted runtime-role permissions have not been independently inspected.
- Preview/production credential and database isolation remain unverified; existing metadata includes secrets assigned to both environments.

## Hosted checks

- `/`: login page renders in an isolated browser, with a Continue with Google link.
- `/api/health`: 200, `{"status":"ok"}`.
- `/api/auth/config`: 200, Google enabled, demo login disabled; `Cache-Control: no-store`.
- Unauthenticated `/api/auth/session` and `/api/board`: 401 JSON, no-store.
- Unknown API route: 404 JSON, no-store. Unknown page: 404 HTML.
- `/api/auth/google/start`: 302 to Google with callback `https://kanban-app-seven-nu.vercel.app/api/auth/google/callback`.
- OAuth binding cookie has HttpOnly, Secure, SameSite=Lax, the expected path, and a 600-second maximum age. Cookie values and OAuth state were not recorded.
- Initial browser navigation to Google returned `Error 400: redirect_uri_mismatch`. After the user saved Google client settings, a fresh browser attempt reached Google's email/password sign-in screen for the production app without the mismatch error. No account credentials were entered.
- Google rejected interactive sign-in from the automated verification browser. The user completed authenticated checks in their normal browser; no Google password, app cookie, or signing secret was collected for automation.

## Part 15 acceptance results

Public smoke checks ran before and after the persistence redeploy. Both runs passed 13 HTTP cases and three static-asset fetches with zero failures:

- Main page, CSS, and two generated JavaScript chunks returned 200.
- Health/config returned 200; Google is enabled and demo login is disabled.
- Unauthenticated session/board reads and board/chat writes returned 401.
- Unknown page/API paths returned 404; the API returned JSON.
- Logout writes with missing or foreign Origin returned 403.
- The legacy demo-login endpoint returned 403 even with the local demo credentials and correct Origin.
- A synthetic invalid Google callback returned 303 to `/?auth_error=invalid`.
- Every API response checked above included `Cache-Control: no-store`.

Authenticated checks are user-reported, not agent-observed browser actions:

| Check | Result and evidence |
| --- | --- |
| Google sign-in, card creation, detail editing, cross-column movement, refresh, logout/login | User answered `its working` to the complete checklist. |
| Column rename and live AI card creation, followed by refresh | User answered `both checked`. |
| Two real Google accounts, distinct cards, isolation in both directions | User answered `checked.okay` to the two-account checklist. |
| Existing sessions, cards, and column names after redeployment | User answered `yes okay` after deployment `dpl_4E8HePvEXTgDE96Dy9ueUH3S1jCF` became Ready. |
| Two-tab revision conflict | User observed `This board changed elsewhere. The latest version is loaded; your edit was not saved.` The user then confirmed the winning card remained after refresh. |
| Persistent card deletion | User answered `Both passed` to winning-card preservation and deletion/refresh checks. |
| Manual save during an in-flight AI response | User answered `conflict shown` to the overlapping manual/AI checklist. Earlier local tests verify that concurrent saves are preserved. The agent did not independently compare authenticated board snapshots during this hosted check. |

## Logging and operational limits

- A one-hour runtime-log query exceeded this Hobby account's available retention; it was not treated as evidence of clean logs.
- Successful bounded queries within retention sampled five runtime records on the prior deployment and three on the current deployment. No error/fatal entries, OAuth query parameters, or obvious database/OpenRouter credential patterns were found in the examined fields.
- A sample of 88 current-deployment platform request records contained no OAuth `code`/`state` query pattern, credential pattern, or synthetic callback probe string. This is bounded evidence, not a guarantee about all platform traces, exports, or past retention.
- Function maximum is 60 seconds; the application limits OpenRouter to a 40-second total network deadline, and database connection/statement operations to five seconds. Sessions expire after eight hours. These limits were checked against source/configuration; no production timeout was deliberately induced.
- Recovery procedures and the prior working release are recorded in [production operations](PRODUCTION_OPERATIONS.md). No production rollback, restore, new migration, or data import was performed during this verification run.

## Required follow-up

The user saved Google client settings, and the production callback was accepted on retest. The configured values are:

- Authorized JavaScript origin: `https://kanban-app-seven-nu.vercel.app`
- Authorized redirect URI: `https://kanban-app-seven-nu.vercel.app/api/auth/google/callback`

Retain the authenticated checks as user-reported evidence; no authenticated browser automation or independent private-board snapshot comparison was performed. Confirm Neon backup/history retention and rehearse recovery before the next schema change. Runtime-role permissions, preview/production resource separation, and Google consent-screen publishing status have not been independently inspected. Preview hosting acceptance checks remain pending. No intentional production provider outage or timeout was induced.
