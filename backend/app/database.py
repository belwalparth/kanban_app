import sqlite3
from contextlib import contextmanager
from pathlib import Path

from fastapi import Request

from app.models import Board, User

SEED_PATH = Path(__file__).with_name("seed.json")


@contextmanager
def connection(path: Path, *, timeout: float = 5.0):
    db = sqlite3.connect(path, timeout=timeout, isolation_level=None)
    db.row_factory = sqlite3.Row
    try:
        db.execute("PRAGMA foreign_keys = ON")
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def initialize(path: Path) -> None:
    seed = Board.model_validate_json(SEED_PATH.read_text(encoding="utf-8"))
    path.parent.mkdir(parents=True, exist_ok=True)
    with connection(path) as db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                username TEXT NOT NULL UNIQUE CHECK (length(trim(username)) > 0)
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS boards (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                board_json TEXT NOT NULL CHECK (json_valid(board_json)),
                revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
            )
        """)
        db.execute("INSERT INTO users (username) VALUES (?) ON CONFLICT(username) DO NOTHING", ("user",))
        user_id = db.execute("SELECT id FROM users WHERE username = ?", ("user",)).fetchone()["id"]
        db.execute(
            "INSERT INTO boards (user_id, board_json) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING",
            (user_id, seed.model_dump_json()),
        )
        db.commit()


def get_database_path(request: Request) -> Path:
    return request.app.state.database_path


def find_user(path: Path, username: str) -> User | None:
    with connection(path) as db:
        row = db.execute("SELECT id, username FROM users WHERE username = ?", (username,)).fetchone()
    return User(id=row["id"], username=row["username"]) if row else None
