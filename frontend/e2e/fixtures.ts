import { test as base, expect } from "@playwright/test";
import { DEFAULT_COLUMNS } from "../lib/board";
import type { BoardState } from "../lib/board-api";

// Isolate ordinary browser checks so they never reset or edit the user's real board.
export const test = base.extend<{ boardMock: void; boardStore: { state: BoardState } }>({
  boardStore: async ({}, provide) => {
    await provide({ state: { revision: 0, board: { columns: structuredClone(DEFAULT_COLUMNS) } } });
  },
  boardMock: [async ({ page, boardStore }, use) => {
    await page.route("**/api/board", async (route) => {
      if (route.request().method() === "PUT") {
        const next = route.request().postDataJSON() as BoardState;
        if (next.revision !== boardStore.state.revision) { await route.fulfill({ status: 409, json: { detail: "Conflict" } }); return; }
        boardStore.state = { ...next, revision: next.revision + 1 };
      }
      await route.fulfill({ json: boardStore.state });
    });
    await use();
  }, { auto: true }],
});
export { expect };
