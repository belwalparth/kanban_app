import { afterEach, expect, it, vi } from "vitest";
import { sendChat, type ChatMessage } from "./chat-api";
import { BoardApiError } from "./board-api";

afterEach(() => vi.unstubAllGlobals());
it("posts authenticated JSON with a bounded history and reads the canonical response", async () => {
  const response = { reply: "Hello", updated: false, state: { revision: 2, board: { columns: [] } } };
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response)));
  vi.stubGlobal("fetch", fetchMock);
  const history: ChatMessage[] = Array.from({ length: 24 }, (_, i) => ({ role: "user", content: String(i) }));
  expect(await sendChat(2, "Question", history)).toEqual(response);
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe("/api/chat");
  expect(options.credentials).toBe("same-origin");
  expect(JSON.parse(options.body)).toEqual({ revision: 2, message: "Question", history: history.slice(-20) });
});
it("preserves the status for conflict/auth handling without retrying", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 409 }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(sendChat(0, "Move it", [])).rejects.toMatchObject({ status: 409 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(new BoardApiError(409)).toBeInstanceOf(Error);
});
