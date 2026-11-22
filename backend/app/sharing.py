"""Owner-managed, email-bound invitations. Raw tokens exist only at creation."""
import secrets
import time
from typing import Annotated

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import StringConstraints, field_validator

from app.boards import BoardId, CurrentUser, DatabasePath, check_board_access
from app.database import begin_write, connection, hash_login_value, is_postgres
from app.models import BoardSummary, StrictModel

router = APIRouter(tags=["sharing"])
INVITATION_LIFETIME = 7 * 24 * 60 * 60


class InvitationEmail(StrictModel):
    email: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=254)]

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value):
        local, separator, domain = value.rpartition("@")
        if not separator or not local or not domain or "@" in local or any(c.isspace() for c in value):
            raise ValueError("Enter an email address")
        return value.lower()


class InvitationToken(StrictModel):
    token: Annotated[str, StringConstraints(min_length=43, max_length=43, pattern=r"^[A-Za-z0-9_-]+$")]


def invitation_metadata(row):
    status = ("revoked" if row["revoked_at"] is not None else "accepted" if row["accepted_at"] is not None
              else "expired" if row["expires_at"] <= int(time.time()) else "pending")
    return {"id": row["id"], "email": row["email"], "expires_at": row["expires_at"], "status": status}


@router.post("/boards/{board_id}/invitations", status_code=201)
def create_invitation(board_id: BoardId, data: InvitationEmail, user: CurrentUser, path: DatabasePath, request: Request):
    now = int(time.time())
    token = secrets.token_urlsafe(32)
    with connection(path) as db:
        begin_write(db, path)
        check_board_access(db, path, board_id, user.id, owner=True)
        existing = db.execute("""SELECT 1 FROM google_identities g JOIN boards b ON b.id = ?
            WHERE lower(trim(g.email)) = ? AND g.email_verified = 1 AND (g.user_id = b.user_id OR EXISTS
            (SELECT 1 FROM board_memberships m WHERE m.board_id = b.id AND m.user_id = g.user_id))""",
                              (board_id, data.email)).fetchone()
        pending = db.execute("""SELECT 1 FROM board_invitations WHERE board_id = ? AND email = ?
            AND revoked_at IS NULL AND accepted_at IS NULL AND expires_at > ?""", (board_id, data.email, now)).fetchone()
        if existing or pending:
            raise HTTPException(status_code=409, detail="This email already has access or a pending invitation")
        row = db.execute("""INSERT INTO board_invitations (board_id, email, token_hash, expires_at)
            VALUES (?, ?, ?, ?) RETURNING *""", (board_id, data.email, hash_login_value(token), now + INVITATION_LIFETIME)).fetchone()
        db.commit()
    return {**invitation_metadata(row), "link": f"{request.app.state.auth_settings.base_url}/#invite={token}"}


@router.get("/boards/{board_id}/invitations")
def list_invitations(board_id: BoardId, user: CurrentUser, path: DatabasePath):
    with connection(path) as db:
        begin_write(db, path)
        check_board_access(db, path, board_id, user.id, owner=True)
        return [invitation_metadata(row) for row in db.execute(
            "SELECT * FROM board_invitations WHERE board_id = ? ORDER BY id", (board_id,))]


@router.delete("/boards/{board_id}/invitations/{invitation_id}", status_code=204)
def revoke_invitation(board_id: BoardId, invitation_id: BoardId, user: CurrentUser, path: DatabasePath):
    with connection(path) as db:
        begin_write(db, path)
        check_board_access(db, path, board_id, user.id, owner=True)
        db.execute("UPDATE board_invitations SET revoked_at = ? WHERE id = ? AND board_id = ? AND revoked_at IS NULL",
                   (int(time.time()), invitation_id, board_id))
        db.commit()
    return Response(status_code=204)


@router.get("/boards/{board_id}/members")
def list_members(board_id: BoardId, user: CurrentUser, path: DatabasePath):
    with connection(path) as db:
        begin_write(db, path)
        check_board_access(db, path, board_id, user.id, owner=True)
        return [dict(row) for row in db.execute("""SELECT m.user_id, m.joined_at, g.email, g.display_name
            FROM board_memberships m LEFT JOIN google_identities g ON g.user_id = m.user_id
            WHERE m.board_id = ? ORDER BY m.user_id""", (board_id,))]


@router.delete("/boards/{board_id}/members/{member_id}", status_code=204)
def remove_member(board_id: BoardId, member_id: BoardId, user: CurrentUser, path: DatabasePath):
    with connection(path) as db:
        begin_write(db, path)
        check_board_access(db, path, board_id, user.id, owner=True)
        if member_id == user.id:
            raise HTTPException(status_code=400, detail="The owner cannot be removed")
        db.execute("DELETE FROM board_memberships WHERE board_id = ? AND user_id = ?", (board_id, member_id))
        db.commit()
    return Response(status_code=204)


def validated_invitation(db, path, token, user):
    # Find the board first, then lock it, then reload the token under that lock.
    invite = db.execute("SELECT board_id FROM board_invitations WHERE token_hash = ?", (hash_login_value(token),)).fetchone()
    if invite is None:
        raise HTTPException(status_code=404, detail="Invitation unavailable")
    suffix = " FOR UPDATE" if is_postgres(path) else ""
    board = db.execute("SELECT id, name, revision, user_id FROM boards WHERE id = ?" + suffix,
                       (invite["board_id"],)).fetchone()
    invite = db.execute("SELECT * FROM board_invitations WHERE token_hash = ?", (hash_login_value(token),)).fetchone()
    if board is None or invite is None or invite["revoked_at"] is not None or invite["expires_at"] <= int(time.time()):
        raise HTTPException(status_code=404, detail="Invitation unavailable")
    profile = db.execute("SELECT email, email_verified FROM google_identities WHERE user_id = ?", (user.id,)).fetchone()
    if not profile or not profile["email_verified"] or not profile["email"] or profile["email"].strip().lower() != invite["email"]:
        raise HTTPException(status_code=403, detail="Sign in with the invited verified Google email")
    if invite["accepted_at"] is not None:
        membership = db.execute("SELECT 1 FROM board_memberships WHERE board_id = ? AND user_id = ?",
                                (board["id"], user.id)).fetchone()
        if invite["accepted_by"] != user.id or not membership:
            raise HTTPException(status_code=404, detail="Invitation unavailable")
    return invite, board


@router.post("/invitations/inspect")
def inspect_invitation(data: InvitationToken, user: CurrentUser, path: DatabasePath):
    with connection(path) as db:
        begin_write(db, path)
        invite, board = validated_invitation(db, path, data.token, user)
        return {"board_id": board["id"], "name": board["name"], "status": invitation_metadata(invite)["status"]}


@router.post("/invitations/accept", response_model=BoardSummary)
def accept_invitation(data: InvitationToken, user: CurrentUser, path: DatabasePath):
    with connection(path) as db:
        begin_write(db, path)
        invite, board = validated_invitation(db, path, data.token, user)
        if board["user_id"] == user.id:
            raise HTTPException(status_code=409, detail="You already own this board")
        now = int(time.time())
        db.execute("""INSERT INTO board_memberships (board_id, user_id, joined_at) VALUES (?, ?, ?)
            ON CONFLICT(board_id, user_id) DO NOTHING""", (board["id"], user.id, now))
        db.execute("UPDATE board_invitations SET accepted_by = ?, accepted_at = ? WHERE id = ? AND accepted_at IS NULL",
                   (user.id, now, invite["id"]))
        db.commit()
    return {"id": board["id"], "name": board["name"], "revision": board["revision"], "role": "member"}
