import json
from base64 import b64encode
from typing import Annotated

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient
from itsdangerous import TimestampSigner

from app.auth import SESSION_COOKIE, SESSION_MAX_AGE, require_user
from app.main import create_app
from app.models import User

VALID_CREDENTIALS = {"username": "user", "password": "password"}


def test_missing_session_is_unauthorized_and_not_cached(client):
    response = client.get("/api/auth/session")
    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}
    assert response.headers["cache-control"] == "no-store"


def test_login_sets_signed_cookie_and_restores_session(client):
    response = client.post("/api/auth/login", json=VALID_CREDENTIALS)
    assert response.status_code == 200
    assert response.json() == {"username": "user", "id": 1}
    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie
    assert "samesite=lax" in cookie
    assert "path=/" in cookie
    assert f"max-age={SESSION_MAX_AGE}" in cookie
    assert "; secure" not in cookie  # MVP is served on local HTTP.
    assert "password" not in cookie
    assert client.get("/api/auth/session").json() == {"username": "user", "id": 1}


@pytest.mark.parametrize("credentials", [
    {"username": "user", "password": "wrong"},
    {"username": "wrong", "password": "password"},
    {"username": "User", "password": "password"},
    {"username": "", "password": ""},
])
def test_invalid_credentials_cannot_authenticate(client, credentials):
    response = client.post("/api/auth/login", json=credentials)
    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid username or password"}
    assert SESSION_COOKIE not in client.cookies
    assert client.get("/api/auth/session").status_code == 401


@pytest.mark.parametrize("credentials", [{}, {"username": "user"}, {"username": 123, "password": "password"}])
def test_malformed_login_is_rejected(client, credentials):
    assert client.post("/api/auth/login", json=credentials).status_code == 422
    assert client.get("/api/auth/session").status_code == 401


def test_tampered_cookie_is_rejected(client):
    client.post("/api/auth/login", json=VALID_CREDENTIALS)
    tampered = client.cookies.get(SESSION_COOKIE) + "tampered"
    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE, tampered)
    assert client.get("/api/auth/session").status_code == 401


def test_expired_cookie_is_rejected(client, monkeypatch):
    with monkeypatch.context() as patch:
        patch.setattr(TimestampSigner, "get_timestamp", lambda self: 0)
        client.post("/api/auth/login", json=VALID_CREDENTIALS)
    assert client.get("/api/auth/session").status_code == 401


def test_unknown_user_in_signed_cookie_is_rejected(client):
    data = b64encode(json.dumps({"username": "other"}).encode())
    cookie = TimestampSigner("test-session-secret").sign(data).decode()
    client.cookies.set(SESSION_COOKIE, cookie)
    assert client.get("/api/auth/session").status_code == 401


def test_logout_clears_cookie_and_protected_access(client):
    client.post("/api/auth/login", json=VALID_CREDENTIALS)
    response = client.post("/api/auth/logout")
    assert response.status_code == 204
    assert response.content == b""
    assert "expires=Thu, 01 Jan 1970" in response.headers["set-cookie"]
    assert SESSION_COOKIE not in client.cookies
    assert client.get("/api/auth/session").status_code == 401
    assert client.post("/api/auth/logout").status_code == 204


def test_failed_login_clears_previous_session(client):
    client.post("/api/auth/login", json=VALID_CREDENTIALS)
    client.post("/api/auth/login", json={"username": "user", "password": "wrong"})
    assert client.get("/api/auth/session").status_code == 401


def test_secret_controls_session_validity_across_app_instances(client, tmp_path):
    client.post("/api/auth/login", json=VALID_CREDENTIALS)
    cookie = client.cookies.get(SESSION_COOKIE)
    for secret, expected_status in [("test-session-secret", 200), ("different-secret", 401)]:
        with TestClient(create_app(tmp_path, session_secret=secret, database_path=tmp_path / "test.db"), headers={"Origin": "http://testserver"}) as other_client:
            other_client.cookies.set(SESSION_COOKIE, cookie)
            assert other_client.get("/api/auth/session").status_code == expected_status


def test_dependency_protects_future_data_routes(client):
    api = next(route.app for route in client.app.routes if route.path == "/api")

    @api.get("/private-test")
    def private_route(user: Annotated[User, Depends(require_user)]):
        return {"owner": user.username}

    assert client.get("/api/private-test").status_code == 401
    client.post("/api/auth/login", json=VALID_CREDENTIALS)
    assert client.get("/api/private-test").json() == {"owner": "user"}
    client.post("/api/auth/logout")
    assert client.get("/api/private-test").status_code == 401
