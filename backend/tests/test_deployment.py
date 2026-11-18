"""Function bounds and fail-closed configuration, without cloud credentials."""
import asyncio
import json

import httpx2 as httpx
import pytest
from fastapi.testclient import TestClient

from app import openrouter
from app.chat import get_ai_client
from app.main import MAX_REQUEST_BYTES, create_app
from app.models import MAX_BOARD_BYTES
from app.openrouter import DEFAULT_MODEL, OpenRouterClient


def signed_in(client):
    assert client.post("/api/auth/login", json={"username": "user", "password": "password"}).status_code == 200
    return client


@pytest.mark.parametrize("chunked", [False, True])
def test_oversize_request_is_uncached_and_does_not_write(client, chunked):
    signed_in(client)
    original = client.get("/api/board").json()
    content = b"x" * (MAX_REQUEST_BYTES + 1)
    if chunked:
        content = iter([content[:1_000_000], content[1_000_000:]])
    response = client.put("/api/board", content=content, headers={"Content-Type": "application/json"})
    assert response.status_code == 413
    assert response.headers["cache-control"] == "no-store"
    assert client.get("/api/board").json() == original


def test_oversize_board_rejected_without_echoing_its_content(client):
    signed_in(client)
    original = client.get("/api/board").json()
    submitted = client.get("/api/board").json()
    submitted["board"]["columns"][0]["cards"][0]["details"] = "private-content" * (MAX_BOARD_BYTES // 14 + 1)
    response = client.put("/api/board", json=submitted)
    assert response.status_code == 422
    assert "1 MB size limit" in response.text
    assert "private-content" not in response.text
    assert len(response.content) < 2000
    assert client.get("/api/board").json() == original


def test_validation_errors_are_bounded_and_do_not_echo_passwords(client):
    response = client.post("/api/auth/login", json={"username": [], "password": {"secret": "do-not-echo"}})
    assert response.status_code == 422 and "do-not-echo" not in response.text
    signed_in(client)
    invalid = {"revision": 0, "board": {"columns": [{"id": "invalid", "title": "", "cards": [{}] * 1000}] * 5}}
    response = client.put("/api/board", json=invalid)
    assert response.status_code == 422
    assert len(response.json()["detail"]) <= 20
    assert len(response.content) < 10_000


def test_provider_total_timeout_preserves_the_board_and_does_not_retry(client, monkeypatch):
    signed_in(client)
    original = client.get("/api/board").json()
    calls = []
    async def slow(request):
        calls.append(request)
        await asyncio.sleep(1)
        return httpx.Response(200, json={"choices": [{"message": {"content": "ignored"}}]})
    monkeypatch.setattr(openrouter, "TOTAL_TIMEOUT_SECONDS", 0.02)
    api = next(route.app for route in client.app.routes if route.path == "/api")
    api.dependency_overrides[get_ai_client] = lambda: OpenRouterClient(
        api_key="test", model=DEFAULT_MODEL, transport=httpx.MockTransport(slow))
    response = client.post("/api/chat", json={"revision": original["revision"], "message": "Make changes"})
    assert response.status_code == 504
    assert "timed out" in response.json()["detail"]
    assert len(calls) == 1
    assert client.get("/api/board").json() == original


def test_vercel_never_defaults_to_local_storage(monkeypatch, tmp_path):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.delenv("APP_ENV", raising=False)
    with pytest.raises(RuntimeError, match="explicit preview or production"):
        create_app(tmp_path)


def test_cloud_startup_does_not_initialize_or_seed_storage(monkeypatch, tmp_path):
    import app.main as main
    monkeypatch.setenv("APP_ENV", "preview")
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("APP_BASE_URL", "https://preview.example")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "preview-client")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "preview-secret")
    checks = []
    def forbid(*args, **kwargs):
        pytest.fail("Cloud startup must not initialize or seed storage")
    monkeypatch.setattr(main, "initialize", forbid)
    monkeypatch.setattr(main, "check_schema", lambda target: checks.append(target))
    with TestClient(create_app(tmp_path, database_url="postgresql://preview-test", session_secret="x" * 32,
                               allow_demo_login=False), base_url="https://preview.example") as preview:
        assert preview.get("/api/health").status_code == 200
        assert preview.get("/api/auth/config").json() == {"google": True, "demo": False}
    assert checks == ["postgresql://preview-test"]
    assert not list(tmp_path.glob("*.db"))
