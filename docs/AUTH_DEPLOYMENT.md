# Google authentication and Vercel architecture

Part 11 decision record, 2026-11-18. This describes implementation in Parts 12-15; no cloud resources, credentials, migrations, or deployments were created in Part 11.

Parts 12-13 now implement the storage/authentication design locally. See [Google sign-in](GOOGLE_SIGN_IN.md) for the resolved Authlib 1.9.9/HTTPX2 integration, setup, state handling, and actual runtime behavior. Hosting/deployment remains Parts 14-15; the sections below retain the architecture decision record.

## Hosting decision

Use one Vercel project with the FastAPI framework preset and `backend/` as its Root Directory. Enable **Include source files outside of the Root Directory in the Build Step** so the build can access `../frontend/`. Keep the current statically exported Next.js UI; it needs no Next.js server or separate frontend deployment.

The build will run `npm ci` and `npm run build` in `frontend/`, then copy the contents of `frontend/out/` into `backend/app/static/`, matching Docker's existing output layout. Add a portable build script in Part 14; configure it through `[tool.vercel.scripts] build` in `backend/pyproject.toml`. Use Node 24 as in Docker, subject to a successful Vercel build. Do not set the project's Output Directory to `frontend/out/`, which would describe only the UI.

Vercel's current FastAPI integration supports `app/main.py`, custom `[tool.vercel] entrypoint`, static-mount CDN promotion, and post-install build commands. Declare `entrypoint = "app.main:app"` explicitly. Keep `/api` mounted before the root static mount; this preserves all existing `/api/*` paths. Keep generated files in the bundle initially so runtime static handling remains available. The API sub-app's session/no-cache middleware must stay scoped to `/api`; public CDN assets bypass application authentication. Do not generate private board data into static HTML. No catch-all rewrite to `index.html` and no duplicated `/api` prefix are needed. Sources: [FastAPI hosting](https://vercel.com/docs/frameworks/backend/fastapi), [monorepo source access](https://vercel.com/docs/monorepos/monorepo-faq).

Planned function setting in `backend/vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "functions": {
    "app/main.py": { "maxDuration": 60 }
  }
}
```

This is a configuration target, not a tested deployment artifact. Part 14 must inspect the generated function/static routes, including `/`, an asset, missing assets, `/api/health`, missing API routes, and the OAuth callback. The docs support these components; the combined repository build still needs preview verification.

## Runtime and request limits

Keep Python `>=3.14,<3.15` and `backend/uv.lock`. Vercel currently supports Python 3.12, 3.13, and 3.14 and accepts `pyproject.toml` with `uv.lock`; its Python builds use `uv`. Lock new Authlib/HTTPX and Psycopg dependencies during their implementation phases. The existing `httpx2` OpenRouter client is separate from Authlib's documented HTTPX integration; verify their resolved dependencies together rather than assuming they are interchangeable. Source: [Python runtime](https://vercel.com/docs/functions/runtimes/python), [Vercel uv tooling](https://vercel.com/i/uv-python-package-manager).

Use Fluid compute. Its documented Hobby duration maximum is 300 seconds; our chosen maximum is 60 seconds. The standard Python bundle limit is 500 MB and buffered request/response payloads are limited to 4.5 MB. Keep app payload bounds below that ceiling and report oversize failures. No large-function beta or longer-duration plan is required. Source: [function limits](https://vercel.com/docs/functions/limitations).

The current HTTPX timeout of 30 seconds limits individual network phases, not total request wall time. In Part 14, bound the complete OpenRouter operation to 40 seconds, database connects to 5 seconds, and each database statement to 5 seconds, leaving headroom within 60 seconds. Do not silently retry writes or rely on work continuing after a response. A timeout after a possible commit requires reloading canonical state before retrying.

FastAPI lifespan is supported, but shutdown cleanup has only 500 ms. Use it only for instance resource lifecycle, never durable schema setup or required final commits. Remove production SQLite initialization/seeding from startup. Instance memory and local filesystem are not shared durable storage. Docker, the SQLite volume, and start/stop scripts remain the local development path. Source: [FastAPI lifecycle](https://vercel.com/docs/frameworks/backend/fastapi).

## Storage decision

Use Neon managed PostgreSQL with Psycopg 3 (`psycopg[binary]`, compatible with Python 3.14). Keep small explicit SQL storage functions rather than adding an ORM. Use a short-lived connection per database operation through Neon's pooled TLS connection string; do not share a connection across requests or keep a connection open during an AI call. Use transaction-local settings for query timeouts, not persistent `SET` state. Sources: [Psycopg installation](https://www.psycopg.org/install/), [Neon connection pooling](https://neon.com/docs/connect/connection-pooling).

Create separate Neon projects/databases and roles for preview and production; use SQLite for routine local work and a disposable PostgreSQL database for integration tests. Never branch a preview containing live production boards. Choose a Vercel function region near the selected Neon region during setup. Record the chosen compute's actual connection limit with `SHOW max_connections`; Neon's pooled client capacity is not a simultaneous-query allowance.

Copy the pooled connection string from Neon Connect into the environment's `DATABASE_URL`. Use a direct connection as `DATABASE_MIGRATION_URL` for the explicit migration and backup commands, outside request handling. Do not expose or log either URL. See [DATABASE.md](DATABASE.md#google-identity-and-production-storage-design-part-11) for schema, migration, and concurrency behavior.

## Google integration decision

Use Authlib's `authlib.integrations.starlette_client.OAuth` in FastAPI. Register Google's discovery URL `https://accounts.google.com/.well-known/openid-configuration`, scope `openid email profile`, and `client_kwargs` with `code_challenge_method = "S256"`. Use server-side authorization code flow and Google's query callback. Authlib documents automatic ID-token parsing and PKCE; Google's live discovery metadata advertises code flow, RS256, and S256. Select a current stable release and lock it in Part 13; documentation version labels alone do not verify a dependency build. Sources: [Authlib Starlette integration](https://docs.authlib.org/en/stable/oauth2/client/web/starlette.html), [Authlib PKCE](https://docs.authlib.org/en/stable/oauth2/client/web/index.html#oauth-2-0-code-challenge), [Google discovery](https://accounts.google.com/.well-known/openid-configuration).

Proposed public routes:

| Route | Behavior |
| --- | --- |
| `GET /api/auth/google/start` | Create a short-lived, browser-bound login attempt and redirect to Google. |
| `GET /api/auth/google/callback` | Consume state, exchange code with PKCE/client secret, validate identity, establish session, redirect to `/`. |
| `GET /api/auth/session` | Return the current user's display information or 401. |
| `POST /api/auth/logout` | Clear the app session; leave the user's Google login alone. |

Persist one-time OAuth attempts in the database so callback verification works across instances and replay rejection is atomic. Bind state to a random HttpOnly browser cookie, retain nonce and PKCE verifier on the server, expire attempts after 10 minutes, and consume them once even when token exchange fails. Restart sign-in after failure. Configure Authlib's state/cache integration against this storage and test the exact resolved library behavior. No process-local OAuth cache or Redis dependency. Pending-state schema is in DATABASE.md.

Validate state/browser binding, nonce, signature against Google's keys, expected issuer, client audience, authorized party where applicable, and expiration before creating a user/session. Do not treat an unverified JWT decode as identity. Canonicalize either explicitly accepted Google issuer spelling to `https://accounts.google.com` only after validation. Identity is `(issuer, subject)`, never email. Discard provider tokens after sign-in and request no offline access. Source: [Google OIDC server flow](https://developers.google.com/identity/openid-connect/openid-connect).

Keep the signed app-session approach with only internal `user_id` and an absolute eight-hour expiry. Use one configured session secret across instances/deployments within an environment and separate secrets between preview/production. Cookies: HttpOnly, Secure on HTTPS, SameSite=Lax for Google's top-level GET callback, Path=/, and no Domain attribute. Local HTTP may disable Secure explicitly. Clear old session/OAuth state before issuing the authenticated session. Clearing a signed cookie logs out that browser; a copied valid cookie remains usable until expiry or secret rotation. Per-session server revocation is outside this release's scope.

For every unsafe cookie-authenticated API request, require an `Origin` matching the configured `APP_BASE_URL`; reject absent, null, or foreign origins. Same-origin frontend fetches use this policy, including logout and optional local login. Keep GET endpoints free of board mutations; the OAuth callback uses state/nonce validation instead. Do not enable wildcard credentialed CORS. The API must never trust a supplied owner ID.

## Google Cloud setup

1. Create separate development/preview and production Google Cloud projects. In Google Auth Platform, configure Branding (app/support/developer contacts), Audience (External unless intentionally Workspace-only), and Data Access (`openid email profile` only).
2. Create a **Web application** OAuth client for each environment. Store its client ID/secret on the backend. This redirect flow requires authorized redirect URIs; it does not require a browser Google SDK or JavaScript-origin configuration.
3. Register the exact callback strings below, substituting the real stable Vercel hostnames. Schemes, ports, paths, and trailing slashes must match. The callback path has no trailing slash. Never derive it from an untrusted Host header or arbitrary redirect parameter.
4. Add the two intended test accounts where test-user configuration applies, and check Workspace administrator policy if an account is denied. Basic identity scopes have an exception to the usual Testing allowlist restriction: the test-user list does not make a preview private. Use Vercel Deployment Protection for a private preview, and verify its authentication cookie permits the interactive Google return. See [Google OAuth app states](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview).
5. Before release, configure the final production hostname and homepage/privacy information, publish the intended audience, and complete applicable branding/domain verification shown by Google. Identity-only scopes do not imply sensitive/restricted API verification. Record the actual console state in Part 15; do not assume publishing or approval has occurred.

| Environment | `APP_BASE_URL` | Authorized redirect URI |
| --- | --- | --- |
| Local Docker | `http://localhost:8000` | `http://localhost:8000/api/auth/google/callback` |
| Local Next development proxy | `http://localhost:3000` | `http://localhost:3000/api/auth/google/callback` |
| Stable preview (placeholder) | `https://<preview-host>` | `https://<preview-host>/api/auth/google/callback` |
| Production (placeholder) | `https://<production-host>` | `https://<production-host>/api/auth/google/callback` |

Configure one local origin per run; `localhost` and `127.0.0.1` are different origins. For previews, choose a stable branch alias/domain before configuring OAuth. Arbitrary commit URLs can show the UI but must not silently borrow another host's callback or production secrets. Source: [Google web-server redirect rules](https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation).

## Environment contract

All settings below are backend-only. Keep local values in the ignored root `.env`; use separate Vercel Preview/Production environment settings in hosting. Never prefix a secret with `NEXT_PUBLIC_`, commit it, or copy `.env` into deployment output.

| Setting | Required behavior |
| --- | --- |
| `APP_ENV` | Explicit `local`, `preview`, or `production`; cloud modes enforce production security settings. |
| `APP_BASE_URL` | Exact configured browser origin; HTTPS required in cloud modes; no path or trailing slash. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Matching Web application client for that environment. Required for Google authentication. |
| `SESSION_SECRET` | Stable random signing secret of at least 32 random bytes; required in cloud modes, never generated per instance. |
| `DATABASE_URL` | Pooled TLS PostgreSQL URL; required in cloud modes. Never fall back to SQLite if absent or unreachable. |
| `DATABASE_MIGRATION_URL` | Direct PostgreSQL URL used only by operator migration/backup tools. No need to provide it to the serving function. |
| `DATABASE_PATH` | Local SQLite path only; existing Docker default `/data/kanban.db`. |
| `ALLOW_DEMO_LOGIN` | Default false. May be true only in explicit local mode. A true value in cloud modes is a configuration error. |
| `OPENROUTER_API_KEY` | Server runtime key, required for chat; never exposed in auth/session responses. |
| `OPENROUTER_MODEL` | Existing verified free model default; recheck live availability during AI smoke tests. |

Missing identity/session/storage configuration must fail cloud startup clearly without printing values. OpenRouter availability is independent: unavailable chat must not prevent sign-in or manual board use. Keep API/auth responses `Cache-Control: no-store`, including failure responses and redirects containing OAuth parameters.

## Request walkthrough

1. The CDN serves the public login UI. Google sign-in navigates to the same-origin start endpoint; instance A records a browser-bound attempt and redirects to Google.
2. Google returns to the registered callback on the same browser origin. Instance B consumes the attempt through PostgreSQL, verifies Google identity, and commits a new user/identity/seed board together if needed. It issues the signed session and redirects to `/`.
3. Another instance validates the session, resolves its internal user, and reads only that user's board. No browser-provided user ID or email selects ownership.
4. Manual edits validate the board and conditionally increment its stored revision. Chat reads the owned board, closes the connection, calls OpenRouter, then conditionally commits against the original revision. A concurrent edit produces 409.
5. Logout clears browser credentials/private UI state; expiry returns 401. New instances and redeployment keep boards and pending OAuth attempts in PostgreSQL. Cookie validation remains stable with the same configured secret; preview secrets/data remain separate.

## Remaining setup prerequisites

Part 11 needs no external account changes. Before preview deployment, obtain repository/Vercel project access, choose the stable preview/production hostnames and function/database region, provision separate Neon databases/roles, and configure the Google clients and environment secrets. These account-specific values are intentionally unresolved; placeholders are not registered callback URLs. Real Google sign-in, Vercel builds/routing, PostgreSQL connectivity/concurrency, and redeployment persistence remain checks in Parts 12-15.
