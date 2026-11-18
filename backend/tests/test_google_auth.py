"""Real Authlib signature/claim checks with mocked Google discovery, keys, and token HTTP."""
import hashlib
import json
import logging
import time
from base64 import b64decode, urlsafe_b64encode
from urllib.parse import parse_qs, urlsplit

import httpx2 as httpx
import pytest
from fastapi.testclient import TestClient
from joserfc import jwt
from joserfc.jwk import RSAKey

from app.auth import SESSION_COOKIE
from app.database import (GOOGLE_ISSUER, connection, consume_login_attempt,
                          hash_login_value, save_login_attempt)
from app.google_auth import BINDING_COOKIE, OAuthAccessLogFilter
from app.main import create_app


@pytest.fixture
def google_app(tmp_path, monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-google-client")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "test-google-secret")
    monkeypatch.setenv("SESSION_SECRET", "test-google-session-secret-32-characters")
    key = RSAKey.generate_key(2048, parameters={"kid": "google-test"})
    data = {"claims": {}, "tokens": 0, "nonce": "", "token_body": {}, "failure": None, "subject": "google-one"}
    path = tmp_path / "oauth.db"

    def google_http(request):
        if request.url.path.endswith("openid-configuration"):
            if data["failure"] == "discovery":
                return httpx.Response(503)
            return httpx.Response(200, json={
                "issuer": GOOGLE_ISSUER,
                "authorization_endpoint": "https://accounts.google.com/o/oauth2/v2/auth",
                "token_endpoint": "https://oauth2.googleapis.com/token",
                "jwks_uri": "https://www.googleapis.com/oauth2/v3/certs",
                "id_token_signing_alg_values_supported": ["RS256"],
            })
        if request.url.path.endswith("/certs"):
            return httpx.Response(200, json={"keys": [key.as_dict(private=False)]})
        assert str(request.url) == "https://oauth2.googleapis.com/token"
        data["tokens"] += 1
        data["token_body"] = {key: values[0] for key, values in parse_qs(request.content.decode()).items()}
        if data["failure"] == "network":
            raise httpx.ConnectError("provider connection failed", request=request)
        if data["failure"] == "timeout":
            raise httpx.ReadTimeout("provider timeout", request=request)
        if data["failure"] == "provider":
            return httpx.Response(400, json={"error": "invalid_grant", "error_description": "sensitive provider message"})
        if data["failure"] == "missing-token":
            return httpx.Response(200, json={"access_token": "provider-access-token", "token_type": "Bearer"})
        now = int(time.time())
        claims = {"iss": GOOGLE_ISSUER, "sub": data["subject"], "aud": "test-google-client",
                  "exp": now + 3600, "iat": now, "nonce": data["nonce"],
                  "email": "same@example.test", "name": "Google Person", **data["claims"]}
        for claim in data.get("omit", []):
            claims.pop(claim, None)
        signing_key = RSAKey.generate_key(2048, parameters={"kid": "google-test"}) if data["failure"] == "signature" else key
        token = jwt.encode({"alg": "RS256", "kid": "google-test"}, claims, signing_key)
        return httpx.Response(200, json={"access_token": "provider-access-token", "token_type": "Bearer", "id_token": token})

    def make_app():
        app = create_app(tmp_path, database_path=path, allow_demo_login=False)
        api = next(route.app for route in app.routes if route.path == "/api")
        api.state.google.client_kwargs["transport"] = httpx.MockTransport(google_http)
        return app
    app = make_app()
    with TestClient(app, headers={"Origin": "http://testserver"}) as client:
        yield client, data, path, make_app


def start(client, data):
    response = client.get("/api/auth/google/start", follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["cache-control"] == "no-store"
    params = {key: values[0] for key, values in parse_qs(urlsplit(response.headers["location"]).query).items()}
    data["nonce"] = params["nonce"]
    return params


def finish(client, params, **extra):
    return client.get("/api/auth/google/callback", params={"state": params["state"], "code": "auth-code", **extra}, follow_redirects=False)


def test_code_flow_pkce_server_state_and_internal_session(google_app):
    client, data, path, _ = google_app
    params = start(client, data)
    assert params["scope"] == "openid email profile"
    assert params["response_type"] == "code"
    assert params["code_challenge_method"] == "S256"
    assert params["redirect_uri"] == "http://testserver/api/auth/google/callback"
    assert "access_type" not in params
    cookie = client.cookies.get(BINDING_COOKIE)
    with connection(path) as db:
        attempt = db.execute("SELECT * FROM oauth_login_states").fetchone()
        assert attempt["state_hash"] == hash_login_value(params["state"])
        assert attempt["browser_binding_hash"] == hash_login_value(cookie)
        assert attempt["nonce"] == params["nonce"]
        challenge = urlsafe_b64encode(hashlib.sha256(attempt["code_verifier"].encode()).digest()).rstrip(b"=").decode()
        assert params["code_challenge"] == challenge
        verifier = attempt["code_verifier"]
    assert SESSION_COOKIE not in client.cookies
    result = finish(client, params, next="https://evil.example/")
    assert result.status_code == 303 and result.headers["location"] == "/"
    assert result.headers["cache-control"] == "no-store"
    assert data["token_body"]["code_verifier"] == verifier
    assert data["token_body"]["redirect_uri"] == params["redirect_uri"]
    assert BINDING_COOKIE not in client.cookies
    payload = json.loads(b64decode(client.cookies.get(SESSION_COOKIE).split(".")[0]))
    assert set(payload) == {"user_id", "expires_at"}
    assert int(time.time()) + 28700 < payload["expires_at"] <= int(time.time()) + 28800
    assert client.get("/api/auth/session").json() == {"username": "Google Person", "id": payload["user_id"]}
    assert client.get("/api/board").status_code == 200
    with connection(path) as db:
        assert db.execute("SELECT count(*) FROM oauth_login_states").fetchone()[0] == 0
        assert db.execute("SELECT count(*) FROM users").fetchone()[0] == 1


@pytest.mark.parametrize("claims", [
    {"iss": "https://evil.example"}, {"aud": "another-client", "azp": "test-google-client"},
    {"aud": ["test-google-client", "other-client"], "azp": "wrong"},
    {"aud": ["test-google-client", "other-client"]},
    {"nonce": "wrong"}, {"exp": 1}, {"iat": 9999999999}, {"sub": ""},
])
def test_invalid_signed_claims_rejected_without_creating_users(google_app, claims):
    client, data, path, _ = google_app
    params = start(client, data)
    data["claims"] = claims
    result = finish(client, params)
    assert result.headers["location"] == "/?auth_error=failed"
    assert client.get("/api/auth/session").status_code == 401
    assert BINDING_COOKIE not in client.cookies
    with connection(path) as db:
        assert db.execute("SELECT count(*) FROM users").fetchone()[0] == 0


@pytest.mark.parametrize("failure", ["signature", "network", "timeout", "provider", "missing-token"])
def test_provider_or_signature_failure_consumes_attempt_without_login(google_app, failure):
    client, data, path, _ = google_app
    params = start(client, data)
    binding = client.cookies.get(BINDING_COOKIE)
    data["failure"] = failure
    assert finish(client, params).headers["location"] == "/?auth_error=failed"
    client.cookies.set(BINDING_COOKIE, binding)
    assert finish(client, params).headers["location"] == "/?auth_error=invalid"
    assert data["tokens"] == 1
    assert client.get("/api/board").status_code == 401


def test_missing_nonce_rejected(google_app):
    client, data, _, _ = google_app
    params = start(client, data)
    data["omit"] = ["nonce"]
    assert finish(client, params).headers["location"] == "/?auth_error=failed"


def test_wrong_browser_wrong_state_and_expired_attempt(google_app):
    client, data, path, _ = google_app
    params = start(client, data)
    binding = client.cookies.get(BINDING_COOKIE)
    client.cookies.clear()
    client.cookies.set(BINDING_COOKIE, "wrong-browser")
    assert finish(client, params).headers["location"] == "/?auth_error=invalid"
    assert data["tokens"] == 0
    client.cookies.set(BINDING_COOKIE, binding)
    assert finish(client, {"state": "wrong-state"}).headers["location"] == "/?auth_error=invalid"
    client.cookies.set(BINDING_COOKIE, binding)
    with connection(path) as db:
        db.execute("UPDATE oauth_login_states SET expires_at = 0")
    assert finish(client, params).headers["location"] == "/?auth_error=invalid"
    start(client, data)
    with connection(path) as db:
        assert db.execute("SELECT count(*) FROM oauth_login_states").fetchone()[0] == 1


def test_cancelled_consent_and_replay(google_app):
    client, data, _, _ = google_app
    params = start(client, data)
    assert finish(client, params, error="access_denied", error_description="do not show this").headers["location"] == "/?auth_error=cancelled"
    assert data["tokens"] == 0
    assert finish(client, params).headers["location"] == "/?auth_error=invalid"


def test_cross_instance_callback_session_logout_and_private_boards(google_app):
    client, data, path, make_app = google_app
    params = start(client, data)
    binding = client.cookies.get(BINDING_COOKIE)
    with TestClient(make_app(), headers={"Origin": "http://testserver"}) as other_instance:
        other_instance.cookies.set(BINDING_COOKIE, binding)
        assert finish(other_instance, params).headers["location"] == "/"
        first_session = other_instance.cookies.get(SESSION_COOKIE)
        state = other_instance.get("/api/board").json()
        state["board"]["columns"][0]["title"] = "First private"
        assert other_instance.put("/api/board", json=state).status_code == 200
    client.cookies.set(SESSION_COOKIE, first_session, domain="testserver.local", path="/")
    assert client.get("/api/board").json()["board"]["columns"][0]["title"] == "First private"
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/board").status_code == 401
    data["subject"] = "google-two"
    params = start(client, data)
    assert finish(client, params).headers["location"] == "/"
    assert client.get("/api/board").json()["board"]["columns"][0]["title"] == "Backlog"
    assert client.post("/api/auth/login", json={"username": "user", "password": "password"}).status_code == 403


def test_discovery_failure_is_retryable_and_no_session_created(google_app):
    client, data, _, _ = google_app
    data["failure"] = "discovery"
    response = client.get("/api/auth/google/start", follow_redirects=False)
    assert response.headers["location"] == "/?auth_error=unavailable"
    assert SESSION_COOKIE not in client.cookies


@pytest.mark.parametrize("url", ["/api/auth/login", "/api/auth/logout", "/api/board", "/api/chat"])
@pytest.mark.parametrize("origin", [None, "null", "https://evil.example", "http://testserver/"])
def test_unsafe_requests_require_exact_origin(client, url, origin):
    client.headers.pop("origin", None)
    headers = {} if origin is None else {"Origin": origin}
    response = client.request("PUT" if url == "/api/board" else "POST", url, json={}, headers=headers)
    assert response.status_code == 403
    assert response.headers["cache-control"] == "no-store"


def test_secure_cookie_and_untrusted_host_does_not_change_callback(google_app, monkeypatch, tmp_path):
    _, data, path, make_app = google_app
    monkeypatch.setenv("APP_BASE_URL", "https://kanban.example")
    with TestClient(make_app(), base_url="https://kanban.example", headers={"Origin": "https://kanban.example"}) as client:
        response = client.get("/api/auth/google/start", follow_redirects=False, headers={"Host": "evil.example"})
        assert "Secure" in response.headers["set-cookie"]
        assert "HttpOnly" in response.headers["set-cookie"]
        assert "SameSite=lax" in response.headers["set-cookie"]
        assert "Max-Age=600" in response.headers["set-cookie"]
        params = {key: values[0] for key, values in parse_qs(urlsplit(response.headers["location"]).query).items()}
        data["nonce"] = params["nonce"]
        assert params["redirect_uri"] == "https://kanban.example/api/auth/google/callback"
        response = finish(client, params)
        cookies = response.headers.get_list("set-cookie")
        session = next(value for value in cookies if value.startswith(SESSION_COOKIE))
        assert "secure" in session.lower() and "httponly" in session.lower() and "samesite=lax" in session.lower()
        assert "domain=" not in session.lower() and "path=/;" in session.lower()


def test_logging_filter_removes_oauth_query_values():
    record = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d',
                               ("client", "GET", "/api/auth/google/callback?code=secret&state=secret", "1.1", 303), None)
    OAuthAccessLogFilter().filter(record)
    assert "secret" not in record.getMessage()


def test_missing_google_configuration_is_clear(client):
    assert client.get("/api/auth/config").json() == {"google": False, "demo": True}
    assert client.get("/api/auth/google/start", follow_redirects=False).headers["location"] == "/?auth_error=unavailable"


@pytest.mark.parametrize("value", ["https://app.example/", "https://app.example/path", "https://name:password@app.example", "file:///app", "https://app.example?query=yes"])
def test_invalid_base_url_is_rejected(monkeypatch, tmp_path, value):
    monkeypatch.setenv("APP_BASE_URL", value)
    with pytest.raises(RuntimeError, match="APP_BASE_URL"):
        create_app(tmp_path)


def test_cloud_requires_google_https_and_stable_secret(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("ALLOW_DEMO_LOGIN", "false")
    monkeypatch.setenv("APP_BASE_URL", "https://kanban.example")
    options = {"database_url": "postgresql://unused", "session_secret": "x" * 32}
    with pytest.raises(RuntimeError, match="Google"):
        create_app(tmp_path, **options)
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-id")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "client-secret")
    with pytest.raises(RuntimeError, match="SESSION_SECRET"):
        create_app(tmp_path, database_url="postgresql://unused", session_secret="short")
    monkeypatch.setenv("APP_BASE_URL", "http://kanban.example")
    with pytest.raises(RuntimeError, match="HTTPS"):
        create_app(tmp_path, **options)
    monkeypatch.setenv("APP_BASE_URL", "https://kanban.example")
    api = next(route.app for route in create_app(tmp_path, **options).routes if route.path == "/api")
    assert api.state.auth_settings.secure and not api.state.allow_demo_login


def test_two_google_sessions_cannot_ai_edit_each_others_board(google_app):
    from app.chat import get_ai_client
    client, data, _, _ = google_app
    params = start(client, data)
    assert finish(client, params).headers["location"] == "/"
    first_cookie = client.cookies.get(SESSION_COOKIE)
    first_board = client.get("/api/board").json()
    first_board["board"]["columns"][0]["title"] = "First secret"
    first_board = client.put("/api/board", json=first_board).json()
    data["subject"] = "second-subject"
    params = start(client, data)
    assert finish(client, params).headers["location"] == "/"
    class AI:
        async def complete(self, messages, **kwargs):
            board = json.loads(messages[-1]["content"])["board"]
            assert board["columns"][0]["title"] == "Backlog"
            board["columns"][0]["title"] = "Second AI edit"
            return json.dumps({"reply": "Updated", "board": board})
    api = next(route.app for route in client.app.routes if route.path == "/api")
    api.dependency_overrides[get_ai_client] = AI
    response = client.post("/api/chat", json={"revision": 0, "message": "Rename backlog"})
    assert response.status_code == 200 and response.json()["updated"]
    client.cookies.set(SESSION_COOKIE, first_cookie, domain="testserver.local", path="/")
    assert client.get("/api/board").json() == first_board

@pytest.mark.parametrize("claims", [
    {"iss": "accounts.google.com"},
    {"aud": ["test-google-client", "other"], "azp": "test-google-client"},
])
def test_accepted_google_issuer_and_authorized_party(google_app, claims):
    client, data, path, _ = google_app
    params = start(client, data)
    data["claims"] = claims
    assert finish(client, params).headers["location"] == "/"
    with connection(path) as db:
        assert db.execute("SELECT issuer FROM google_identities").fetchone()["issuer"] == GOOGLE_ISSUER
