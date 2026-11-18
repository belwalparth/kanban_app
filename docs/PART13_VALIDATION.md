# Part 13 validation

Implemented 2026-11-18: Google authorization-code sign-in, expiring authenticated sessions, origin-based CSRF protection, and the requested on-demand assistant popup with a full-width board. Real Google account verification remains pending until credentials are configured. Hosting/deployment remains Parts 14-15.

## Actual results

| Check | Result |
| --- | --- |
| Locked backend suite with SQLite, isolated PostgreSQL 18, and exported frontend assets | 224 passed |
| Additional version-1 SQLite upgrade/backup integration check | 1 passed |
| Frontend component/helper suite | 60 passed |
| ESLint and TypeScript | Passed |
| Production Next.js static export and final runtime container build | Passed |
| Chrome desktop/mobile browser suite against disposable port 8001 app | 46 passed, 4 intentional skips |
| Final browser smoke against rebuilt local app at port 8000 | 2 passed |
| Compose rebuild/restart with existing database volume | Healthy; frontend HTTP 200; health API returned ok |
| Saved local boards after migration | Before/after SHA-256 checksums matched; versions 1 and 2 present; pre-oauth backup created |
| Real Google sign-in | Pending: Google client settings and stable session secret are absent locally |

The four browser skips are the two opt-in live OpenRouter checks, duplicate mobile real-API persistence, and mobile native drag/drop. Mobile movement through the editor is tested. Browser auth flows use real local demo sessions plus mocked Google navigation/session responses; backend Google checks use real signed RSA tokens with mocked discovery/token/JWK HTTP. No real Google tokens or OpenRouter provider calls were made.

Environment: Windows host, Docker Desktop Linux containers, Python 3.14.2, Authlib 1.9.9, JOSERFC 1.8.0, HTTPX2 2.16.0, Psycopg 3.3.9, Next.js 16.4.6, installed Google Chrome. PostgreSQL checks use only a disposable database on a private Docker network. Browser persistence checks used a disposable SQLite app; its board was separate from the user's saved volume.

## Verified behavior

- Google start/callback use a configured callback URL, independent random state/binding/nonce/verifier, authorization code flow, and S256 PKCE. Only `openid email profile` scopes are requested; no offline access or refresh tokens.
- State and browser binding are hashed at rest. A matching, unexpired attempt is deleted atomically before token exchange. Concurrent consumption yields one winner on both storage engines. Wrong state/browser, expiry, cancellation, and replay do not establish sessions. Expired state rows are removed on a new start.
- The resolved Authlib implementation verifies RSA signatures through discovered public keys, nonce, issuer, audience, expiration, issue time, and authorized party. Tests reject wrong signatures/claims, missing nonce/token, provider/network/timeouts, and accept Google's two issuer spellings and a valid multi-audience token with matching authorized party.
- User/identity/board provisioning occurs only after successful validation and commit. Two subjects with the same email remain separate. Distinct signed Google sessions cannot read, manually update, or AI-update each other's boards. Cross-instance callback/session restoration works.
- Sessions contain only internal user ID and absolute eight-hour expiry. Cookies are HttpOnly, SameSite=Lax, host-only, and Secure on HTTPS. Untrusted Host and caller-supplied redirect values do not change configured callback/success paths. Logout clears the app cookie without contacting Google.
- Every unsafe API request checks the exact configured Origin. Missing, null, foreign, and trailing-slash origins are rejected with uncached 403 responses, including login/logout. Preview/production configuration rejects demo login, missing Google/PostgreSQL/HTTPS settings, and insufficient signing secrets.
- Google profile strings are display data only; synthetic Google usernames are not rendered. Safe callback messages support explicit retry and remove the error parameter after display. API/auth responses and redirects remain no-store. Uvicorn strips OAuth query parameters from access logs; Authlib protocol debug output is disabled.
- Assistant starts closed and uses no column width. Open/close, Escape, focus restoration, retained drafts/history, pending requests, safe text rendering, retry/conflict behavior, immediate canonical AI changes, reload/logout/expiry/account-change clearing all pass component/browser checks.
- Five columns fit one row at the tested 1440px desktop width, with no board or page horizontal overflow. Tablet/mobile wrap columns rather than using a fixed oversized board. Desktop/mobile dialog screenshots were inspected, and browser tests check dialog bounds and keyboard behavior.

## Commands and diagnosis

- Resolved the new stable Authlib dependency with `uv`; package metadata confirms Python 3.14 support. References: [Authlib package](https://pypi.org/project/Authlib/), [Starlette integration](https://docs.authlib.org/en/stable/oauth2/client/web/starlette.html), [web clients](https://docs.authlib.org/en/stable/oauth2/client/web/index.html), [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect).
- Built `kanban-part13-test` with `docker build --target test`. Ran its complete backend suite with `TEST_DATABASE_URL` directed at disposable PostgreSQL, mounting the current test directory. Added and ran the separate version-1 SQLite upgrade case afterward.
- Ran `npm run test:run`, `npm run lint`, and `npm run typecheck` in `frontend/`.
- Ran `npm run test:e2e -- --workers=2` with `PLAYWRIGHT_BASE_URL=http://localhost:8001` and `PLAYWRIGHT_CHANNEL=chrome`.
- Ran `docker compose up -d --build --wait` for the final local runtime. Recorded only hashes, versions, and backup presence while checking preservation; private board content was not printed. Two browser smoke checks at port 8000 verify assets/hydration and popup/column layout without writing real board data.
- Initial Google mocks mixed HTTPX transport objects with Authlib 1.9.9's selected HTTPX2 client. The traceback identified incompatible stream types; inspecting Authlib's installed compatibility module proved HTTPX2 selection. Switched to the existing HTTPX2 transport/imports and removed the unnecessary HTTPX dependency; signed-token tests passed.
- Corrected test-only cookie domain/case assumptions after inspecting the emitted cookies. The first full browser run had four selector failures: `Working...` also matched the launcher, and the callback alert also matched Next.js's route announcer. Scoped/exact selectors fixed them; the full rerun passed. No app workaround was added for those test issues.

## Remaining checks

Google Cloud client registration/consent and the real browser sign-in have not been performed. The root `.env` was checked for setting presence only; no secret values were displayed or changed. Follow [GOOGLE_SIGN_IN.md](GOOGLE_SIGN_IN.md) to configure the local client and verify real sign-in, then use separate preview/production settings in Parts 14-15.

No hosted deployment, external account changes, or real data import occurred. Verify Vercel routing, function behavior/redeployment, and hosting-platform access-log redaction during deployment. Application logging filters do not control external platform request logs. Native macOS/Linux script checks were not rerun; scripts were unchanged.

Historical validation documents remain unchanged. The results above describe the initial implementation checks; the follow-up below records subsequent real-account configuration and validation.

## Follow-up: real Google sign-in

The local `.env` now contains a generated persistent session secret, the localhost base URL, and Google credentials supplied by the user. Demo login was disabled, and the container was recreated successfully. Secret values were never printed or committed.

- The live start endpoint returned 302 to `accounts.google.com`, using exactly `http://localhost:8000/api/auth/google/callback`, scopes `openid email profile`, and S256 PKCE. The auth redirect was no-store, and demo login returned 403.
- A Chrome check confirmed **Continue with Google** is visible, targets the backend start route, and the password form is absent.
- After the user completed Google consent, the local database contained exactly one verified Google identity and exactly one Google-owned board. That board passed the normal board model validation and remained identical across separate database connections. Board content, subject, email, and profile values were not printed.
- The health endpoint remained healthy with Google enabled and demo login disabled. [PLAN.md](PLAN.md) now records the single-account real sign-in check as complete.

The complete two-account browser workflow, hosted sign-in, logout/reload checks with real accounts, and redeployment verification remain Parts 14-15; this follow-up does not claim those checks were performed.
