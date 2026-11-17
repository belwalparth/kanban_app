"""Explicit live structured chat check against a disposable synthetic board."""

import asyncio
import re
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import HTTPException

from app.boards import read_board
from app.chat import ChatRequest, answer_chat
from app.database import find_user, initialize
from app.models import Card
from app.openrouter import OpenRouterClient, OpenRouterError


async def check() -> None:
    ai = OpenRouterClient()
    with TemporaryDirectory(prefix="kanban-ai-check-") as directory:
        path = Path(directory) / "synthetic.db"
        initialize(path)
        user = find_user(path, "user")
        original = read_board(user, path)
        answer = await answer_chat(ChatRequest(
            revision=original.revision,
            message="How many cards are currently on this board? Include the numeric count in your reply. Do not change anything.",
        ), user, path, ai)
        if answer.updated or answer.state != original or not re.search(r"\b6\b", answer.reply):
            raise OpenRouterError("Live answer-only check failed; no real board was touched.")

        changed = await answer_chat(ChatRequest(
            revision=original.revision,
            message="Create a card with id ai-check-1, title AI live check, and details Synthetic check in todo. "
                    "Also change the title of card-1 to Onboarding updated, keeping its details. "
                    "Move card-3 from todo to done, appending it there. Keep all other cards, IDs, text, and column titles unchanged.",
        ), user, path, ai)
        expected = original.board.model_copy(deep=True)
        expected.columns[0].cards[0].title = "Onboarding updated"
        expected.columns[1].cards.append(Card(id="ai-check-1", title="AI live check", details="Synthetic check"))
        expected.columns[4].cards.append(expected.columns[1].cards.pop(0))
        if not changed.updated or changed.state.revision != 1 or changed.state.board != expected:
            raise OpenRouterError("Live multi-card update check failed; no real board was touched.")
        if read_board(user, path) != changed.state:
            raise OpenRouterError("Live update was not persisted in the temporary database.")
    print(f"Model: {ai.model}")
    print("Answer-only reply validated; revision unchanged.")
    print("Combined card creation, editing, and movement validated and saved atomically.")
    print("Temporary database removed; your saved board was not read or changed.")


if __name__ == "__main__":
    try:
        asyncio.run(check())
    except (OpenRouterError, HTTPException) as error:
        message = error.detail if isinstance(error, HTTPException) else str(error)
        print(f"Chat check failed: {message}", file=sys.stderr)
        raise SystemExit(1) from None
