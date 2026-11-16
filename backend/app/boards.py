from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.auth import require_user
from app.database import connection, get_database_path
from app.models import Board, BoardState, User

router = APIRouter(tags=["board"])
CurrentUser = Annotated[User, Depends(require_user)]
DatabasePath = Annotated[Path, Depends(get_database_path)]


@router.get("/board", response_model=BoardState)
def read_board(user: CurrentUser, path: DatabasePath) -> BoardState:
    with connection(path) as db:
        row = db.execute("SELECT board_json, revision FROM boards WHERE user_id = ?", (user.id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Board not found")
    return BoardState(revision=row["revision"], board=Board.model_validate_json(row["board_json"]))


@router.put("/board", response_model=BoardState)
def update_board(state: BoardState, user: CurrentUser, path: DatabasePath) -> BoardState:
    with connection(path) as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT revision FROM boards WHERE user_id = ?", (user.id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Board not found")
        if row["revision"] != state.revision:
            raise HTTPException(status_code=409, detail="Board changed; reload before saving")
        db.execute(
            "UPDATE boards SET board_json = ?, revision = revision + 1 WHERE user_id = ? AND revision = ?",
            (state.board.model_dump_json(), user.id, state.revision),
        )
        db.commit()
    return BoardState(revision=state.revision + 1, board=state.board)
