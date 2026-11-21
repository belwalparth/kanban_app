import { vi } from "vitest";
import { DEFAULT_COLUMNS } from "@/lib/board";
import { BoardApiError, createBoard, listBoards, loadBoard, renameBoard, saveBoard, type BoardState } from "@/lib/board-api";

export let stored: BoardState;
export const boardNames = new Map<number, string>();
export const extraBoards = new Map<number, BoardState>();
export function getStoredBoard(id = 1) {
  const board = id === 1 ? stored : extraBoards.get(id);
  if (!boardNames.has(id) || !board) throw new BoardApiError(404);
  return board;
}
function storeBoard(id: number, state: BoardState) { if (id === 1) stored = state; else extraBoards.set(id, state); }
export function resetBoardServer() {
  window.history.replaceState(null, "", "/");
  boardNames.clear();
  extraBoards.clear();
  boardNames.set(1, "Project board");
  stored = { revision: 0, board: { columns: structuredClone(DEFAULT_COLUMNS) } };
  vi.mocked(listBoards).mockImplementation(async () => [...boardNames].map(([id, name]) => ({ id, name, revision: getStoredBoard(id).revision })));
  vi.mocked(loadBoard).mockImplementation(async (id = 1) => structuredClone(getStoredBoard(id)));
  vi.mocked(saveBoard).mockImplementation(async (state, id = 1) => {
    if (state.revision !== getStoredBoard(id).revision) throw new BoardApiError(409);
    const saved = structuredClone({ ...state, revision: state.revision + 1 });
    storeBoard(id, saved);
    return structuredClone(saved);
  });
  vi.mocked(createBoard).mockImplementation(async name => {
    const id = Math.max(...boardNames.keys()) + 1;
    boardNames.set(id, name);
    extraBoards.set(id, { revision: 0, board: { columns: structuredClone(DEFAULT_COLUMNS).map(column => ({ ...column, cards: [] })) } });
    return { id, name, revision: 0 };
  });
  vi.mocked(renameBoard).mockImplementation(async (id, name, revision) => {
    const state = getStoredBoard(id);
    if (state.revision !== revision) throw new BoardApiError(409);
    boardNames.set(id, name);
    storeBoard(id, { ...state, revision: revision + 1 });
    return { id, name, revision: revision + 1 };
  });
}
