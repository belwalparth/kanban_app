import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client(tmp_path):
    (tmp_path / "index.html").write_text("<h1>Project board</h1>", encoding="utf-8")
    (tmp_path / "404.html").write_text("<h1>Page not found</h1>", encoding="utf-8")
    (tmp_path / "_next").mkdir()
    (tmp_path / "_next" / "test.js").write_text("console.log('board')", encoding="utf-8")
    with TestClient(create_app(tmp_path, session_secret="test-session-secret", database_path=tmp_path / "test.db")) as test_client:
        yield test_client
