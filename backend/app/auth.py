from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from app.database import find_user, get_database_path
from app.models import User

router = APIRouter(prefix="/auth", tags=["auth"])
SESSION_COOKIE = "kanban_session"
SESSION_MAX_AGE = 8 * 60 * 60


class Credentials(BaseModel):
    username: str
    password: str


def require_user(request: Request) -> User:
    username = request.session.get("username")
    if not isinstance(username, str):
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = find_user(get_database_path(request), username)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


@router.post("/login")
def login(credentials: Credentials, request: Request) -> dict[str, str]:
    request.session.clear()
    if credentials.username != "user" or credentials.password != "password":
        raise HTTPException(status_code=401, detail="Invalid username or password")
    if find_user(get_database_path(request), credentials.username) is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    request.session["username"] = "user"
    return {"username": "user"}


@router.get("/session")
def session(user: Annotated[User, Depends(require_user)]) -> dict[str, str]:
    return {"username": user.username}


@router.post("/logout", status_code=204)
async def logout(request: Request) -> Response:
    request.session.clear()
    return Response(status_code=204)
