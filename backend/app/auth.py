from typing import Annotated
import time

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from app.database import find_user, find_user_by_id, get_database_path, user_display_name
from app.models import User

router = APIRouter(prefix="/auth", tags=["auth"])
SESSION_COOKIE = "kanban_session"
SESSION_MAX_AGE = 8 * 60 * 60


class Credentials(BaseModel):
    username: str
    password: str


def require_user(request: Request) -> User:
    user_id = request.session.get("user_id")
    expires_at = request.session.get("expires_at")
    if type(user_id) is not int or type(expires_at) is not int or expires_at <= time.time():
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = find_user_by_id(get_database_path(request), user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


@router.post("/login")
def login(credentials: Credentials, request: Request) -> dict[str, str | int]:
    request.session.clear()
    if not request.app.state.allow_demo_login:
        raise HTTPException(status_code=403, detail="Demo login is disabled")
    if credentials.username != "user" or credentials.password != "password":
        raise HTTPException(status_code=401, detail="Invalid username or password")
    user = find_user(get_database_path(request), credentials.username)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    request.session.update(user_id=user.id, expires_at=int(time.time()) + SESSION_MAX_AGE)
    return {"username": "user", "id": user.id}


@router.get("/session")
def session(request: Request, user: Annotated[User, Depends(require_user)]) -> dict[str, str | int]:
    return {"username": user_display_name(get_database_path(request), user), "id": user.id}


@router.get("/config")
def configuration(request: Request) -> dict[str, bool]:
    return {"google": request.app.state.auth_settings.google_enabled, "demo": request.app.state.allow_demo_login}


@router.post("/logout", status_code=204)
async def logout(request: Request) -> Response:
    request.session.clear()
    return Response(status_code=204)
