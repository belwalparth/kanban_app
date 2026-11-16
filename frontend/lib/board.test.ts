import { describe, expect, it } from "vitest";
import {
  DEFAULT_COLUMNS,
  addCardToColumn,
  deleteCardFromColumn,
  editCardInColumn,
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

  it("edits title/details without changing the card ID or the original data", () => {
    const original = structuredClone(DEFAULT_COLUMNS);
    const card = DEFAULT_COLUMNS[0].cards[0];
    const updated = editCardInColumn(DEFAULT_COLUMNS, "backlog", card.id, { title: "Updated", details: "New context" });
    expect(updated[0].cards[0]).toEqual({ id: card.id, title: "Updated", details: "New context" });
    expect(updated[0].cards[1]).toBe(DEFAULT_COLUMNS[0].cards[1]);
    expect(updated[1]).toBe(DEFAULT_COLUMNS[1]);
    expect(DEFAULT_COLUMNS).toEqual(original);
  });

  it("ignores edits to missing cards or columns", () => {
    const changes = { title: "Missing", details: "Missing" };
    expect(editCardInColumn(DEFAULT_COLUMNS, "backlog", "missing", changes)).toEqual(DEFAULT_COLUMNS);
    expect(editCardInColumn(DEFAULT_COLUMNS, "missing", "card-1", changes)).toEqual(DEFAULT_COLUMNS);
  });

  it.each([
    ["todo", "todo", "card-3"],
    ["missing", "done", "card-3"],
    ["todo", "missing", "card-3"],
    ["todo", "done", "missing"],
  ])("ignores invalid/no-op moves: %s to %s (%s)", (source, target, card) => {
    expect(moveCardBetweenColumns(DEFAULT_COLUMNS, source, target, card)).toBe(DEFAULT_COLUMNS);
  });

  it("appends a moved card once and preserves the original board", () => {
    const original = structuredClone(DEFAULT_COLUMNS);
    const moved = DEFAULT_COLUMNS[0].cards[0];
    const updated = moveCardBetweenColumns(DEFAULT_COLUMNS, "backlog", "done", moved.id);
    expect(updated[4].cards.at(-1)).toEqual(moved);
    expect(updated.flatMap((column) => column.cards).filter((card) => card.id === moved.id)).toHaveLength(1);
    expect(updated.map((column) => column.id)).toEqual(DEFAULT_COLUMNS.map((column) => column.id));
    expect(DEFAULT_COLUMNS).toEqual(original);
  });

  it("creates unique card IDs and retains existing cards", () => {
    const updated = addCardToColumn(addCardToColumn(DEFAULT_COLUMNS, "todo"), "todo");
    const cards = updated.flatMap((column) => column.cards);
    expect(new Set(cards.map((card) => card.id)).size).toBe(cards.length);
    expect(updated[1].cards[0]).toEqual(DEFAULT_COLUMNS[1].cards[0]);
  });
});
