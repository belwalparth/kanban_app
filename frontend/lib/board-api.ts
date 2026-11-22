import type { Column } from "./board";

export type BoardState = { revision: number; board: { columns: Column[] } };
export type BoardSummary = { id: number; name: string; revision: number; role?: "owner" | "member" };
export class BoardApiError extends Error {
  constructor(public status: number) { super("Board request failed"); }
}
export async function listBoards(): Promise<BoardSummary[]> {
  const response = await fetch("/api/boards", { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new BoardApiError(response.status);
  return response.json();
}
export async function createBoard(name: string): Promise<BoardSummary> {
  return changeBoardMetadata("/api/boards", "POST", { name });
}
export async function renameBoard(id: number, name: string, revision: number): Promise<BoardSummary> {
  return changeBoardMetadata(`/api/boards/${id}`, "PATCH", { name, revision });
}
async function changeBoardMetadata(url: string, method: string, data: object): Promise<BoardSummary> {
  const response = await fetch(url, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  if (!response.ok) throw new BoardApiError(response.status);
  return response.json();
}
export async function loadBoard(boardId?: number): Promise<BoardState> {
  const response = await fetch(boardId === undefined ? "/api/board" : `/api/boards/${boardId}`, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new BoardApiError(response.status);
  return response.json();
}
export async function saveBoard(state: BoardState, boardId?: number): Promise<BoardState> {
  const response = await fetch(boardId === undefined ? "/api/board" : `/api/boards/${boardId}`, {
    method: "PUT", credentials: "same-origin",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(state),
  });
  if (!response.ok) throw new BoardApiError(response.status);
  return response.json();
}
