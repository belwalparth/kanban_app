import json
import time
from base64 import b64encode
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Barrier

import pytest
from fastapi.testclient import TestClient
from itsdangerous import TimestampSigner

from app import boards
from app.auth import SESSION_COOKIE
from app.database import connection
from app.main import create_app


@pytest.fixture
def authenticated(client):
    assert client.post("/api/auth/login", json={"username": "user", "password": "password"}).status_code == 200
    return client


def database_path(client):
    return next(route.app for route in client.app.routes if route.path == "/api").state.database_path


def test_board_requires_session(client):
    assert client.get("/api/board").status_code == 401
    assert client.put("/api/board", json={"revision": 0, "board": {"columns": []}}).status_code == 401


def test_read_seed_board(authenticated):
    response = authenticated.get("/api/board")
    assert response.status_code == 200
    state = response.json()
    assert state["revision"] == 0
    assert len(state["board"]["columns"]) == 5
    assert sum(len(column["cards"]) for column in state["board"]["columns"]) == 6
    assert response.headers["cache-control"] == "no-store"
    assert set(state) == {"revision", "board"}


def test_all_card_operations_and_rename_round_trip(authenticated):
    state = authenticated.get("/api/board").json()
    columns = state["board"]["columns"]
    columns[0]["cards"].append({"id": "new-card", "title": " New task ", "details": ""})
    created = authenticated.put("/api/board", json=state)
    assert created.status_code == 200
    state = created.json()
    assert state["revision"] == 1
    assert state["board"]["columns"][0]["cards"][-1]["title"] == "New task"

    columns = state["board"]["columns"]
    card = columns[0]["cards"].pop()
    card.update(title=" Finished task ", details="First line\nSecond line")
    columns[4]["cards"].append(card)
    columns[3]["title"] = " Final review "
    updated = authenticated.put("/api/board", json=state)
    assert updated.status_code == 200
    state = updated.json()
    assert state["revision"] == 2
    assert state["board"]["columns"][3]["title"] == "Final review"
    assert state["board"]["columns"][4]["cards"][-1] == {"id": "new-card", "title": "Finished task", "details": "First line\nSecond line"}
    state["board"]["columns"][4]["cards"].pop()
    deleted = authenticated.put("/api/board", json=state)
    assert deleted.status_code == 200
    assert deleted.json()["revision"] == 3
    assert authenticated.get("/api/board").json() == deleted.json()


@pytest.mark.parametrize("revision", [-1, True, 0.0, "0", None])
def test_invalid_revision_does_not_write(authenticated, revision):
    original = authenticated.get("/api/board").json()
    submitted = deepcopy(original)
    submitted["revision"] = revision
    assert authenticated.put("/api/board", json=submitted).status_code == 422
    assert authenticated.get("/api/board").json() == original


@pytest.mark.parametrize("change", [
    "missing-column", "extra-column", "reordered-columns", "changed-column-id", "duplicate-column-id",
    "duplicate-card-same-column", "duplicate-card-other-column", "empty-card-id", "blank-card-id",
    "blank-title", "blank-column-title", "non-string-details", "missing-details", "extra-card-field",
    "extra-column-field", "extra-board-field", "extra-owner", "wrong-columns-type", "missing-board", "missing-revision",
])
def test_invalid_board_is_rejected_without_writing(authenticated, change):
    original = authenticated.get("/api/board").json()
    state = deepcopy(original)
    columns = state["board"]["columns"]
    card = columns[0]["cards"][0]
    if change == "missing-column": columns.pop()
    elif change == "extra-column": columns.append(deepcopy(columns[0]))
    elif change == "reordered-columns": columns.reverse()
    elif change == "changed-column-id": columns[0]["id"] = "elsewhere"
    elif change == "duplicate-column-id": columns[1]["id"] = columns[0]["id"]
    elif change == "duplicate-card-same-column": columns[0]["cards"].append(deepcopy(card))
    elif change == "duplicate-card-other-column": columns[4]["cards"].append(deepcopy(card))
    elif change == "empty-card-id": card["id"] = ""
    elif change == "blank-card-id": card["id"] = "  "
    elif change == "blank-title": card["title"] = " \n "
    elif change == "blank-column-title": columns[0]["title"] = "   "
    elif change == "non-string-details": card["details"] = 42
    elif change == "missing-details": del card["details"]
    elif change == "extra-card-field": card["column_id"] = "backlog"
    elif change == "extra-column-field": columns[0]["owner"] = 2
    elif change == "extra-board-field": state["board"]["user_id"] = 2
    elif change == "extra-owner": state["user_id"] = 2
    elif change == "wrong-columns-type": state["board"]["columns"] = {}
    elif change == "missing-board": del state["board"]
    elif change == "missing-revision": del state["revision"]
    response = authenticated.put("/api/board", json=state)
    assert response.status_code == 422, response.text
    assert authenticated.get("/api/board").json() == original


def test_malformed_json_is_rejected(authenticated):
    original = authenticated.get("/api/board").json()
    assert authenticated.put("/api/board", content="{", headers={"Content-Type": "application/json"}).status_code == 422
    assert authenticated.get("/api/board").json() == original


def test_stale_revision_keeps_newer_board(authenticated):
    original = authenticated.get("/api/board").json()
    edited = deepcopy(original)
    edited["board"]["columns"][0]["title"] = "Saved first"
    first = authenticated.put("/api/board", json=edited)
    assert first.status_code == 200
    assert authenticated.put("/api/board", json=original).status_code == 409
    assert authenticated.get("/api/board").json() == first.json()
    original["revision"] = 10**50
    assert authenticated.put("/api/board", json=original).status_code == 409


def test_missing_board_returns_404_without_recreating_it(authenticated):
    state = authenticated.get("/api/board").json()
    with connection(database_path(authenticated)) as db:
        db.execute("DELETE FROM boards")
    assert authenticated.get("/api/board").status_code == 404
    assert authenticated.put("/api/board", json=state).status_code == 404


def test_removed_user_cannot_use_old_session_or_recreate_account(authenticated):
    state = authenticated.get("/api/board").json()
    path = database_path(authenticated)
    with connection(path) as db:
        db.execute("DELETE FROM users")
    assert authenticated.get("/api/auth/session").status_code == 401
    assert authenticated.get("/api/board").status_code == 401
    assert authenticated.put("/api/board", json=state).status_code == 401
    assert authenticated.post("/api/auth/login", json={"username": "user", "password": "password"}).status_code == 401
    with connection(path) as db:
        assert db.execute("SELECT count(*) FROM users").fetchone()[0] == 0


def test_users_can_only_read_and_update_their_own_boards(authenticated):
    original = authenticated.get("/api/board").json()
    second_board = deepcopy(original["board"])
    second_board["columns"][0]["title"] = "Other user's work"
    path = database_path(authenticated)
    with connection(path) as db:
        other_id = db.execute("INSERT INTO users (username) VALUES (?)", ("other",)).lastrowid
        db.execute("INSERT INTO boards (user_id, board_json) VALUES (?, ?)", (other_id, json.dumps(second_board)))

    # Account management is out of scope; issue a signed test session for the seeded second user.
    cookie = TimestampSigner("test-session-secret").sign(b64encode(json.dumps({"user_id": other_id, "expires_at": int(time.time()) + 3600}).encode())).decode()
    with TestClient(authenticated.app, headers={"Origin": "http://testserver"}) as other:
        other.cookies.set(SESSION_COOKIE, cookie)
        assert other.get("/api/board").json()["board"] == second_board
        state = other.get("/api/board").json()
        state["board"]["columns"][0]["title"] = "Only other changed"
        assert other.put("/api/board", json=state).status_code == 200
        assert authenticated.get("/api/board").json() == original
        malicious = deepcopy(original)
        malicious["user_id"] = other_id
        assert authenticated.put("/api/board", json=malicious).status_code == 422
        assert other.get("/api/board").json()["board"]["columns"][0]["title"] == "Only other changed"


def test_failed_write_rolls_back_board_revision_and_trigger_side_effects(authenticated):
    original = authenticated.get("/api/board").json()
    path = database_path(authenticated)
    with connection(path) as db:
        db.execute("""CREATE TRIGGER fail_save AFTER UPDATE ON boards BEGIN
            INSERT INTO users (username) VALUES ('transient');
            SELECT RAISE(FAIL, 'injected write failure');
        END""")
    state = deepcopy(original)
    state["board"]["columns"][0]["title"] = "Must roll back"
    response = authenticated.put("/api/board", json=state)
    assert response.status_code == 500
    assert response.json() == {"detail": "Database operation failed"}
    assert authenticated.get("/api/board").json() == original
    with connection(path) as db:
        assert db.execute("SELECT count(*) FROM users WHERE username = 'transient'").fetchone()[0] == 0


def test_busy_database_returns_503_without_writing(authenticated, monkeypatch):
    original = authenticated.get("/api/board").json()
    path = database_path(authenticated)
    monkeypatch.setattr(boards, "connection", lambda path: connection(path, timeout=0.05))
    with connection(path) as lock:
        lock.execute("BEGIN IMMEDIATE")
        response = authenticated.put("/api/board", json=original)
        assert response.status_code == 503
        lock.rollback()
    assert authenticated.get("/api/board").json() == original


def test_concurrent_saves_allow_exactly_one_winner(authenticated):
    original = authenticated.get("/api/board").json()
    cookie = authenticated.cookies.get(SESSION_COOKIE)
    barrier = Barrier(2)

    def save(label):
        state = deepcopy(original)
        state["board"]["columns"][0]["title"] = label
        with TestClient(authenticated.app, headers={"Origin": "http://testserver"}) as tab:
            tab.cookies.set(SESSION_COOKIE, cookie)
            barrier.wait(timeout=10)
            return tab.put("/api/board", json=state)

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(save, ["Tab A", "Tab B"]))
    assert sorted(response.status_code for response in responses) == [200, 409]
    winner = next(response.json() for response in responses if response.status_code == 200)
    assert winner["revision"] == 1
    assert authenticated.get("/api/board").json() == winner


def test_saved_empty_board_survives_app_restart_and_relogin(authenticated, tmp_path):
    state = authenticated.get("/api/board").json()
    for column in state["board"]["columns"]:
        column["cards"] = []
    saved = authenticated.put("/api/board", json=state).json()
    authenticated.post("/api/auth/logout")
    with TestClient(create_app(tmp_path, database_path=database_path(authenticated)), headers={"Origin": "http://testserver"}) as restarted:
        restarted.post("/api/auth/login", json={"username": "user", "password": "password"})
        assert restarted.get("/api/board").json() == saved
