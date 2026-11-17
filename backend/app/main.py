import logging
import os
import secrets
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from starlette.middleware.sessions import SessionMiddleware

from app.auth import SESSION_COOKIE, SESSION_MAX_AGE, router as auth_router
from app.boards import router as board_router
from app.chat import router as chat_router
from app.database import initialize

STATIC_DIR = Path(__file__).parent / "static"


def create_app(
    static_dir: Path = STATIC_DIR, *, session_secret: str | None = None, database_path: Path | None = None,
) -> FastAPI:
    path = database_path if database_path is not None else Path(
        os.environ.get("DATABASE_PATH", Path(__file__).parent.parent / "kanban.db")
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await run_in_threadpool(initialize, path)
        yield

    app = FastAPI(title="Kanban", lifespan=lifespan)
    api = FastAPI(title="Kanban API")
    api.state.database_path = path
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
    api.include_router(board_router)
    api.include_router(chat_router)

    @api.exception_handler(sqlite3.Error)
    async def database_error(request: Request, error: sqlite3.Error):
        code = getattr(error, "sqlite_errorcode", 0) & 0xFF
        if code in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED):
            return JSONResponse(status_code=503, content={"detail": "Database is busy; try again"})
        logging.getLogger(__name__).error("Database operation failed: %s", error)
        return JSONResponse(status_code=500, content={"detail": "Database operation failed"})

    @api.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    app.mount("/api", api)
    app.mount("/", StaticFiles(directory=static_dir, html=True, check_dir=False), name="frontend")
    return app


app = create_app()
