"""Shared integration contract. PostgreSQL URL MUST name a disposable test database."""
import json
import os
import sqlite3
import time
from base64 import b64encode
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import psycopg
import pytest
from fastapi import HTTPException, Request
from fastapi.testclient import TestClient
from itsdangerous import TimestampSigner

from app.auth import SESSION_COOKIE
from app.boards import read_board, update_board
from app.database import (GOOGLE_ISSUER, board_value, check_schema, connection,
                          initialize, is_postgres, migrate, provision_google_user)
from app.main import create_app
from app.manage_db import import_demo
from app.models import BoardState


@pytest.fixture(params=["sqlite", "postgres"])
def store(request, tmp_path):
    if request.param == "sqlite":
        target = tmp_path / "identities.db"
    else:
        target = os.environ.get("TEST_DATABASE_URL")
        if not target:
            pytest.skip("TEST_DATABASE_URL is required for PostgreSQL integration")
        # Never reuse the app DATABASE_URL. This database is explicitly disposable.
        with psycopg.connect(target, autocommit=True) as db:
            db.execute("DROP SCHEMA public CASCADE")
            db.execute("CREATE SCHEMA public")
    migrate(target)
    return target


def google(store, subject="one", **profile):
    return provision_google_user(store, issuer=GOOGLE_ISSUER, subject=subject, **profile)


def count(store, table):
    with connection(store) as db:
        return db.execute(f"SELECT count(*) AS n FROM {table}").fetchone()["n"]


def test_migration_repeatable_without_demo_seed(store):
    migrate(store)
    check_schema(store)
    assert count(store, "users") == count(store, "boards") == 0
    with connection(store) as db:
        assert sorted(row["version"] for row in db.execute("SELECT version FROM schema_migrations").fetchall()) == [1, 2]


def test_identity_profile_and_email_are_not_ownership(store):
    first = google(store, email="shared@example.test", display_name="First")
    saved = read_board(first, store)
    saved.board.columns[0].title = "Private changes"
    saved = update_board(saved, first, store)
    again = google(store, email="new@example.test")
    assert again.id == first.id
    assert read_board(again, store) == saved
    other = google(store, "two", email="new@example.test")
    assert other.id != first.id
    assert read_board(other, store).revision == 0
    assert read_board(other, store).board.columns[0].title == "Backlog"
    alias = provision_google_user(store, issuer="accounts.google.com", subject="one")
    assert alias.id == first.id
    assert count(store, "google_identities") == count(store, "boards") == 2


def test_concurrent_first_signins_preserve_exactly_one_board(store):
    barrier = Barrier(6)
    def login(_):
        barrier.wait(timeout=10)
        return google(store)
    with ThreadPoolExecutor(max_workers=6) as pool:
        users = list(pool.map(login, range(6)))
    assert len({user.id for user in users}) == 1
    assert count(store, "users") == count(store, "google_identities") == count(store, "boards") == 1


def test_identity_transaction_rolls_back_on_board_failure(store):
    with connection(store) as db:
        if is_postgres(store):
            db.execute("ALTER TABLE boards ADD CONSTRAINT reject_board CHECK (revision < 0)")
        else:
            db.execute("CREATE TRIGGER reject_board BEFORE INSERT ON boards BEGIN SELECT RAISE(ABORT, 'reject'); END")
    with pytest.raises((sqlite3.IntegrityError, psycopg.IntegrityError)):
        google(store)
    assert count(store, "users") == count(store, "google_identities") == count(store, "boards") == 0


@pytest.mark.parametrize("issuer,subject", [("https://evil.test", "one"), (GOOGLE_ISSUER, ""), (GOOGLE_ISSUER, "x" * 256)])
def test_invalid_identity_cannot_write(store, issuer, subject):
    with pytest.raises(ValueError):
        provision_google_user(store, issuer=issuer, subject=subject)
    assert count(store, "users") == 0


def test_unique_identity_board_and_foreign_keys(store):
    user = google(store)
    statements = [
        ("INSERT INTO boards (user_id, board_json) VALUES (?, ?)", (user.id, board_value(read_board(user, store).board, store))),
        ("INSERT INTO google_identities (issuer, subject, user_id) VALUES (?, ?, ?)", (GOOGLE_ISSUER, "two", user.id)),
        ("INSERT INTO google_identities (issuer, subject, user_id) VALUES (?, ?, ?)", (GOOGLE_ISSUER, "two", 99999)),
    ]
    for sql, params in statements:
        with pytest.raises((sqlite3.IntegrityError, psycopg.IntegrityError)), connection(store) as db:
            db.execute(sql, params)
    with connection(store) as db:
        db.execute("DELETE FROM users WHERE id = ?", (user.id,))
    assert count(store, "boards") == count(store, "google_identities") == 0


def test_concurrent_revision_updates_and_reconnect(store):
    user = google(store)
    barrier = Barrier(2)
    def save(label):
        state = read_board(user, store)
        state.board.columns[0].title = label
        barrier.wait(timeout=10)
        try:
            return update_board(state, user, store)
        except HTTPException as error:
            return error.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(save, ["First", "Second"]))
    assert results.count(409) == 1
    winner = next(result for result in results if isinstance(result, BoardState))
    assert winner.revision == 1
    assert read_board(user, store) == winner
    migrate(store)
    assert read_board(user, store) == winner


def cookie(user, **overrides):
    payload = {"user_id": user.id, "expires_at": int(time.time()) + 3600, **overrides}
    return TimestampSigner("identity-test-secret").sign(b64encode(json.dumps(payload).encode())).decode()


def test_internal_id_sessions_isolate_users_and_survive_new_app(store, tmp_path):
    first, second = google(store), google(store, "two")
    options = {"database_url": store} if is_postgres(store) else {"database_path": store}
    for user, label in [(first, "First private"), (second, "Second private")]:
        with TestClient(create_app(tmp_path, session_secret="identity-test-secret", allow_demo_login=False, **options), headers={"Origin": "http://testserver"}) as client:
            client.cookies.set(SESSION_COOKIE, cookie(user))
            state = client.get("/api/board").json()
            state["board"]["columns"][0]["title"] = label
            assert client.put("/api/board", json=state).status_code == 200
    assert read_board(first, store).board.columns[0].title == "First private"
    assert read_board(second, store).board.columns[0].title == "Second private"
    with TestClient(create_app(tmp_path, session_secret="identity-test-secret", allow_demo_login=False, **options), headers={"Origin": "http://testserver"}) as client:
        assert client.post("/api/auth/login", json={"username": "user", "password": "password"}).status_code == 403
        client.cookies.set(SESSION_COOKIE, cookie(first))
        assert client.get("/api/board").json()["board"]["columns"][0]["title"] == "First private"
        client.cookies.set(SESSION_COOKIE, cookie(first, expires_at=0))
        assert client.get("/api/board").status_code == 401
        assert client.post("/api/chat", json={"revision": 1, "message": "hello"}).status_code == 401


def test_explicit_demo_import_keeps_source_and_revision(store, tmp_path):
    source = tmp_path / "demo.db"
    initialize(source)
    with connection(source) as db:
        original = json.loads(db.execute("SELECT board_json FROM boards").fetchone()["board_json"])
        original["columns"][0]["title"] = "Imported private demo work"
        db.execute("UPDATE boards SET board_json = ?", (json.dumps(original),))
    with connection(source) as db:
        db.execute("UPDATE boards SET revision = 17")
    user = google(store)
    with pytest.raises(ValueError, match="already has a board"):
        import_demo(source, tmp_path / "backup1.db", store, "one")
    assert read_board(user, store).revision == 0
    import_demo(source, tmp_path / "backup2.db", store, "one", replace=True)
    assert read_board(user, store).revision == 17
    assert read_board(user, store).board.model_dump() == original
    with connection(source) as db:
        assert db.execute("SELECT revision FROM boards").fetchone()["revision"] == 17
    with pytest.raises(ValueError, match="already verified"):
        import_demo(source, tmp_path / "backup3.db", store, "absent", replace=True)
    assert count(store, "users") == 1
    with pytest.raises(ValueError, match="Destination must differ"):
        import_demo(source, tmp_path / "backup4.db", source, "one", replace=True)


def test_legacy_sqlite_migration_preserves_saved_data(tmp_path):
    target = tmp_path / "legacy.db"
    initialize(target)
    with connection(target) as db:
        db.execute("DROP TABLE google_identities")
        db.execute("DROP TABLE schema_migrations")
        db.execute("DROP TABLE oauth_login_states")
        db.execute("UPDATE boards SET revision = 9")
        original = db.execute("SELECT board_json FROM boards").fetchone()["board_json"]
    migrate(target)
    with connection(target) as db:
        row = db.execute("SELECT board_json, revision FROM boards").fetchone()
        assert row["board_json"] == original and row["revision"] == 9


def test_cloud_requires_config_and_no_demo(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(RuntimeError):
        create_app(tmp_path, allow_demo_login=False)
    with pytest.raises(RuntimeError):
        create_app(tmp_path, database_url="postgresql://unused", session_secret="secret", allow_demo_login=True)


def test_ai_writes_and_concurrent_manual_conflicts_on_both_engines(store):
    import asyncio
    from app.chat import ChatRequest, answer_chat
    user, other = google(store), google(store, "other")
    untouched = read_board(other, store)
    class AI:
        async def complete(self, *args, **kwargs):
            state = read_board(user, store)
            state.board.columns[0].title = "AI saved"
            return json.dumps({"reply": "Updated", "board": state.board.model_dump()})
    result = asyncio.run(answer_chat(ChatRequest(revision=0, message="Rename"), user, store, AI()))
    assert result.updated and result.state.revision == 1
    assert read_board(other, store) == untouched
    class ConcurrentAI:
        async def complete(self, *args, **kwargs):
            state = read_board(user, store)
            proposed = state.board.model_copy(deep=True)
            proposed.columns[0].title = "Stale AI"
            state.board.columns[0].title = "Manual winner"
            # Proves no database write lock remains held across the provider call.
            update_board(state, user, store)
            return json.dumps({"reply": "Updated", "board": proposed.model_dump()})
    with pytest.raises(HTTPException) as error:
        asyncio.run(answer_chat(ChatRequest(revision=1, message="Rename"), user, store, ConcurrentAI()))
    assert error.value.status_code == 409
    assert read_board(user, store).board.columns[0].title == "Manual winner"
    assert read_board(other, store) == untouched


def test_failed_migration_rolls_back_schema_version(tmp_path):
    target = tmp_path / "broken.db"
    with sqlite3.connect(target) as db:
        db.execute("CREATE TABLE users (wrong_column TEXT)")
    with pytest.raises(sqlite3.OperationalError):
        migrate(target)
    with sqlite3.connect(target) as db:
        assert db.execute("SELECT name FROM sqlite_master WHERE name = 'schema_migrations'").fetchone() is None
        assert db.execute("SELECT name FROM sqlite_master WHERE name = 'google_identities'").fetchone() is None


def test_local_upgrade_backs_up_legacy_database(tmp_path):
    target = tmp_path / "legacy-local.db"
    initialize(target)
    with connection(target) as db:
        db.execute("DROP TABLE google_identities")
        db.execute("DROP TABLE schema_migrations")
        db.execute("DROP TABLE oauth_login_states")
        db.execute("UPDATE boards SET revision = 11")
    initialize(target, demo=False)
    with connection(tmp_path / "legacy-local.db.pre-google.db") as db:
        assert db.execute("SELECT revision FROM boards").fetchone()["revision"] == 11
    assert count(target, "google_identities") == 0


def test_oauth_attempt_is_single_use_across_concurrent_connections(store):
    from app.database import consume_login_attempt, hash_login_value, save_login_attempt
    save_login_attempt(store, "raw-state", "raw-binding", "nonce", "server-verifier")
    with connection(store) as db:
        row = db.execute("SELECT state_hash, browser_binding_hash FROM oauth_login_states").fetchone()
        assert row["state_hash"] == hash_login_value("raw-state")
        assert row["browser_binding_hash"] == hash_login_value("raw-binding")
    assert consume_login_attempt(store, "raw-state", "wrong-browser") is None
    barrier = Barrier(2)
    def consume(_):
        barrier.wait(timeout=10)
        return consume_login_attempt(store, "raw-state", "raw-binding")
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(consume, range(2)))
    assert results.count(None) == 1
    assert next(result for result in results if result) == {"nonce": "nonce", "code_verifier": "server-verifier"}
    save_login_attempt(store, "expired", "binding", "nonce", "verifier")
    with connection(store) as db:
        db.execute("UPDATE oauth_login_states SET expires_at = 0")
    assert consume_login_attempt(store, "expired", "binding") is None
    save_login_attempt(store, "new", "binding", "nonce", "verifier")
    assert count(store, "oauth_login_states") == 1


def test_version_one_sqlite_upgrade_backs_up_board_and_preserves_revision(tmp_path):
    target = tmp_path / "version-one.db"
    initialize(target)
    with connection(target) as db:
        db.execute("DROP TABLE oauth_login_states")
        db.execute("DELETE FROM schema_migrations WHERE version = 2")
        db.execute("UPDATE boards SET revision = 23")
        before = dict(db.execute("SELECT board_json, revision FROM boards").fetchone())
    initialize(target, demo=False)
    backup = tmp_path / "version-one.db.pre-oauth.db"
    with connection(backup) as db:
        assert dict(db.execute("SELECT board_json, revision FROM boards").fetchone()) == before
        assert [row["version"] for row in db.execute("SELECT version FROM schema_migrations")] == [1]
        assert db.execute("SELECT name FROM sqlite_master WHERE name = 'oauth_login_states'").fetchone() is None
    with connection(target) as db:
        assert dict(db.execute("SELECT board_json, revision FROM boards").fetchone()) == before
        assert sorted(row["version"] for row in db.execute("SELECT version FROM schema_migrations")) == [1, 2]
    initialize(target, demo=False)
    with connection(target) as db:
        assert dict(db.execute("SELECT board_json, revision FROM boards").fetchone()) == before


def test_https_preview_sessions_and_writes_survive_new_instances(store, tmp_path, monkeypatch):
    if not is_postgres(store):
        pytest.skip("Cloud runtime requires PostgreSQL")
    monkeypatch.setenv("APP_ENV", "preview")
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("APP_BASE_URL", "https://preview.example")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "preview-client")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "preview-secret")
    secret = "preview-session-secret-32-characters"
    user = google(store)
    payload = {"user_id": user.id, "expires_at": int(time.time()) + 3600}
    (tmp_path / "index.html").write_text("Preview frontend", encoding="utf-8")
    options = {"database_url": store, "session_secret": secret, "allow_demo_login": False}
    preview_app = create_app(tmp_path, **options)
    api = next(route.app for route in preview_app.routes if route.path == "/api")
    @api.get("/test-session")
    def issue_session(request: Request):
        request.session.update(payload)
        return {}
    with TestClient(preview_app, base_url="https://preview.example", headers={"Origin": "https://preview.example"}) as first:
        created = first.get("/api/test-session")
        signed_cookie = first.cookies.get(SESSION_COOKIE)
        response = first.get("/api/auth/session")
        assert response.status_code == 200
        assert response.json()["id"] == user.id
        session_header = created.headers["set-cookie"].lower()
        assert "secure" in session_header and "httponly" in session_header and "samesite=lax" in session_header
        saved = first.get("/api/board").json()
        saved["board"]["columns"][0]["title"] = "Durable preview changes"
        saved = first.put("/api/board", json=saved).json()
        assert saved["revision"] == 1
    with TestClient(create_app(tmp_path, **options), base_url="https://preview.example", headers={"Origin": "https://preview.example"}) as second:
        second.cookies.set(SESSION_COOKIE, signed_cookie, domain="preview.example", path="/")
        response = second.get("/api/board")
        assert response.json() == saved and response.headers["cache-control"] == "no-store"
        assert second.get("/").text == "Preview frontend"
        assert second.get("/api/missing").status_code == 404
        assert second.get("/missing.js").status_code == 404
        callback = second.get("/api/auth/google/callback", follow_redirects=False)
        assert callback.status_code == 303 and callback.headers["cache-control"] == "no-store"
    assert read_board(user, store).revision == 1
