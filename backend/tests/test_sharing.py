"""Part 19 contract on temporary SQLite and explicitly disposable PostgreSQL."""
import asyncio
import json
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier, Event

import psycopg
import pytest
from fastapi import HTTPException

from app.boards import read_board, resolve_board_id, update_board
from app.chat import ChatRequest, answer_chat, get_ai_client
from app.database import (GOOGLE_ISSUER, begin_write, check_schema, connection, hash_login_value,
                          initialize, is_postgres, migrate, provision_google_user)
from app.sharing import InvitationToken, accept_invitation, remove_member
from test_multiple_boards import clients, version_two


@pytest.fixture
def people(store, clients):
    def google(subject, **profile):
        return provision_google_user(store, issuer=GOOGLE_ISSUER, subject=subject,
                                     email=f"{subject}@example.test", email_verified=True, **profile)
    users = [google(name) for name in ("owner", "first", "second", "outsider")]
    return users, [clients(user) for user in users], resolve_board_id(users[0], store)


def invite(client, board_id, email):
    response = client.post(f"/api/boards/{board_id}/invitations", json={"email": email})
    assert response.status_code == 201, response.text
    data = response.json()
    return data, data["link"].split("#invite=")[1]


def join(owner, member, board_id, email):
    data, token = invite(owner, board_id, email)
    response = member.post("/api/invitations/accept", json={"token": token})
    assert response.status_code == 200, response.text
    return data, token


def test_two_members_share_edits_without_exposing_other_boards(store, people):
    users, (owner, first, second, outsider), board_id = people
    url = f"/api/boards/{board_id}"
    private = owner.post("/api/boards", json={"name": "Owner secret"}).json()["id"]
    original = owner.get(url).json()
    data, token = invite(owner, board_id, " FIRST@EXAMPLE.TEST ")
    assert data["email"] == "first@example.test" and data["status"] == "pending"
    assert int(time.time()) + 604790 <= data["expires_at"] <= int(time.time()) + 604800
    assert first.get(url).status_code == 404
    inspect = first.post("/api/invitations/inspect", json={"token": token})
    assert inspect.status_code == 200 and inspect.json()["name"] == "My board"
    assert first.get(url).status_code == 404
    assert outsider.post("/api/invitations/inspect", json={"token": token}).status_code == 403
    assert first.post("/api/invitations/accept", json={"token": token}).status_code == 200
    join(owner, second, board_id, "second@example.test")
    for member in (first, second):
        listed = member.get("/api/boards").json()
        assert next(b for b in listed if b["id"] == board_id)["role"] == "member"
        assert private not in [b["id"] for b in listed]
        assert member.get(f"/api/boards/{private}").status_code == 404
        assert member.get("/api/board").json() != {}  # Legacy route remains the member's own board.
        assert member.get(url).json() == original
    changed = first.get(url).json()
    changed["board"]["columns"][0]["title"] = "Shared column"
    changed["board"]["columns"][1]["cards"].append({"id": "member-card", "title": "Shared task", "details": "Collaborative"})
    assert first.put(url, json=changed).status_code == 200
    assert second.put(url, json=original).status_code == 409
    assert second.get(url).json() == owner.get(url).json()
    assert outsider.get(url).status_code == 404
    members = owner.get(url + "/members").json()
    assert [m["user_id"] for m in members] == [users[1].id, users[2].id]
    assert first.get("/api/board").json()["revision"] == 0


def test_tokens_hash_only_duplicates_replay_and_removal(store, people):
    users, (owner, first, second, outsider), board_id = people
    url = f"/api/boards/{board_id}"
    data, token = invite(owner, board_id, "first@example.test")
    with connection(store) as db:
        record = dict(db.execute("SELECT * FROM board_invitations").fetchone())
        assert record["token_hash"] == hash_login_value(token)
        assert token not in json.dumps(record)
    listed = owner.get(url + "/invitations")
    assert listed.headers["cache-control"] == "no-store"
    assert listed.json() == [{key: data[key] for key in ("id", "email", "expires_at", "status")}]
    assert token not in listed.text and "token_hash" not in listed.text
    assert owner.post(url + "/invitations", json={"email": "FIRST@example.test"}).status_code == 409
    for _ in range(2):
        assert first.post("/api/invitations/accept", json={"token": token}).status_code == 200
    assert owner.post(url + "/invitations", json={"email": "first@example.test"}).status_code == 409
    # A different subject with the same verified email cannot replay a consumed token.
    provision_google_user(store, issuer=GOOGLE_ISSUER, subject="second", email="first@example.test", email_verified=True)
    assert second.post("/api/invitations/accept", json={"token": token}).status_code == 404
    with connection(store) as db:
        assert db.execute("SELECT count(*) AS n FROM board_memberships").fetchone()["n"] == 1
    for _ in range(2):
        assert owner.delete(url + f"/members/{users[1].id}").status_code == 204
    assert first.get(url).status_code == 404
    assert first.post("/api/invitations/accept", json={"token": token}).status_code == 404
    assert board_id not in [b["id"] for b in first.get("/api/boards").json()]
    join(owner, first, board_id, "first@example.test")
    assert first.get(url).status_code == 200
    assert owner.delete(url + f"/members/{users[0].id}").status_code == 400


@pytest.mark.parametrize("verified", [False, None, "true", 1])
def test_unverified_google_email_cannot_accept(store, people, verified):
    users, (owner, first, *_), board_id = people
    data, token = invite(owner, board_id, "first@example.test")
    provision_google_user(store, issuer=GOOGLE_ISSUER, subject="first", email="first@example.test", email_verified=verified)
    assert first.post("/api/invitations/accept", json={"token": token}).status_code == 403
    assert first.post("/api/invitations/inspect", json={"token": token}).status_code == 403
    provision_google_user(store, issuer=GOOGLE_ISSUER, subject="first", email="different@example.test", email_verified=True)
    assert first.post("/api/invitations/accept", json={"token": token}).status_code == 403
    provision_google_user(store, issuer=GOOGLE_ISSUER, subject="first", email=" FIRST@EXAMPLE.TEST ", email_verified=True)
    assert first.post("/api/invitations/accept", json={"token": token}).status_code == 200


@pytest.mark.parametrize("mode", ["expired", "revoked", "unknown"])
def test_unavailable_invitations_never_grant_or_reveal_board(store, people, mode):
    _, (owner, first, *_), board_id = people
    data, token = invite(owner, board_id, "first@example.test")
    url = f"/api/boards/{board_id}/invitations"
    if mode == "expired":
        with connection(store) as db:
            db.execute("UPDATE board_invitations SET expires_at = 0")
            db.commit()
    elif mode == "revoked":
        for _ in range(2):
            assert owner.delete(url + f"/{data['id']}").status_code == 204
    else:
        token = "x" * 43
    for action in ("inspect", "accept"):
        response = first.post(f"/api/invitations/{action}", json={"token": token})
        assert response.status_code == 404 and response.json() == {"detail": "Invitation unavailable"}
    assert first.get(f"/api/boards/{board_id}").status_code == 404
    if mode != "unknown":
        invite(owner, board_id, "first@example.test")  # Replacement after expiration/revocation.


def test_owner_permissions_auth_origin_validation_and_foreign_invite_ids(store, people, clients):
    users, (owner, first, second, outsider), board_id = people
    data, _ = join(owner, first, board_id, "first@example.test")
    url = f"/api/boards/{board_id}"
    state = owner.get(url).json()
    operations = [("GET", url + "/members", None), ("GET", url + "/invitations", None),
                  ("POST", url + "/invitations", {"email": "second@example.test"}),
                  ("DELETE", url + f"/invitations/{data['id']}", None),
                  ("DELETE", url + f"/members/{users[1].id}", None),
                  ("PATCH", url, {"name": "Member rename", "revision": state["revision"]})]
    anonymous = clients()
    for method, path, payload in operations:
        kwargs = {"json": payload} if payload else {}
        assert first.request(method, path, **kwargs).status_code == 403
        assert outsider.request(method, path, **kwargs).status_code == 404
        assert anonymous.request(method, path, **kwargs).status_code == 401
        if method != "GET":
            assert owner.request(method, path, headers={"Origin": "https://foreign.test"}, **kwargs).status_code == 403
    for action in ("inspect", "accept"):
        assert anonymous.post(f"/api/invitations/{action}", json={"token": "x" * 43}).status_code == 401
        assert owner.post(f"/api/invitations/{action}", json={"token": "bad"}).status_code == 422
        assert owner.post(f"/api/invitations/{action}", json={"token": "x" * 43}, headers={"Origin": "https://foreign.test"}).status_code == 403
    for email in ("", "bad", "a@@example.test", "has space@example.test", "x" * 255):
        assert owner.post(url + "/invitations", json={"email": email}).status_code == 422
    other_id = resolve_board_id(users[2], store)
    other_data, token = invite(second, other_id, "outsider@example.test")
    assert owner.delete(url + f"/invitations/{other_data['id']}").status_code == 204
    assert outsider.post("/api/invitations/accept", json={"token": token}).status_code == 200


def test_concurrent_single_use_acceptance_and_two_invites_for_same_user(store, people):
    users, (owner, first, *_), board_id = people
    _, token = invite(owner, board_id, "first@example.test")
    barrier = Barrier(5)
    def accept(_):
        barrier.wait(timeout=10)
        return accept_invitation(InvitationToken(token=token), users[1], store)
    with ThreadPoolExecutor(max_workers=5) as pool:
        assert all(result["id"] == board_id for result in pool.map(accept, range(5)))
    # Another still-valid invitation after a verified email change must not duplicate membership.
    _, other_token = invite(owner, board_id, "alias@example.test")
    provision_google_user(store, issuer=GOOGLE_ISSUER, subject="first", email="alias@example.test", email_verified=True)
    assert first.post("/api/invitations/accept", json={"token": other_token}).status_code == 200
    with connection(store) as db:
        assert db.execute("SELECT count(*) AS n FROM board_memberships").fetchone()["n"] == 1


@pytest.mark.parametrize("changes_board", [False, True])
def test_member_ai_edit_and_removal_during_provider_request(store, people, changes_board):
    users, (owner, first, *_), board_id = people
    join(owner, first, board_id, "first@example.test")
    snapshot = read_board(users[0], store, board_id)
    proposed = snapshot.board.model_copy(deep=True)
    proposed.columns[0].title = "AI shared change"
    class AI:
        async def complete(self, *args, **kwargs):
            return json.dumps({"reply": "Done", "board": proposed.model_dump() if changes_board else None})
    # Actual HTTP chat path accepts members and updates the shared document.
    api = next(route.app for route in first.app.routes if route.path == "/api")
    api.dependency_overrides[get_ai_client] = lambda: AI()
    try:
        response = first.post(f"/api/boards/{board_id}/chat", json={"revision": 0, "message": "Help"})
        assert response.status_code == 200 and response.json()["updated"] == changes_board
    finally:
        api.dependency_overrides.clear()
    snapshot = read_board(users[0], store, board_id)
    proposed.columns[1].title = "Must not commit"
    class RemovedAI:
        async def complete(self, *args, **kwargs):
            remove_member(board_id, users[1].id, users[0], store)
            return json.dumps({"reply": "Done", "board": proposed.model_dump() if changes_board else None})
    with pytest.raises(HTTPException) as error:
        asyncio.run(answer_chat(ChatRequest(revision=snapshot.revision, message="Help"), users[1], store, RemovedAI(), board_id))
    assert error.value.status_code == 404
    assert read_board(users[0], store, board_id) == snapshot
    with pytest.raises(HTTPException) as error:
        update_board(snapshot, users[1], store, board_id)
    assert error.value.status_code == 404


def test_removal_committed_while_manual_write_waits_blocks_commit(store, people, monkeypatch):
    users, (owner, first, *_), board_id = people
    join(owner, first, board_id, "first@example.test")
    snapshot = read_board(users[1], store, board_id)
    attempted = Event()
    from app import boards
    original = boards.check_board_access
    original_begin = boards.begin_write
    def attempting(*args, **kwargs):
        attempted.set()
        return original(*args, **kwargs)
    monkeypatch.setattr(boards, "check_board_access", attempting)
    def attempting_begin(*args, **kwargs):
        if not is_postgres(store):
            attempted.set()
        return original_begin(*args, **kwargs)
    monkeypatch.setattr(boards, "begin_write", attempting_begin)
    with ThreadPoolExecutor(max_workers=1) as pool:
        with connection(store) as db:
            begin_write(db, store)
            if is_postgres(store):
                db.execute("SELECT id FROM boards WHERE id = ? FOR UPDATE", (board_id,))
            db.execute("DELETE FROM board_memberships WHERE board_id = ? AND user_id = ?", (board_id, users[1].id))
            pending = pool.submit(update_board, snapshot, users[1], store, board_id)
            assert attempted.wait(timeout=5)
            db.commit()
        with pytest.raises(HTTPException) as error:
            pending.result(timeout=10)
        assert error.value.status_code == 404
    assert read_board(users[0], store, board_id) == snapshot


def test_authorized_members_compete_with_one_revision_winner(store, people):
    users, (owner, first, second, _), board_id = people
    join(owner, first, board_id, "first@example.test")
    join(owner, second, board_id, "second@example.test")
    barrier = Barrier(2)
    def save(user):
        state = read_board(user, store, board_id)
        state.board.columns[0].title = user.username
        barrier.wait(timeout=10)
        try:
            return update_board(state, user, store, board_id)
        except HTTPException as error:
            return error.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(save, users[1:3]))
    assert results.count(409) == 1
    winner = next(result for result in results if result != 409)
    assert read_board(users[0], store, board_id) == winner


@pytest.mark.parametrize("changes_board", [False, True])
def test_member_ai_cannot_overwrite_other_members_newer_save(store, people, changes_board):
    users, (owner, first, second, _), board_id = people
    join(owner, first, board_id, "first@example.test")
    join(owner, second, board_id, "second@example.test")
    proposed = read_board(users[1], store, board_id).board
    proposed.columns[0].title = "AI stale proposal"
    class AI:
        async def complete(self, *args, **kwargs):
            state = read_board(users[2], store, board_id)
            state.board.columns[0].title = "Other member winner"
            update_board(state, users[2], store, board_id)
            return json.dumps({"reply": "Done", "board": proposed.model_dump() if changes_board else None})
    with pytest.raises(HTTPException) as error:
        asyncio.run(answer_chat(ChatRequest(revision=0, message="Help"), users[1], store, AI(), board_id))
    assert error.value.status_code == 409
    state = read_board(users[0], store, board_id)
    assert state.revision == 1 and state.board.columns[0].title == "Other member winner"


@pytest.fixture
def version_three(store, version_two):
    # Upgrade real populated version 2 SQL to real version 3, without editing migration numbers.
    engine = "postgres" if is_postgres(store) else "sqlite"
    script = Path(__file__).parents[1] / "app" / "migrations" / f"003_{engine}.sql"
    with connection(store) as db:
        begin_write(db, store)
        for statement in script.read_text().split(";"):
            if statement.strip():
                db.execute(statement)
        db.execute("INSERT INTO schema_migrations (version) VALUES (3)")
        db.execute("UPDATE boards SET name = 'Existing named board'")
        db.commit()


def test_schema_four_preserves_existing_private_data_and_requires_verified_signin(store, version_three):
    with connection(store) as db:
        before = {table: [dict(row) for row in db.execute(f"SELECT * FROM {table}")]
                  for table in ("users", "boards", "google_identities", "oauth_login_states")}
    migrate(store)
    migrate(store)
    check_schema(store)
    with connection(store) as db:
        for table, rows in before.items():
            after = [dict(row) for row in db.execute(f"SELECT * FROM {table}")]
            if table == "google_identities":
                assert all(row.pop("email_verified") == 0 for row in after)
            assert after == rows
        assert db.execute("SELECT count(*) AS n FROM board_memberships").fetchone()["n"] == 0
        assert db.execute("SELECT count(*) AS n FROM board_invitations").fetchone()["n"] == 0


def test_schema_four_failure_rolls_back(store, version_three, monkeypatch):
    original = Path.read_text
    def broken(path, *args, **kwargs):
        sql = original(path, *args, **kwargs)
        return sql + "; SELECT * FROM nonexistent_part19;" if path.name.startswith("004_") else sql
    with monkeypatch.context() as patch:
        patch.setattr(Path, "read_text", broken)
        with pytest.raises((sqlite3.DatabaseError, psycopg.Error)):
            migrate(store)
    with connection(store) as db:
        assert sorted(row["version"] for row in db.execute("SELECT version FROM schema_migrations")) == [1, 2, 3]
        assert db.execute("SELECT revision FROM boards ORDER BY id").fetchone()["revision"] == 23
        db.execute("SELECT issuer, subject, user_id, email, display_name FROM google_identities")
    migrate(store)


def test_local_schema_four_upgrade_backs_up_once(store, version_three):
    if is_postgres(store):
        pytest.skip("SQLite automatic backup contract")
    initialize(store, demo=False)
    backup = Path(str(store) + ".pre-sharing.db")
    assert backup.is_file()
    with connection(backup) as db:
        assert sorted(row["version"] for row in db.execute("SELECT version FROM schema_migrations")) == [1, 2, 3]
    initialize(store, demo=False)
