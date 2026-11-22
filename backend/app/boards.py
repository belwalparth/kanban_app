from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path

from app.auth import require_user
from app.database import Database, SEED_PATH, begin_write, board_value, connection, decode_board, get_database_path, is_postgres
from app.models import Board, BoardName, BoardRename, BoardState, BoardSummary, User

router = APIRouter(tags=["board"])
CurrentUser = Annotated[User, Depends(require_user)]
DatabasePath = Annotated[Database, Depends(get_database_path)]
BoardId = Annotated[int, Path(gt=0, le=2**63 - 1)]

ACCESS_SQL = """(user_id = ? OR EXISTS (SELECT 1 FROM board_memberships m
                WHERE m.board_id = boards.id AND m.user_id = ?))"""


def check_board_access(db, path: Database, board_id: int, user_id: int, *, owner: bool = False):
    # Every writer/removal locks this row before checking membership.
    suffix = " FOR UPDATE" if is_postgres(path) else ""
    row = db.execute("SELECT user_id FROM boards WHERE id = ?" + suffix, (board_id,)).fetchone()
    if row is None or (row["user_id"] != user_id and db.execute(
        "SELECT 1 FROM board_memberships WHERE board_id = ? AND user_id = ?", (board_id, user_id),
    ).fetchone() is None):
        raise HTTPException(status_code=404, detail="Board not found")
    if owner and row["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Only the board owner can manage sharing or rename the board")


def resolve_board_id(user: User, path: Database, board_id: int | None = None) -> int:
    with connection(path) as db:
        if board_id is None:
            row = db.execute("SELECT id FROM boards WHERE user_id = ? ORDER BY id LIMIT 1", (user.id,)).fetchone()
        else:
            row = db.execute("SELECT id FROM boards WHERE id = ? AND " + ACCESS_SQL, (board_id, user.id, user.id)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Board not found")
    return row["id"]


def read_board(user: User, path: Database, board_id: int | None = None) -> BoardState:
    if board_id is None:
        board_id = resolve_board_id(user, path)
    with connection(path) as db:
        row = db.execute("SELECT board_json, revision FROM boards WHERE id = ? AND " + ACCESS_SQL, (board_id, user.id, user.id)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Board not found")
    return BoardState(revision=row["revision"], board=decode_board(row["board_json"]))


def update_board(state: BoardState, user: User, path: Database, board_id: int | None = None) -> BoardState:
    if board_id is None:
        board_id = resolve_board_id(user, path)
    with connection(path) as db:
        begin_write(db, path)
        check_board_access(db, path, board_id, user.id)
        # Out-of-range revisions cannot match a database integer.
        revision = state.revision if state.revision <= 2**63 - 1 else -1
        saved = db.execute(
            "UPDATE boards SET board_json = ?, revision = revision + 1 WHERE id = ? AND revision = ? RETURNING revision",
            (board_value(state.board, path), board_id, revision),
        ).fetchone()
        if saved is None:
            raise HTTPException(status_code=409, detail="Board changed; reload before saving")
        db.commit()
    return BoardState(revision=state.revision + 1, board=state.board)


@router.get("/boards", response_model=list[BoardSummary])
def list_boards(user: CurrentUser, path: DatabasePath):
    with connection(path) as db:
        return [dict(row) for row in db.execute(
            "SELECT id, name, revision, CASE WHEN user_id = ? THEN 'owner' ELSE 'member' END AS role "
            "FROM boards WHERE " + ACCESS_SQL + " ORDER BY id", (user.id, user.id, user.id),
        ).fetchall()]


@router.post("/boards", response_model=BoardSummary, status_code=201)
def create_board(data: BoardName, user: CurrentUser, path: DatabasePath):
    board = Board.model_validate_json(SEED_PATH.read_text(encoding="utf-8"))
    for column in board.columns:
        column.cards = []
    with connection(path) as db:
        begin_write(db, path)
        row = db.execute("""INSERT INTO boards (user_id, name, board_json) VALUES (?, ?, ?)
                            RETURNING id, name, revision""", (user.id, data.name, board_value(board, path))).fetchone()
        db.commit()
    return dict(row)


@router.get("/boards/{board_id}", response_model=BoardState)
def read_selected_board(board_id: BoardId, user: CurrentUser, path: DatabasePath):
    return read_board(user, path, board_id)


@router.put("/boards/{board_id}", response_model=BoardState)
def update_selected_board(board_id: BoardId, state: BoardState, user: CurrentUser, path: DatabasePath):
    return update_board(state, user, path, board_id)


@router.patch("/boards/{board_id}", response_model=BoardSummary)
def rename_board(board_id: BoardId, data: BoardRename, user: CurrentUser, path: DatabasePath):
    revision = data.revision if data.revision <= 2**63 - 1 else -1
    with connection(path) as db:
        begin_write(db, path)
        check_board_access(db, path, board_id, user.id, owner=True)
        row = db.execute("""UPDATE boards SET name = ?, revision = revision + 1
                            WHERE id = ? AND user_id = ? AND revision = ? RETURNING id, name, revision""",
                         (data.name, board_id, user.id, revision)).fetchone()
        if row is None:
            raise HTTPException(status_code=409, detail="Board changed; reload before saving")
        db.commit()
    return dict(row)


@router.get("/board", response_model=BoardState)
def read_initial_board(user: CurrentUser, path: DatabasePath):
    return read_board(user, path)


@router.put("/board", response_model=BoardState)
def update_initial_board(state: BoardState, user: CurrentUser, path: DatabasePath):
    return update_board(state, user, path)
