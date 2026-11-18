import logging
import os
import secrets
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path

import psycopg
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from starlette.middleware.sessions import SessionMiddleware

from app.auth import SESSION_COOKIE, SESSION_MAX_AGE, router as auth_router
from app.boards import router as board_router
from app.chat import router as chat_router
from app.database import check_schema, initialize, is_postgres
from app.config import auth_settings
from app.google_auth import create_google_client, router as google_router

STATIC_DIR = Path(__file__).parent / "static"


def create_app(
    static_dir: Path = STATIC_DIR, *, session_secret: str | None = None, database_path: Path | None = None,
    database_url: str | None = None, allow_demo_login: bool | None = None,
) -> FastAPI:
    environment = os.environ.get("APP_ENV", "local")
    if environment not in ("local", "preview", "production"):
        raise RuntimeError("APP_ENV must be local, preview, or production")
    demo = allow_demo_login if allow_demo_login is not None else os.environ.get("ALLOW_DEMO_LOGIN", "false").lower() == "true"
    url = database_url or os.environ.get("DATABASE_URL")
    if url and not is_postgres(url):
        raise RuntimeError("DATABASE_URL must be a PostgreSQL URL")
    secret = session_secret or os.environ.get("SESSION_SECRET")
    if environment != "local" and (not url or not secret or demo):
        raise RuntimeError("Cloud mode requires PostgreSQL, SESSION_SECRET, and disabled demo login")
    settings = auth_settings(environment, secret)
    path = url or (database_path if database_path is not None else Path(
        os.environ.get("DATABASE_PATH", Path(__file__).parent.parent / "kanban.db")
    ))

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if is_postgres(path):
            await run_in_threadpool(check_schema, path)
        else:
            await run_in_threadpool(initialize, path, demo=demo)
        yield

    app = FastAPI(title="Kanban", lifespan=lifespan)
    api = FastAPI(title="Kanban API")
    api.state.database_path = path
    api.state.allow_demo_login = demo
    api.state.auth_settings = settings
    api.state.google = create_google_client(settings) if settings.google_enabled else None
    api.add_middleware(
        SessionMiddleware,
        secret_key=secret or secrets.token_urlsafe(32),
        session_cookie=SESSION_COOKIE,
        max_age=SESSION_MAX_AGE,
        same_site="lax",
        https_only=settings.secure,
    )

    @api.middleware("http")
    async def no_cache(request: Request, call_next):
        if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get("origin") != settings.base_url:
            return JSONResponse(status_code=403, content={"detail": "Request origin is not allowed"},
                                headers={"Cache-Control": "no-store"})
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response

    api.include_router(auth_router)
    api.include_router(google_router)
    api.include_router(board_router)
    api.include_router(chat_router)

    @api.exception_handler(sqlite3.Error)
    async def database_error(request: Request, error: sqlite3.Error):
        code = getattr(error, "sqlite_errorcode", 0) & 0xFF
        if code in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED):
            return JSONResponse(status_code=503, content={"detail": "Database is busy; try again"})
        logging.getLogger(__name__).error("Database operation failed (%s)", type(error).__name__)
        return JSONResponse(status_code=500, content={"detail": "Database operation failed"})

    @api.exception_handler(psycopg.Error)
    async def postgres_error(request: Request, error: psycopg.Error):
        # Driver messages can contain credentials, SQL values, or board content.
        logging.getLogger(__name__).error("Database operation failed (%s)", type(error).__name__)
        transient = isinstance(error, (psycopg.OperationalError, psycopg.errors.QueryCanceled))
        return JSONResponse(status_code=503 if transient else 500,
                            content={"detail": "Database unavailable; try again" if transient else "Database operation failed"})

    @api.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    app.mount("/api", api)
    app.mount("/", StaticFiles(directory=static_dir, html=True, check_dir=False), name="frontend")
    return app


app = create_app()
