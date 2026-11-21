import json
import sqlite3

import pytest

from app.database import SEED_PATH, connection, initialize
from app.main import create_app
from fastapi.testclient import TestClient


def test_initialization_creates_parent_database_and_seed(tmp_path):
    path = tmp_path / "nested" / "kanban.db"
    initialize(path)
    assert path.is_file()
    with connection(path) as db:
        assert db.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert db.execute("SELECT count(*) FROM users").fetchone()[0] == 1
        row = db.execute("SELECT board_json, revision FROM boards").fetchone()
        assert row["revision"] == 0
        assert json.loads(row["board_json"]) == json.loads(SEED_PATH.read_text(encoding="utf-8"))


def test_repeated_initialization_does_not_overwrite_saved_board(tmp_path):
    path = tmp_path / "kanban.db"
    initialize(path)
    saved = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    saved["columns"][0]["title"] = "Already saved"
    with connection(path) as db:
        db.execute("UPDATE boards SET board_json = ?, revision = 7", (json.dumps(saved),))
    initialize(path)
    with connection(path) as db:
        assert db.execute("SELECT count(*) FROM users").fetchone()[0] == 1
        assert db.execute("SELECT count(*) FROM boards").fetchone()[0] == 1
        row = db.execute("SELECT board_json, revision FROM boards").fetchone()
        assert json.loads(row["board_json"]) == saved
        assert row["revision"] == 7


@pytest.mark.parametrize("sql, params", [
    ("INSERT INTO users (username) VALUES (?)", ("user",)),
    ("INSERT INTO users (username) VALUES (?)", ("   ",)),
    ("INSERT INTO boards (user_id, name, board_json) SELECT id, ' ', '{}' FROM users", ()),
    ("INSERT INTO boards (user_id, board_json) VALUES (?, ?)", (9999, "{}")),
    ("UPDATE boards SET board_json = ?", ("not-json",)),
    ("UPDATE boards SET revision = ?", (-1,)),
])
def test_schema_constraints_are_enforced(tmp_path, sql, params):
    path = tmp_path / "kanban.db"
    initialize(path)
    with pytest.raises(sqlite3.IntegrityError), connection(path) as db:
        db.execute(sql, params)


def test_deleting_user_cascades_to_only_their_board(tmp_path):
    path = tmp_path / "kanban.db"
    initialize(path)
    with connection(path) as db:
        other_id = db.execute("INSERT INTO users (username) VALUES ('other')").lastrowid
        db.execute("INSERT INTO boards (user_id, board_json) VALUES (?, '{}')", (other_id,))
        db.execute("DELETE FROM users WHERE username = 'user'")
        assert [row[0] for row in db.execute("SELECT user_id FROM boards")] == [other_id]


def test_seed_uses_actual_user_id_instead_of_assuming_one(tmp_path):
    path = tmp_path / "kanban.db"
    initialize(path)
    with connection(path) as db:
        db.execute("DELETE FROM users")
        db.execute("INSERT INTO users (id, username) VALUES (42, 'user')")
    initialize(path)
    with connection(path) as db:
        assert db.execute("SELECT user_id FROM boards").fetchone()[0] == 42


def test_failed_initialization_rolls_back_partial_seed(tmp_path):
    path = tmp_path / "kanban.db"
    initialize(path)
    with connection(path) as db:
        db.execute("DELETE FROM users")
        db.execute("CREATE TRIGGER reject_seed BEFORE INSERT ON boards BEGIN SELECT RAISE(ABORT, 'fail seed'); END")
    with pytest.raises(sqlite3.IntegrityError):
        initialize(path)
    with connection(path) as db:
        assert db.execute("SELECT count(*) FROM users").fetchone()[0] == 0
        assert db.execute("SELECT count(*) FROM boards").fetchone()[0] == 0


def test_database_path_environment_is_used(tmp_path, monkeypatch):
    path = tmp_path / "configured" / "board.db"
    monkeypatch.setenv("DATABASE_PATH", str(path))
    with TestClient(create_app(tmp_path)) as client:
        assert client.get("/api/health").status_code == 200
    assert path.is_file()
