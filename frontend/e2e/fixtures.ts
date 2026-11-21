import { test as base, expect } from "@playwright/test";
import { DEFAULT_COLUMNS } from "../lib/board";
import type { BoardState } from "../lib/board-api";

// Isolate ordinary browser checks so they never reset or edit the user's real board.
export const test = base.extend<{ boardMock: void; boardStore: { state: BoardState; name: string; additional: Map<number, { name: string; state: BoardState }> } }>({
  boardStore: async ({}, provide) => {
    await provide({ state: { revision: 0, board: { columns: structuredClone(DEFAULT_COLUMNS) } }, name: "Project board", additional: new Map() });
  },
  boardMock: [async ({ page, boardStore }, use) => {
    await page.route("**/api/boards", async route => {
      if (route.request().method() === "POST") {
        const { name } = route.request().postDataJSON();
        const id = Math.max(1, ...boardStore.additional.keys()) + 1;
        boardStore.additional.set(id, { name, state: { revision: 0, board: { columns: structuredClone(DEFAULT_COLUMNS).map(column => ({ ...column, cards: [] })) } } });
        await route.fulfill({ status: 201, json: { id, name, revision: 0 } });
      } else await route.fulfill({ json: [{ id: 1, name: boardStore.name, revision: boardStore.state.revision }, ...[...boardStore.additional].map(([id, board]) => ({ id, name: board.name, revision: board.state.revision }))] });
    });
    await page.route("**/api/boards/*", async (route) => {
      const id = Number(new URL(route.request().url()).pathname.split("/").pop());
      const board = id === 1 ? { name: boardStore.name, state: boardStore.state } : boardStore.additional.get(id);
      if (!board) { await route.fulfill({ status: 404, json: { detail: "Board not found" } }); return; }
      if (route.request().method() === "PATCH") {
        const { name, revision } = route.request().postDataJSON();
        if (revision !== board.state.revision) { await route.fulfill({ status: 409, json: { detail: "Conflict" } }); return; }
        board.name = name;
        board.state = { ...board.state, revision: revision + 1 };
        if (id === 1) { boardStore.name = name; boardStore.state = board.state; }
        await route.fulfill({ json: { id, name, revision: board.state.revision } });
        return;
      }
      if (route.request().method() === "PUT") {
        const next = route.request().postDataJSON() as BoardState;
        if (next.revision !== board.state.revision) { await route.fulfill({ status: 409, json: { detail: "Conflict" } }); return; }
        board.state = { ...next, revision: next.revision + 1 };
        if (id === 1) boardStore.state = board.state;
      }
      await route.fulfill({ json: board.state });
    });
    await use();
  }, { auto: true }],
});
export { expect };
