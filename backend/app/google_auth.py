import asyncio
import logging
import secrets
import sqlite3
import time

import httpx2 as httpx
import psycopg
from authlib.common.errors import AuthlibBaseError
from authlib.integrations.starlette_client import OAuth
from authlib.oidc.core import CodeIDToken
from fastapi import APIRouter, Request
from joserfc.errors import JoseError
from starlette.concurrency import run_in_threadpool
from starlette.responses import RedirectResponse

from app.auth import SESSION_MAX_AGE
from app.config import AuthSettings
from app.database import (GOOGLE_ISSUER, consume_login_attempt, get_database_path,
                          provision_google_user, save_login_attempt)

router = APIRouter(prefix="/auth/google", tags=["auth"])
BINDING_COOKIE = "kanban_oauth_browser"
BINDING_PATH = "/api/auth/google"


def create_google_client(settings: AuthSettings):
    oauth = OAuth()
    return oauth.register(
        name="google", client_id=settings.client_id, client_secret=settings.client_secret,
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile", "code_challenge_method": "S256", "timeout": 8.0},
    )


def login_result(request: Request, error: str | None = None):
    response = RedirectResponse("/" if error is None else f"/?auth_error={error}", status_code=303)
    response.delete_cookie(BINDING_COOKIE, path=BINDING_PATH,
                           secure=request.app.state.auth_settings.secure, httponly=True, samesite="lax")
    return response


@router.get("/start")
async def start(request: Request):
    request.session.clear()
    google = request.app.state.google
    if google is None:
        return login_result(request, "unavailable")
    state, binding, nonce, verifier = (secrets.token_urlsafe(32) for _ in range(4))
    try:
        async with asyncio.timeout(25):
            authorization = await google.create_authorization_url(
                request.app.state.auth_settings.callback_url, state=state, nonce=nonce, code_verifier=verifier,
            )
        await run_in_threadpool(save_login_attempt, get_database_path(request), state, binding, nonce, verifier)
    except (httpx.HTTPError, AuthlibBaseError, TimeoutError, ValueError, sqlite3.Error, psycopg.Error):
        return login_result(request, "unavailable")
    response = RedirectResponse(authorization["url"], status_code=302)
    response.set_cookie(BINDING_COOKIE, binding, max_age=600, path=BINDING_PATH,
                        secure=request.app.state.auth_settings.secure, httponly=True, samesite="lax")
    return response


@router.get("/callback")
async def callback(request: Request):
    request.session.clear()
    google = request.app.state.google
    if google is None:
        return login_result(request, "unavailable")
    state = request.query_params.get("state", "")
    binding = request.cookies.get(BINDING_COOKIE, "")
    if not state or not binding:
        return login_result(request, "invalid")
    try:
        attempt = await run_in_threadpool(consume_login_attempt, get_database_path(request), state, binding)
    except (sqlite3.Error, psycopg.Error):
        return login_result(request, "unavailable")
    if attempt is None:
        return login_result(request, "invalid")
    if request.query_params.get("error"):
        return login_result(request, "cancelled" if request.query_params["error"] == "access_denied" else "failed")
    code = request.query_params.get("code")
    if not code:
        return login_result(request, "invalid")
    try:
        async with asyncio.timeout(25):
            token = await google.fetch_access_token(
                redirect_uri=request.app.state.auth_settings.callback_url,
                code=code, code_verifier=attempt["code_verifier"],
            )
            claims = await google.parse_id_token(
                token, nonce=attempt["nonce"], claims_cls=CodeIDToken, leeway=0,
                claims_options={
                    "iss": {"essential": True, "values": [GOOGLE_ISSUER, "accounts.google.com"]},
                    "aud": {"essential": True, "value": request.app.state.auth_settings.client_id},
                    "sub": {"essential": True},
                },
            )
            if not claims:
                raise ValueError("Missing ID token")
            # Only profile strings are retained; provider tokens are discarded.
            profile = {key: claims.get(claim) if isinstance(claims.get(claim), str) else None
                       for key, claim in (("email", "email"), ("display_name", "name"))}
            profile["email_verified"] = claims.get("email_verified") is True
    except (httpx.HTTPError, AuthlibBaseError, JoseError, TimeoutError, ValueError, KeyError, TypeError):
        return login_result(request, "failed")
    try:
        user = await run_in_threadpool(provision_google_user, get_database_path(request),
                                      issuer=claims["iss"], subject=claims["sub"], **profile)
    except ValueError:
        return login_result(request, "failed")
    except (sqlite3.Error, psycopg.Error, RuntimeError):
        return login_result(request, "unavailable")
    request.session.update(user_id=user.id, expires_at=int(time.time()) + SESSION_MAX_AGE)
    return login_result(request)


class OAuthAccessLogFilter(logging.Filter):
    """Uvicorn's request line otherwise includes authorization codes and state."""

    def filter(self, record):
        if isinstance(record.args, tuple) and len(record.args) == 5:
            client, method, path, protocol, status = record.args
            if str(path).startswith("/api/auth/google/"):
                record.args = (client, method, str(path).split("?", 1)[0], protocol, status)
        return True


logging.getLogger("uvicorn.access").addFilter(OAuthAccessLogFilter())
# Authlib's DEBUG output includes PKCE verifiers. Do not enable protocol tracing.
logging.getLogger("authlib").setLevel(logging.WARNING)
