"""Part 16 contract; store uses only temporary SQLite/disposable PostgreSQL."""
import asyncio
import json
import sqlite3
import time
from base64 import b64encode
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from pathlib import Path
from threading import Barrier

import psycopg
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from itsdangerous import TimestampSigner

from app.auth import SESSION_COOKIE
from app.boards import create_board, list_boards, read_board, rename_board, resolve_board_id, update_board
from app.chat import ChatRequest, answer_chat, get_ai_client
from app.database import (GOOGLE_ISSUER, SEED_PATH, begin_write, board_value, check_schema,
                          connection, initialize, is_postgres, migrate, provision_google_user)
from app.main import create_app
from app.manage_db import import_demo
from app.models import Board, BoardName, BoardRename, COLUMN_IDS


def google(store, subject="owner"):
    return provision_google_user(store, issuer=GOOGLE_ISSUER, subject=subject)


@pytest.fixture
def users(store):
    return google(store), google(store, "other")


@pytest.fixture
def clients(store, tmp_path):
    secret = "part16-session-secret-for-test-only"
    options = {"database_url": store} if is_postgres(store) else {"database_path": store}
    app = create_app(tmp_path, session_secret=secret, allow_demo_login=False, **options)
    with ExitStack() as stack:
        def client_for(user=None):
            client = stack.enter_context(TestClient(app, headers={"Origin": "http://testserver"}))
            if user:
                payload = {"user_id": user.id, "expires_at": int(time.time()) + 3600}
                client.cookies.set(SESSION_COOKIE, TimestampSigner(secret).sign(b64encode(json.dumps(payload).encode())).decode())
            return client
        yield client_for


@pytest.fixture
def version_two(store):
    # Reconstruct actual old SQL, rather than deleting a version number on new tables.
    engine = "postgres" if is_postgres(store) else "sqlite"
    scripts = Path(__file__).parents[1] / "app" / "migrations"
    with connection(store) as db:
        begin_write(db, store)
        for table in ("board_invitations", "board_memberships", "oauth_login_states", "google_identities", "boards", "users", "schema_migrations"):
            db.execute(f"DROP TABLE {table}")
        db.execute("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY)")
        for version in (1, 2):
            for sql in scripts.joinpath(f"{version:03}_{engine}.sql").read_text().split(";"):
                if sql.strip():
                    db.execute(sql)
            db.execute("INSERT INTO schema_migrations (version) VALUES (?)", (version,))
        owner = db.execute("INSERT INTO users (username) VALUES ('google:old') RETURNING id").fetchone()["id"]
        seed = Board.model_validate_json(SEED_PATH.read_text())
        seed.columns[0].title = "Existing work \u00e9"
        board_id = db.execute("INSERT INTO boards (user_id, board_json, revision) VALUES (?, ?, 23) RETURNING id",
                              (owner, board_value(seed, store))).fetchone()["id"]
        db.execute("INSERT INTO google_identities (issuer, subject, user_id, email) VALUES (?, 'old', ?, 'old@example.test')",
                   (GOOGLE_ISSUER, owner))
        other = db.execute("INSERT INTO users (username) VALUES ('google:existing-other') RETURNING id").fetchone()["id"]
        seed.columns[0].title = "Other owner's work"
        db.execute("INSERT INTO boards (user_id, board_json, revision) VALUES (?, ?, 8)", (other, board_value(seed, store)))
        db.execute("INSERT INTO google_identities (issuer, subject, user_id) VALUES (?, 'existing-other', ?)", (GOOGLE_ISSUER, other))
        db.execute("""INSERT INTO oauth_login_states (state_hash, browser_binding_hash, nonce, code_verifier, expires_at)
                      VALUES ('state-hash', 'binding-hash', 'nonce', 'verifier', 9999999999)""")
        db.commit()
    return owner, board_id


def test_version_two_upgrade_preserves_ids_json_revision_identity_and_oauth(store, version_two):
    with connection(store) as db:
        before = [dict(row) for row in db.execute("SELECT id, user_id, board_json, revision FROM boards ORDER BY id")]
        identities = [dict(row) for row in db.execute("SELECT issuer, subject, user_id, email, display_name FROM google_identities ORDER BY user_id")]
        attempts = [dict(row) for row in db.execute("SELECT * FROM oauth_login_states")]
    with pytest.raises(RuntimeError, match="migration"):
        check_schema(store)
    migrate(store)
    migrate(store)
    check_schema(store)
    with connection(store) as db:
        assert [dict(row) for row in db.execute("SELECT id, user_id, board_json, revision FROM boards ORDER BY id")] == before
        assert [dict(row) for row in db.execute("SELECT issuer, subject, user_id, email, display_name FROM google_identities ORDER BY user_id")] == identities
        assert [dict(row) for row in db.execute("SELECT * FROM oauth_login_states")] == attempts
        assert db.execute("SELECT name FROM boards").fetchone()["name"] == "My board"
        assert db.execute("SELECT user_id, subject FROM google_identities").fetchone()["user_id"] == version_two[0]
        assert db.execute("SELECT code_verifier FROM oauth_login_states").fetchone()["code_verifier"] == "verifier"
    user = google(store, "old")
    assert user.id == version_two[0]
    extra = create_board(BoardName(name="Second"), user, store)
    assert extra["id"] != version_two[1]
    assert read_board(user, store).revision == 23


def test_failed_version_three_upgrade_rolls_back_old_schema_and_data(store, version_two, monkeypatch):
    original_read = Path.read_text
    def broken_script(path, *args, **kwargs):
        text = original_read(path, *args, **kwargs)
        return text + "; SELECT * FROM missing_part16_table;" if path.name.startswith("003_") else text
    with monkeypatch.context() as patch:
        patch.setattr(Path, "read_text", broken_script)
        with pytest.raises((sqlite3.DatabaseError, psycopg.Error)):
            migrate(store)
    with connection(store) as db:
        assert sorted(row["version"] for row in db.execute("SELECT version FROM schema_migrations")) == [1, 2]
        assert db.execute("SELECT revision FROM boards").fetchone()["revision"] == 23
        assert db.execute("SELECT id FROM boards").fetchone()["id"] == version_two[1]
    with pytest.raises((sqlite3.IntegrityError, psycopg.IntegrityError)), connection(store) as db:
        db.execute("INSERT INTO boards (user_id, board_json) SELECT user_id, board_json FROM boards")
    migrate(store)
    check_schema(store)


def test_local_upgrade_has_one_backup_before_unique_constraint_removed(store, version_two):
    if is_postgres(store):
        pytest.skip("SQLite automatic backup contract")
    initialize(store, demo=False)
    backup = Path(str(store) + ".pre-multiple-boards.db")
    with connection(backup) as db:
        assert db.execute("SELECT revision FROM boards").fetchone()["revision"] == 23
        assert [row["version"] for row in db.execute("SELECT version FROM schema_migrations")] == [1, 2]
        assert "name" not in [row["name"] for row in db.execute("PRAGMA table_info(boards)")]
    initialize(store, demo=False)
    assert read_board(google(store, "old"), store).revision == 23


def test_list_create_empty_and_legacy_routes_remain_on_initial_board(store, users, clients):
    user, other = users
    client = clients(user)
    initial = client.get("/api/board").json()
    original_id = resolve_board_id(user, store)
    created = client.post("/api/boards", json={"name": "  Project two  "})
    assert created.status_code == 201
    extra = created.json()
    assert extra == {"id": extra["id"], "name": "Project two", "revision": 0, "role": "owner"}
    state = client.get(f"/api/boards/{extra['id']}").json()
    assert tuple(column["id"] for column in state["board"]["columns"]) == COLUMN_IDS
    assert all(column["cards"] == [] for column in state["board"]["columns"])
    listed = client.get("/api/boards")
    assert listed.headers["cache-control"] == "no-store"
    assert [board["id"] for board in listed.json()] == [original_id, extra["id"]]
    assert all(set(board) == {"id", "name", "revision", "role"} for board in listed.json())
    initial["board"]["columns"][0]["title"] = "Initial only"
    assert client.put("/api/board", json=initial).status_code == 200
    assert client.get(f"/api/boards/{extra['id']}").json() == state
    assert len(list_boards(other, store)) == 1
    assert client.post("/api/boards", json={"name": "Project two"}).status_code == 201


def test_rename_and_document_saves_share_one_revision_only_on_selected_board(store, users, clients):
    user, _ = users
    client = clients(user)
    initial = client.get("/api/board").json()
    extra = client.post("/api/boards", json={"name": "Second"}).json()
    url = f"/api/boards/{extra['id']}"
    stale = client.get(url).json()
    rename = client.patch(url, json={"name": " Renamed ", "revision": 0})
    assert rename.status_code == 200 and rename.json()["revision"] == 1
    assert rename.json()["name"] == "Renamed"
    assert client.put(url, json=stale).status_code == 409
    assert client.patch(url, json={"name": "Stale", "revision": 0}).status_code == 409
    current = client.get(url).json()
    current["board"]["columns"][0]["title"] = "Different column name"
    saved = client.put(url, json=current)
    assert saved.status_code == 200 and saved.json()["revision"] == 2
    assert client.patch(url, json={"name": "Still stale", "revision": 1}).status_code == 409
    assert client.get("/api/board").json() == initial
    assert client.get(url).json() == saved.json()
    assert client.get("/api/boards").json()[1]["name"] == "Renamed"


@pytest.mark.parametrize("data", [{}, {"name": ""}, {"name": " \t\n"}, {"name": "x" * 101},
                                  {"name": 7}, {"name": "valid", "user_id": 999},
                                  {"name": "valid", "board": {}}])
def test_invalid_names_and_owner_injection_never_create(store, users, clients, data):
    client = clients(users[0])
    before = client.get("/api/boards").json()
    assert client.post("/api/boards", json=data).status_code == 422
    assert client.get("/api/boards").json() == before
    url = f"/api/boards/{before[0]['id']}"
    assert client.patch(url, json={**data, "revision": 0}).status_code == 422
    assert client.get("/api/boards").json() == before


def test_names_and_revisions_limits(store, users, clients):
    client = clients(users[0])
    created = client.post("/api/boards", json={"name": "x" * 100})
    assert created.status_code == 201
    url = f"/api/boards/{created.json()['id']}"
    for revision in (True, "0", -1):
        assert client.patch(url, json={"name": "valid", "revision": revision}).status_code == 422
    assert client.patch(url, json={"name": "valid", "revision": 2**100}).status_code == 409
    for board_id in ("0", "-1", "not-an-id", str(2**63)):
        assert client.get(f"/api/boards/{board_id}").status_code == 422


def test_independent_board_saves_do_not_conflict_but_rename_and_save_of_same_board_do(store, users):
    user = users[0]
    first = resolve_board_id(user, store)
    second = create_board(BoardName(name="Second"), user, store)["id"]
    barrier = Barrier(2)
    def save(board_id):
        state = read_board(user, store, board_id)
        state.board.columns[0].title = f"Saved board {board_id}"
        barrier.wait(timeout=10)
        return update_board(state, user, store, board_id)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(save, (first, second)))
    assert [state.revision for state in results] == [1, 1]
    barrier = Barrier(2)
    original = read_board(user, store, second)
    def compete(operation):
        barrier.wait(timeout=10)
        try:
            if operation == "rename":
                return rename_board(second, BoardRename(name="New name", revision=1), user, store)
            return update_board(original, user, store, second)
        except HTTPException as error:
            return error.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(compete, ("rename", "save")))
    assert results.count(409) == 1
    assert read_board(user, store, second).revision == 2
    assert read_board(user, store, first).revision == 1


def test_all_new_routes_require_auth_and_reject_foreign_or_unknown_boards(store, users, clients):
    owner, other = users
    client, stranger = clients(owner), clients()
    before = client.get("/api/board").json()
    for board_id in (resolve_board_id(other, store), 999999):
        url = f"/api/boards/{board_id}"
        for method, path, payload in (("GET", url, None), ("PUT", url, before),
                                      ("PATCH", url, {"name": "Stolen", "revision": 0}),
                                      ("POST", url + "/chat", {"message": "Change", "revision": 0})):
            response = client.request(method, path, **({"json": payload} if payload else {}))
            assert response.status_code == 404 and response.json() == {"detail": "Board not found"}
            assert response.headers["cache-control"] == "no-store"
            assert stranger.request(method, path, **({"json": payload} if payload else {})).status_code == 401
    assert stranger.get("/api/boards").status_code == 401
    assert stranger.post("/api/boards", json={"name": "No session"}).status_code == 401
    assert client.get("/api/board").json() == before
    assert len(list_boards(other, store)) == 1


def test_new_write_routes_keep_origin_protection(store, users, clients):
    client = clients(users[0])
    board_id = resolve_board_id(users[0], store)
    for method, url in (("POST", "/api/boards"), ("PATCH", f"/api/boards/{board_id}"),
                        ("PUT", f"/api/boards/{board_id}"), ("POST", f"/api/boards/{board_id}/chat")):
        response = client.request(method, url, json={}, headers={"Origin": "https://foreign.example"})
        assert response.status_code == 403
        assert response.headers["cache-control"] == "no-store"


def test_repeat_and_concurrent_signins_preserve_multiple_boards(store, users):
    user = users[0]
    extra = create_board(BoardName(name="Additional"), user, store)
    saved = read_board(user, store, extra["id"])
    saved.board.columns[0].title = "Keep this"
    update_board(saved, user, store, extra["id"])
    before = list_boards(user, store)
    barrier = Barrier(5)
    def login(_):
        barrier.wait(timeout=10)
        return google(store)
    with ThreadPoolExecutor(max_workers=5) as pool:
        returned = list(pool.map(login, range(5)))
    assert all(value.id == user.id for value in returned)
    assert list_boards(user, store) == before
    assert read_board(user, store, extra["id"]).board.columns[0].title == "Keep this"


def test_returning_user_with_no_boards_gets_one_under_concurrent_signins(store, users):
    user = users[0]
    with connection(store) as db:
        db.execute("DELETE FROM boards WHERE user_id = ?", (user.id,))
        db.commit()
    barrier = Barrier(5)
    def login(_):
        barrier.wait(timeout=10)
        return google(store)
    with ThreadPoolExecutor(max_workers=5) as pool:
        assert all(value.id == user.id for value in pool.map(login, range(5)))
    assert len(list_boards(user, store)) == 1


class AI:
    def __init__(self, result, before_reply=None):
        self.result, self.before_reply, self.calls = result, before_reply, []

    async def complete(self, messages, **kwargs):
        self.calls.append(messages)
        if self.before_reply:
            self.before_reply()
        return json.dumps({"reply": "Done", "board": self.result})


def test_explicit_ai_route_sends_only_selected_board_and_saves_only_it(store, users, clients):
    owner, other = users
    client = clients(owner)
    untouched = read_board(owner, store)
    extra = create_board(BoardName(name="AI target"), owner, store)
    state = read_board(owner, store, extra["id"])
    state.board.columns[0].title = "Selected AI change"
    ai = AI(state.board.model_dump())
    api = next(route.app for route in client.app.routes if route.path == "/api")
    api.dependency_overrides[get_ai_client] = lambda: ai
    try:
        response = client.post(f"/api/boards/{extra['id']}/chat", json={"revision": 0, "message": "Rename"})
        assert response.status_code == 200 and response.json()["state"]["revision"] == 1
        sent = json.loads(ai.calls[0][-1]["content"])["board"]
        assert all(column["cards"] == [] for column in sent["columns"])
        assert read_board(owner, store) == untouched
        assert read_board(owner, store, extra["id"]).board.columns[0].title == "Selected AI change"
        calls = len(ai.calls)
        assert client.post(f"/api/boards/{resolve_board_id(other, store)}/chat", json={"revision": 0, "message": "Steal"}).status_code == 404
        assert len(ai.calls) == calls
    finally:
        api.dependency_overrides.clear()


@pytest.mark.parametrize("proposes_update", [False, True])
def test_ai_conflict_is_scoped_to_the_selected_board(store, users, proposes_update):
    owner = users[0]
    extra = create_board(BoardName(name="AI target"), owner, store)
    proposed = read_board(owner, store, extra["id"]).board
    proposed.columns[0].title = "AI update"
    def change_initial():
        state = read_board(owner, store)
        state.board.columns[0].title = "Independent update"
        update_board(state, owner, store)
    ai = AI(proposed.model_dump() if proposes_update else None, change_initial)
    result = asyncio.run(answer_chat(ChatRequest(revision=0, message="Change"), owner, store, ai, extra["id"]))
    assert result.updated == proposes_update
    assert read_board(owner, store).board.columns[0].title == "Independent update"
    revision = result.state.revision
    def change_selected():
        state = read_board(owner, store, extra["id"])
        state.board.columns[0].title = "Manual winner"
        update_board(state, owner, store, extra["id"])
    ai = AI(proposed.model_dump() if proposes_update else None, change_selected)
    with pytest.raises(HTTPException) as error:
        asyncio.run(answer_chat(ChatRequest(revision=revision, message="Change"), owner, store, ai, extra["id"]))
    assert error.value.status_code == 409
    assert read_board(owner, store, extra["id"]).board.columns[0].title == "Manual winner"


def test_import_requires_selected_source_and_owned_destination_and_preserves_other_boards(store, users, tmp_path):
    owner, other = users
    source = tmp_path / "source.db"
    initialize(source)
    with connection(source) as db:
        source_id = db.execute("SELECT id FROM boards").fetchone()["id"]
        db.execute("UPDATE boards SET revision = 17")
    original = read_board(owner, store)
    extra = create_board(BoardName(name="Import target"), owner, store)
    options = {"source_board_id": source_id, "board_id": extra["id"], "replace": True}
    import_demo(source, tmp_path / "backup.db", store, "owner", **options)
    assert read_board(owner, store, extra["id"]).revision == 17
    assert read_board(owner, store) == original
    assert list_boards(owner, store)[1]["name"] == "Import target"
    with pytest.raises(ValueError, match="belong"):
        import_demo(source, tmp_path / "foreign.db", store, "owner", **{**options, "board_id": resolve_board_id(other, store)})
    with pytest.raises(ValueError, match="Source demo board"):
        import_demo(source, tmp_path / "missing-source.db", store, "owner", **{**options, "source_board_id": 999999})
    assert read_board(owner, store) == original
