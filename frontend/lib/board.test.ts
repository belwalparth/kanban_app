import { describe, expect, it } from "vitest";
import {
  DEFAULT_COLUMNS,
  addCardToColumn,
  deleteCardFromColumn,
  moveCardBetweenColumns,
  renameColumnTitle,
} from "./board";

describe("kanban board helpers", () => {
  it("adds a new card to the selected column", () => {
    const updated = addCardToColumn(DEFAULT_COLUMNS, "todo", "Ship prototype", "Ready for QA");
    const todoColumn = updated.find((column) => column.id === "todo");

    expect(todoColumn?.cards.at(-1)?.title).toBe("Ship prototype");
    expect(todoColumn?.cards.at(-1)?.details).toBe("Ready for QA");
  });

  it("deletes a card from the selected column", () => {
    const targetCardId = DEFAULT_COLUMNS[0].cards[0].id;
    const updated = deleteCardFromColumn(DEFAULT_COLUMNS, "backlog", targetCardId);
    const backlogColumn = updated.find((column) => column.id === "backlog");

    expect(backlogColumn?.cards.some((card) => card.id === targetCardId)).toBe(false);
  });

  it("renames a column title", () => {
    const updated = renameColumnTitle(DEFAULT_COLUMNS, "review", "Final review");
    const reviewColumn = updated.find((column) => column.id === "review");

    expect(reviewColumn?.title).toBe("Final review");
  });

  it("moves a card between columns", () => {
    const sourceCardId = DEFAULT_COLUMNS[1].cards[0].id;
    const updated = moveCardBetweenColumns(DEFAULT_COLUMNS, "todo", "done", sourceCardId);

    const todoColumn = updated.find((column) => column.id === "todo");
    const doneColumn = updated.find((column) => column.id === "done");

    expect(todoColumn?.cards.some((card) => card.id === sourceCardId)).toBe(false);
    expect(doneColumn?.cards.some((card) => card.id === sourceCardId)).toBe(true);
  });
});
