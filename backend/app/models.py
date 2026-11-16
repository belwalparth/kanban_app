from typing import Annotated, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

COLUMN_IDS = ("backlog", "todo", "in-progress", "review", "done")
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
    id: Identifier
    title: Title
    cards: list[Card]


class Board(StrictModel):
    columns: list[Column]

    @model_validator(mode="after")
    def validate_structure(self) -> Self:
        if tuple(column.id for column in self.columns) != COLUMN_IDS:
            raise ValueError("The five fixed columns must retain their IDs and order")
        card_ids = [card.id for column in self.columns for card in column.cards]
        if len(card_ids) != len(set(card_ids)):
            raise ValueError("Card IDs must be unique across the board")
        return self


class BoardState(StrictModel):
    revision: Annotated[int, Field(ge=0)]
    board: Board
