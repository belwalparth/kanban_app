"""Operator-only schema setup and deliberate demo-board import."""
import argparse
import os
import sqlite3
from pathlib import Path

import psycopg

from app.database import (GOOGLE_ISSUER, begin_write, board_value, connection,
                          decode_board, is_postgres, migrate)


def backup_sqlite(source: Path, backup: Path) -> None:
    if backup.resolve() == source.resolve() or backup.exists():
        raise ValueError("Backup must be a new file distinct from the source")
    # SQLite backup API includes committed WAL data and produces a consistent snapshot.
    with sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True) as original:
        with sqlite3.connect(backup) as destination:
            original.backup(destination)


def import_demo(source: Path, backup: Path, target, subject: str, *, replace: bool = False) -> None:
    if not is_postgres(target) and Path(target).resolve() in (source.resolve(), backup.resolve()):
        raise ValueError("Destination must differ from the source and backup")
    backup_sqlite(source, backup)
    with sqlite3.connect(backup) as db:
        row = db.execute("""SELECT board_json, revision FROM boards JOIN users ON users.id = boards.user_id
                            WHERE username = 'user'""").fetchone()
    if row is None:
        raise ValueError("Source demo board does not exist")
    board = decode_board(row[0])
    revision = row[1]
    if type(revision) is not int or not 0 <= revision <= 2**63 - 1:
        raise ValueError("Source revision is invalid")
    with connection(target) as db:
        begin_write(db, target)
        identity = db.execute("SELECT user_id FROM google_identities WHERE issuer = ? AND subject = ?",
                              (GOOGLE_ISSUER, subject)).fetchone()
        if identity is None:
            raise ValueError("Destination must be an already verified Google identity")
        user_id = identity["user_id"]
        existing = db.execute("SELECT revision FROM boards WHERE user_id = ?", (user_id,)).fetchone()
        if existing and not replace:
            raise ValueError("Destination already has a board; use --replace with the app stopped")
        db.execute("""INSERT INTO boards (user_id, board_json, revision) VALUES (?, ?, ?)
                      ON CONFLICT(user_id) DO UPDATE SET board_json = excluded.board_json, revision = excluded.revision""",
                   (user_id, board_value(board, target), revision))
        db.commit()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    setup = commands.add_parser("migrate")
    setup.add_argument("--sqlite", type=Path, help="Local path; otherwise use DATABASE_MIGRATION_URL")
    setup.add_argument("--backup", type=Path, help="Required before migrating an existing SQLite database")
    transfer = commands.add_parser("import-demo")
    transfer.add_argument("--source", required=True, type=Path)
    transfer.add_argument("--backup", required=True, type=Path)
    transfer.add_argument("--subject", required=True, help="Exact verified Google sub; never email")
    transfer.add_argument("--sqlite", type=Path, help="Optional local rehearsal destination")
    transfer.add_argument("--replace", action="store_true")
    args = parser.parse_args()
    target = args.sqlite or os.environ.get("DATABASE_MIGRATION_URL")
    if not target:
        parser.error("Set DATABASE_MIGRATION_URL or supply --sqlite")
    if not args.sqlite and not is_postgres(target):
        parser.error("DATABASE_MIGRATION_URL must be a PostgreSQL URL")
    try:
        if args.command == "migrate":
            if args.sqlite and args.sqlite.exists():
                if not args.backup:
                    raise ValueError("Existing SQLite requires --backup before migration")
                backup_sqlite(args.sqlite, args.backup)
            migrate(target)
        else:
            import_demo(args.source, args.backup, target, args.subject, replace=args.replace)
    except (sqlite3.Error, psycopg.Error):
        parser.exit(1, "Database operation failed; verify connectivity, permissions, and schema (credentials omitted).\n")
    except (ValueError, RuntimeError) as error:
        parser.exit(1, f"{error}\n")
    print("Database operation completed")


if __name__ == "__main__":
    main()
