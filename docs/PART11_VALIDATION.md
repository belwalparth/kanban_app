# Part 11 validation

Completed 2026-11-18: architecture and setup documentation only. Implementation and live deployment validation remain Parts 12-15.

## Repository evidence

Reviewed `frontend/next.config.mjs`, `frontend/package.json`, `Dockerfile`, `backend/pyproject.toml`, `backend/app/main.py`, `auth.py`, `database.py`, `openrouter.py`, and existing PLAN/DATABASE documentation.

- The production UI is already a Next.js static export. Docker copies `frontend/out/` into `app/static/`; the selected Vercel build keeps that layout.
- FastAPI mounts `/api` before `/`; authentication/no-cache middleware belongs to the API sub-app. Keep this separation for public CDN files.
- Python is already constrained to 3.14 with a uv lockfile; Vercel's current Python runtime supports it.
- Current startup creates/seeds local SQLite, sessions identify username, cookies use Strict SameSite without Secure, and an absent session secret produces an instance-local random value. These behaviors require explicit cloud-mode changes before deployment.
- Existing OpenRouter uses `httpx2` with a 30-second HTTP client timeout. A complete-operation deadline and dependency compatibility checks remain implementation work.

## Official documentation checks

| Check | Evidence and result |
| --- | --- |
| FastAPI entrypoint/build | [Current FastAPI guide](https://vercel.com/docs/frameworks/backend/fastapi) supports `app/main.py`, `[tool.vercel] entrypoint`, and a post-install build script. |
| Frontend/static routing | The same guide documents StaticFiles CDN promotion and route precedence; API routes must precede the root static mount. CDN files bypass app guards. Keep static source files in the bundle for initial rollout. |
| Source outside backend root | [Monorepo FAQ](https://vercel.com/docs/monorepos/monorepo-faq) documents the project setting permitting the sibling frontend in the build. |
| Python/dependencies | [Python runtime](https://vercel.com/docs/functions/runtimes/python) supports 3.12/3.13/3.14 and pyproject/uv.lock. [uv tooling](https://vercel.com/i/uv-python-package-manager) confirms uv-based builds. |
| Lifecycle | FastAPI guide supports lifespan with a 500 ms shutdown window; migrations and durable commits must not depend on shutdown. |
| Limits | [Function limits](https://vercel.com/docs/functions/limitations): Hobby Fluid duration ceiling 300 seconds, Python standard bundle 500 MB, buffered request/response 4.5 MB. Selected application duration: 60 seconds. |
| Durable pooled storage | [Neon pooling](https://neon.com/docs/connect/connection-pooling) supports transaction pooling for short-lived/serverless clients and recommends direct connections for migrations/backups. [Psycopg](https://www.psycopg.org/install/) supports Python 3.14 and binary installation. |
| Auth client | [Authlib Starlette](https://docs.authlib.org/en/stable/oauth2/client/web/starlette.html) documents Google discovery/ID-token handling; [web client docs](https://docs.authlib.org/en/stable/oauth2/client/web/index.html#oauth-2-0-code-challenge) document S256 configuration. |
| Provider metadata | [Google discovery](https://accounts.google.com/.well-known/openid-configuration) advertises authorization code, RS256, and S256. No credentials were needed to inspect public metadata. |
| Callback/identity | [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect) documents exact redirect matching, state/nonce checks, and stable subject identity rather than email. |
| Consent audience | [Google app states](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview) documents the basic-identity-scope exception to Testing allowlists. Preview privacy cannot rely on the test-user list. |

The documentation browser could search Vercel/Neon but could not open their Markdown responses. Shell network retrieval initially failed in the sandbox; after network approval, direct `.md` retrieval succeeded. Vercel's current FastAPI page was dated 2026-11-14 and its Python runtime page 2026-08-12; those current pages took precedence over older search snapshots. No credentials or `.env` values were read.

## Design walkthrough

- Traced public login UI -> OAuth start on instance A -> callback/state consumption on instance B -> user/identity/board transaction -> signed session -> board read on instance C. Durable OAuth state and a shared configured signing secret cover cross-instance continuity.
- Traced first/repeated/concurrent login and changed email: issuer/subject selects identity, uniqueness prevents duplicate accounts/boards, existing state is preserved, and no Google login acquires the local shared user's board.
- Traced manual/AI concurrency: close the read connection before the provider request, then conditionally update against the original revision. Stale changes return 409.
- Traced deployment/restart and preview isolation: PostgreSQL owns durable records; preview uses separate data/secrets. Cloud startup requires configuration and never falls back to demo credentials or SQLite.
- Traced callback configuration: exact local paths are specified; preview/production URLs use clearly identified placeholders until real hostnames are selected. Origin-based mutation checks are distinct from the state-protected callback.

## Checks and limits

Documentation diff/whitespace and local Markdown-link checks passed. No app tests were run because runtime code, dependencies, and configuration were unchanged.

Not performed: dependency installation/lockfile resolution, Vercel build/deploy or generated-route inspection, PostgreSQL migrations/concurrency tests, Google client/consent setup, real sign-in, and redeployment persistence. These are scheduled in Parts 12-15. The selected hosting combination is supported by documentation; it has not yet been proven through this repository's deployment.

Before Part 14's preview, setup needs Vercel/repository access, stable preview/production hostnames, separate Neon projects/roles/regions, Google Web application clients, and environment secrets. No account provisioning, billing action, or deployment occurred in Part 11.
