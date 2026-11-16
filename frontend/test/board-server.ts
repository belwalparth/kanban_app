import { vi } from "vitest";
import { DEFAULT_COLUMNS } from "@/lib/board";
import { BoardApiError, loadBoard, saveBoard, type BoardState } from "@/lib/board-api";

export let stored: BoardState;
export function resetBoardServer() {
  stored = { revision: 0, board: { columns: structuredClone(DEFAULT_COLUMNS) } };
  vi.mocked(loadBoard).mockImplementation(async () => structuredClone(stored));
  vi.mocked(saveBoard).mockImplementation(async (state) => {
    if (state.revision !== stored.revision) throw new BoardApiError(409);
    stored = structuredClone({ ...state, revision: state.revision + 1 });
    return structuredClone(stored);
  });
}
