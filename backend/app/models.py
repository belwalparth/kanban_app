from typing import Annotated, Literal, Self, get_args

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

ColumnId = Literal["backlog", "todo", "in-progress", "review", "done"]
COLUMN_IDS = get_args(ColumnId)
MAX_BOARD_BYTES = 1_000_000
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
Identifier = Annotated[str, StringConstraints(min_length=1, pattern=r"\S")]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class User(StrictModel):
    id: int
    username: str


class Card(StrictModel):
    id: Identifier
    title: Title
    details: str


class Column(StrictModel):
    id: ColumnId
    title: Title
    cards: list[Card]


class Board(StrictModel):
    columns: Annotated[list[Column], Field(min_length=5, max_length=5)]

    @model_validator(mode="after")
    def validate_structure(self) -> Self:
        if tuple(column.id for column in self.columns) != COLUMN_IDS:
            raise ValueError("The five fixed columns must retain their IDs and order")
        card_ids = [card.id for column in self.columns for card in column.cards]
        if len(card_ids) != len(set(card_ids)):
            raise ValueError("Card IDs must be unique across the board")
        if len(self.model_dump_json().encode("utf-8")) > MAX_BOARD_BYTES:
            raise ValueError("Board exceeds the 1 MB size limit; shorten card text or remove cards")
        return self


class BoardState(StrictModel):
    revision: Annotated[int, Field(ge=0)]
    board: Board


class BoardName(StrictModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class BoardRename(BoardName):
    revision: Annotated[int, Field(ge=0)]


class BoardSummary(BoardName):
    id: int
    revision: int
    role: Literal["owner", "member"] = "owner"
