import os
import secrets
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app.auth import SESSION_COOKIE, SESSION_MAX_AGE, router as auth_router

STATIC_DIR = Path(__file__).parent / "static"


def create_app(static_dir: Path = STATIC_DIR, *, session_secret: str | None = None) -> FastAPI:
    app = FastAPI(title="Kanban")
    api = FastAPI(title="Kanban API")
    api.add_middleware(
        SessionMiddleware,
        secret_key=session_secret or os.environ.get("SESSION_SECRET") or secrets.token_urlsafe(32),
        session_cookie=SESSION_COOKIE,
        max_age=SESSION_MAX_AGE,
        same_site="strict",
        https_only=False,
    )

    @api.middleware("http")
    async def no_cache(request: Request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response

    api.include_router(auth_router)

    @api.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    app.mount("/api", api)
    app.mount("/", StaticFiles(directory=static_dir, html=True, check_dir=False), name="frontend")
    return app


app = create_app()
