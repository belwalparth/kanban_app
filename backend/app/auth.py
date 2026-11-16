from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

router = APIRouter(prefix="/auth", tags=["auth"])
SESSION_COOKIE = "kanban_session"
SESSION_MAX_AGE = 8 * 60 * 60


class Credentials(BaseModel):
    username: str
    password: str


def require_user(request: Request) -> str:
    username = request.session.get("username")
    if username != "user":
        raise HTTPException(status_code=401, detail="Not authenticated")
    return username


@router.post("/login")
async def login(credentials: Credentials, request: Request) -> dict[str, str]:
    request.session.clear()
    if credentials.username != "user" or credentials.password != "password":
        raise HTTPException(status_code=401, detail="Invalid username or password")
    request.session["username"] = "user"
    return {"username": "user"}


@router.get("/session")
async def session(username: Annotated[str, Depends(require_user)]) -> dict[str, str]:
    return {"username": username}


@router.post("/logout", status_code=204)
async def logout(request: Request) -> Response:
    request.session.clear()
    return Response(status_code=204)
