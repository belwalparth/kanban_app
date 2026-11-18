from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.auth import require_user
from app.database import Database, begin_write, board_value, connection, decode_board, get_database_path
from app.models import BoardState, User

router = APIRouter(tags=["board"])
CurrentUser = Annotated[User, Depends(require_user)]
DatabasePath = Annotated[Database, Depends(get_database_path)]


@router.get("/board", response_model=BoardState)
def read_board(user: CurrentUser, path: DatabasePath) -> BoardState:
    with connection(path) as db:
        row = db.execute("SELECT board_json, revision FROM boards WHERE user_id = ?", (user.id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Board not found")
    return BoardState(revision=row["revision"], board=decode_board(row["board_json"]))


@router.put("/board", response_model=BoardState)
def update_board(state: BoardState, user: CurrentUser, path: DatabasePath) -> BoardState:
    with connection(path) as db:
        begin_write(db, path)
        # Out-of-range revisions cannot match a database integer.
        revision = state.revision if state.revision <= 2**63 - 1 else -1
        saved = db.execute(
            "UPDATE boards SET board_json = ?, revision = revision + 1 WHERE user_id = ? AND revision = ? RETURNING revision",
            (board_value(state.board, path), user.id, revision),
        ).fetchone()
        if saved is None:
            row = db.execute("SELECT revision FROM boards WHERE user_id = ?", (user.id,)).fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="Board not found")
            raise HTTPException(status_code=409, detail="Board changed; reload before saving")
        db.commit()
    return BoardState(revision=state.revision + 1, board=state.board)
