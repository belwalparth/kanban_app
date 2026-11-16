import type { Column } from "./board";

export type BoardState = { revision: number; board: { columns: Column[] } };
export class BoardApiError extends Error {
  constructor(public status: number) { super("Board request failed"); }
}
export async function loadBoard(): Promise<BoardState> {
  const response = await fetch("/api/board", { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new BoardApiError(response.status);
  return response.json();
}
export async function saveBoard(state: BoardState): Promise<BoardState> {
  const response = await fetch("/api/board", {
    method: "PUT", credentials: "same-origin",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(state),
  });
  if (!response.ok) throw new BoardApiError(response.status);
  return response.json();
}
