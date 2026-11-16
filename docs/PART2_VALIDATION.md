# Part 2 validation

Validated on 2026-11-16 using Windows PowerShell, Docker Desktop Linux containers, and Docker Compose.

## Results

- Generated `backend/uv.lock` with `uv lock` against the public PyPI index. Resolved FastAPI 0.163.1, Uvicorn 0.54.0, and pytest 9.2.0; the container uses Python 3.14.2.
- `docker build --target test -t kanban-app-test .` succeeded.
- `docker run --rm kanban-app-test`: 3 passed, no warnings. Tests cover HTML, JSON health, and unknown API paths returning JSON 404 rather than HTML.
- Windows start script built the runtime image and waited for healthy status. Host requests to `/` and `/api/health` returned the expected HTML and JSON.
- A hidden headless Chrome run loaded `/`, executed its actual JavaScript, and rendered `API status: ok` after fetching the same-origin endpoint.
- Windows stop/start scripts removed and recreated the container/network. A temporary marker written as the runtime user under `/data` survived; the marker was then removed. The named volume was retained.
- Both PowerShell scripts passed parser checks. Both shell scripts passed `sh -n` inside the Linux container. Native macOS/Linux start/stop execution was not available and remains unverified.
- `git diff --check` passed. Existing unrelated edits were retained.

## Issues diagnosed

- Sandbox access to Docker configuration/socket was denied; approved execution outside the sandbox reached the running Docker Desktop engine.
- Direct PowerShell script invocation was blocked by the host execution policy. README uses a process-only `-ExecutionPolicy Bypass` invocation; system policy was not changed.
- Initial passing tests reported that current Starlette deprecated its `httpx` adapter in favor of `httpx2`. Updated the development dependency, regenerated the lock, rebuilt, and reran all backend tests without warnings.

## Boundaries

The running container serves the example page, not the Next.js demo. No login, SQLite schema, or AI integration was introduced. `/data/kanban.db` is only the reserved future database path. The root `.env` was not read or copied; Part 2 requires no secrets. The runtime runs as a non-root user, and the host port is bound to loopback.

Implementation references: [FastAPI Docker guidance](https://fastapi.tiangolo.com/deployment/docker/) and [uv Docker integration](https://docs.astral.sh/uv/guides/integration/docker/). Exact Python dependency artifacts and hashes are recorded in `backend/uv.lock`.
