import { BoardApiError, type BoardState } from "./board-api";

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ChatResponse = { reply: string; updated: boolean; state: BoardState };
export type ChatResult = { response: ChatResponse; error?: never } | { error: string; response?: never };

export async function sendChat(revision: number, message: string, history: ChatMessage[]): Promise<ChatResponse> {
  const response = await fetch("/api/chat", {
    method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision, message, history: history.slice(-20) }),
  });
  if (!response.ok) throw new BoardApiError(response.status);
  return response.json();
}
