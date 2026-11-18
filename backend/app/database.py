import sqlite3
from contextlib import contextmanager
from pathlib import Path

import psycopg
from fastapi import Request
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from app.models import Board, User

SEED_PATH = Path(__file__).with_name("seed.json")
Database = Path | str
GOOGLE_ISSUER = "https://accounts.google.com"


def is_postgres(target: Database) -> bool:
    return isinstance(target, str) and target.startswith(("postgresql://", "postgres://"))


class PostgresConnection:
    """Share parameter syntax across the small storage layer."""

    def __init__(self, db):
        self.db = db

    def execute(self, sql, params=()):
        return self.db.execute(sql.replace("?", "%s"), params)

    def commit(self):
        self.db.commit()

    def rollback(self):
        self.db.rollback()


@contextmanager
def connection(path: Database, *, timeout: float = 5.0):
    if is_postgres(path):
        with psycopg.connect(path, connect_timeout=max(1, int(timeout)), row_factory=dict_row) as db:
            db.execute("SET LOCAL statement_timeout = '5s'")
            yield PostgresConnection(db)
        return
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


def begin_write(db, target: Database):
    if not is_postgres(target):
        db.execute("BEGIN IMMEDIATE")


def board_value(board: Board, target: Database):
    return Jsonb(board.model_dump()) if is_postgres(target) else board.model_dump_json()


def decode_board(value) -> Board:
    return Board.model_validate(value) if isinstance(value, dict) else Board.model_validate_json(value)


def migrate(target: Database) -> None:
    """Explicit transactional setup; never called by PostgreSQL app startup."""
    if not is_postgres(target):
        Path(target).parent.mkdir(parents=True, exist_ok=True)
    with connection(target) as db:
        begin_write(db, target)
        if is_postgres(target):
            db.execute("SELECT pg_advisory_xact_lock(72412001)")
        db.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)")
        versions = [row["version"] for row in db.execute("SELECT version FROM schema_migrations").fetchall()]
        if any(version != 1 for version in versions):
            raise RuntimeError("Unsupported database schema version")
        if 1 not in versions:
            engine = "postgres" if is_postgres(target) else "sqlite"
            sql = Path(__file__).with_name("migrations").joinpath(f"001_{engine}.sql").read_text()
            for statement in sql.split(";"):
                if statement.strip():
                    db.execute(statement)
            db.execute("INSERT INTO schema_migrations (version) VALUES (1)")
        db.execute("SELECT id, username FROM users LIMIT 0")
        db.execute("SELECT user_id, board_json, revision FROM boards LIMIT 0")
        db.execute("SELECT issuer, subject, user_id, email, display_name FROM google_identities LIMIT 0")
        db.commit()


def check_schema(target: Database) -> None:
    with connection(target) as db:
        versions = [row["version"] for row in db.execute("SELECT version FROM schema_migrations").fetchall()]
        if versions != [1]:
            raise RuntimeError("Run the database migration command before starting the app")


def initialize(path: Database, *, demo: bool = True) -> None:
    if not is_postgres(path) and Path(path).exists():
        with connection(path) as db:
            legacy = db.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'").fetchone()
            versioned = db.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").fetchone()
            if legacy and not versioned:
                backup = Path(str(path) + ".pre-google.db")
                if backup.exists():
                    raise RuntimeError("Legacy backup already exists; migrate explicitly with a new backup path")
                with sqlite3.connect(backup) as destination:
                    db.backup(destination)
    migrate(path)
    if not demo:
        return
    seed = Board.model_validate_json(SEED_PATH.read_text(encoding="utf-8"))
    with connection(path) as db:
        begin_write(db, path)
        db.execute("INSERT INTO users (username) VALUES (?) ON CONFLICT(username) DO NOTHING", ("user",))
        user_id = db.execute("SELECT id FROM users WHERE username = ?", ("user",)).fetchone()["id"]
        db.execute("INSERT INTO boards (user_id, board_json) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING",
                   (user_id, board_value(seed, path)))
        db.commit()


def get_database_path(request: Request) -> Database:
    return request.app.state.database_path


def find_user(path: Database, username: str) -> User | None:
    with connection(path) as db:
        row = db.execute("SELECT id, username FROM users WHERE username = ?", (username,)).fetchone()
    return User(id=row["id"], username=row["username"]) if row else None


def find_user_by_id(path: Database, user_id: int) -> User | None:
    with connection(path) as db:
        row = db.execute("SELECT id, username FROM users WHERE id = ?", (user_id,)).fetchone()
    return User(id=row["id"], username=row["username"]) if row else None


def provision_google_user(path: Database, *, issuer: str, subject: str,
                          email: str | None = None, display_name: str | None = None) -> User:
    """Call only after cryptographic OIDC validation (Part 13), never with browser claims."""
    if issuer not in (GOOGLE_ISSUER, "accounts.google.com") or not isinstance(subject, str) or not 1 <= len(subject) <= 255:
        raise ValueError("Invalid Google identity")
    username = f"google:{subject}"
    seed = Board.model_validate_json(SEED_PATH.read_text(encoding="utf-8"))
    with connection(path) as db:
        begin_write(db, path)
        db.execute("INSERT INTO users (username) VALUES (?) ON CONFLICT(username) DO NOTHING", (username,))
        user_id = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()["id"]
        db.execute("""INSERT INTO google_identities (issuer, subject, user_id, email, display_name)
            VALUES (?, ?, ?, ?, ?) ON CONFLICT(issuer, subject) DO NOTHING""",
                   (GOOGLE_ISSUER, subject, user_id, email, display_name))
        identity = db.execute("SELECT user_id FROM google_identities WHERE issuer = ? AND subject = ?",
                              (GOOGLE_ISSUER, subject)).fetchone()
        if identity["user_id"] != user_id:
            raise RuntimeError("Inconsistent Google identity ownership")
        db.execute("UPDATE google_identities SET email = ?, display_name = ? WHERE issuer = ? AND subject = ?",
                   (email, display_name, GOOGLE_ISSUER, subject))
        db.execute("INSERT INTO boards (user_id, board_json) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING",
                   (user_id, board_value(seed, path)))
        db.commit()
    return User(id=user_id, username=username)
