import hashlib
import sqlite3
import time
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
SCHEMA_VERSIONS = (1, 2, 3, 4)


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
        if any(version not in SCHEMA_VERSIONS for version in versions):
            raise RuntimeError("Unsupported database schema version")
        for version in SCHEMA_VERSIONS:
            if version in versions:
                continue
            engine = "postgres" if is_postgres(target) else "sqlite"
            sql = Path(__file__).with_name("migrations").joinpath(f"{version:03}_{engine}.sql").read_text()
            for statement in sql.split(";"):
                if statement.strip():
                    db.execute(statement)
            db.execute("INSERT INTO schema_migrations (version) VALUES (?)", (version,))
        db.execute("SELECT id, username FROM users LIMIT 0")
        db.execute("SELECT id, user_id, name, board_json, revision FROM boards LIMIT 0")
        db.execute("SELECT issuer, subject, user_id, email, display_name FROM google_identities LIMIT 0")
        db.execute("SELECT state_hash, browser_binding_hash, nonce, code_verifier, expires_at FROM oauth_login_states LIMIT 0")
        db.execute("SELECT board_id, user_id, joined_at FROM board_memberships LIMIT 0")
        db.execute("SELECT id, board_id, email, token_hash, expires_at, revoked_at, accepted_by, accepted_at FROM board_invitations LIMIT 0")
        db.commit()


def check_schema(target: Database) -> None:
    with connection(target) as db:
        versions = [row["version"] for row in db.execute("SELECT version FROM schema_migrations").fetchall()]
        if sorted(versions) != list(SCHEMA_VERSIONS):
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
            elif versioned:
                versions = [row["version"] for row in db.execute("SELECT version FROM schema_migrations").fetchall()]
                if sorted(versions) in ([1], [1, 2], [1, 2, 3]):
                    suffix = {1: ".pre-oauth.db", 2: ".pre-multiple-boards.db", 3: ".pre-sharing.db"}[len(versions)]
                    backup = Path(str(path) + suffix)
                    if backup.exists():
                        raise RuntimeError("Upgrade backup already exists; migrate explicitly with a new backup path")
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
        ensure_initial_board(db, path, user_id, seed)
        db.commit()


def ensure_initial_board(db, path: Database, user_id: int, seed: Board) -> None:
    # Serialize returning sign-ins too, including an existing user without a board.
    if is_postgres(path):
        db.execute("SELECT id FROM users WHERE id = ? FOR UPDATE", (user_id,))
    existing = db.execute("SELECT id FROM boards WHERE user_id = ? ORDER BY id LIMIT 1", (user_id,)).fetchone()
    if existing is None:
        db.execute("INSERT INTO boards (user_id, board_json) VALUES (?, ?)", (user_id, board_value(seed, path)))


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


def user_display_name(path: Database, user: User) -> str:
    with connection(path) as db:
        profile = db.execute("SELECT email, display_name FROM google_identities WHERE user_id = ?", (user.id,)).fetchone()
    return (profile["display_name"] or profile["email"] or "Google user") if profile else user.username


def hash_login_value(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def save_login_attempt(path: Database, state: str, binding: str, nonce: str, verifier: str) -> None:
    now = int(time.time())
    with connection(path) as db:
        begin_write(db, path)
        db.execute("DELETE FROM oauth_login_states WHERE expires_at <= ?", (now,))
        db.execute("""INSERT INTO oauth_login_states
            (state_hash, browser_binding_hash, nonce, code_verifier, expires_at) VALUES (?, ?, ?, ?, ?)""",
                   (hash_login_value(state), hash_login_value(binding), nonce, verifier, now + 600))
        db.commit()


def consume_login_attempt(path: Database, state: str, binding: str):
    with connection(path) as db:
        begin_write(db, path)
        attempt = db.execute("""DELETE FROM oauth_login_states
            WHERE state_hash = ? AND browser_binding_hash = ? AND expires_at > ?
            RETURNING nonce, code_verifier""",
                             (hash_login_value(state), hash_login_value(binding), int(time.time()))).fetchone()
        db.commit()
    return dict(attempt) if attempt else None


def provision_google_user(path: Database, *, issuer: str, subject: str,
                          email: str | None = None, display_name: str | None = None,
                          email_verified: bool = False) -> User:
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
        db.execute("UPDATE google_identities SET email = ?, display_name = ?, email_verified = ? WHERE issuer = ? AND subject = ?",
                   (email, display_name, int(email_verified is True and bool(email)), GOOGLE_ISSUER, subject))
        ensure_initial_board(db, path, user_id, seed)
        db.commit()
    return User(id=user_id, username=username)
