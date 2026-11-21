import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { KanbanBoard } from "./KanbanBoard";
import { AuthGate } from "./AuthGate";
import { BoardApiError, createBoard, listBoards, loadBoard, renameBoard, saveBoard, type BoardState } from "@/lib/board-api";
import { sendChat, type ChatResponse } from "@/lib/chat-api";
import { getAuthConfig, getSession, signIn, signOut } from "@/lib/auth";
import { boardNames, extraBoards, getStoredBoard, resetBoardServer, stored } from "@/test/board-server";

vi.mock("@/lib/board-api", async original => ({ ...await original<typeof import("@/lib/board-api")>(), listBoards: vi.fn(), createBoard: vi.fn(), renameBoard: vi.fn(), loadBoard: vi.fn(), saveBoard: vi.fn() }));
vi.mock("@/lib/chat-api", () => ({ sendChat: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthConfig: vi.fn(), getSession: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  resetBoardServer();
  vi.mocked(getAuthConfig).mockResolvedValue({ google: false, demo: true });
  vi.mocked(getSession).mockResolvedValue({ id: 1, username: "first" });
  vi.mocked(signIn).mockResolvedValue({ id: 1, username: "first" });
  vi.mocked(signOut).mockResolvedValue(undefined);
  vi.mocked(sendChat).mockImplementation(async (_revision, message, _history, id) => ({ reply: `Answer to ${message}`, updated: false, state: structuredClone(getStoredBoard(id)) }));
});
async function show() {
  render(<KanbanBoard />);
  await screen.findByRole("heading", { name: "Project board." });
}
async function secondBoard() { return (await createBoard("Second board")).id; }
function popTo(id: string) {
  act(() => { window.history.pushState(null, "", `/?board=${id}`); window.dispatchEvent(new PopStateEvent("popstate")); });
}
async function openChat() { await userEvent.click(screen.getByRole("button", { name: "Board assistant" })); }

it("creates an empty named board, switches to it, renames it, and restores the original", async () => {
  const user = userEvent.setup();
  await show();
  expect(window.location.search).toBe("?board=1");
  await user.click(screen.getByRole("button", { name: "New board" }));
  expect(screen.getByLabelText("Board name")).toHaveFocus();
  await user.type(screen.getByLabelText("Board name"), "  Second board  ");
  await user.click(screen.getByRole("button", { name: "Create board" }));
  await screen.findByRole("heading", { name: "Second board." });
  expect(screen.queryAllByRole("article")).toHaveLength(0);
  expect(window.location.search).toBe("?board=2");
  await user.click(screen.getByRole("button", { name: "Rename board" }));
  await user.clear(screen.getByLabelText("Board name"));
  await user.type(screen.getByLabelText("Board name"), "Renamed board");
  await user.click(screen.getByRole("button", { name: "Save board name" }));
  await screen.findByRole("heading", { name: "Renamed board." });
  expect(renameBoard).toHaveBeenCalledWith(2, "Renamed board", 0);
  await user.selectOptions(screen.getByLabelText("Board", { exact: true }), "1");
  await screen.findByRole("heading", { name: "Project board." });
  expect(screen.getAllByRole("article")).toHaveLength(6);
});

it("restores the selected board from the URL and responds to history navigation", async () => {
  await secondBoard();
  window.history.replaceState(null, "", "/?board=2&keep=yes");
  render(<KanbanBoard />);
  await screen.findByRole("heading", { name: "Second board." });
  expect(loadBoard).toHaveBeenCalledWith(2);
  expect(loadBoard).not.toHaveBeenCalledWith(1);
  popTo("1");
  await screen.findByRole("heading", { name: "Project board." });
  popTo("2");
  await screen.findByRole("heading", { name: "Second board." });
});

it("shows an unavailable URL without loading another board and lets the user recover", async () => {
  window.history.replaceState(null, "", "/?board=999");
  render(<KanbanBoard />);
  expect(await screen.findByRole("alert")).toHaveTextContent("unavailable");
  expect(loadBoard).not.toHaveBeenCalled();
  await userEvent.selectOptions(screen.getByLabelText("Board", { exact: true }), "1");
  await screen.findByRole("heading", { name: "Project board." });
});

it("keeps a failed create/rename draft and the selected board until explicit retry", async () => {
  const user = userEvent.setup();
  vi.mocked(createBoard).mockRejectedValueOnce(new Error("offline"));
  await show();
  await user.click(screen.getByRole("button", { name: "New board" }));
  await user.type(screen.getByLabelText("Board name"), "Retry board");
  await user.click(screen.getByRole("button", { name: "Create board" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't create");
  expect(screen.getByLabelText("Board name")).toHaveValue("Retry board");
  expect(screen.getByRole("heading", { name: "Project board." })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Create board" }));
  await screen.findByRole("heading", { name: "Retry board." });
  vi.mocked(renameBoard).mockRejectedValueOnce(new Error("offline"));
  await user.click(screen.getByRole("button", { name: "Rename board" }));
  await user.clear(screen.getByLabelText("Board name"));
  await user.type(screen.getByLabelText("Board name"), "Retry rename");
  await user.click(screen.getByRole("button", { name: "Save board name" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't rename");
  expect(boardNames.get(2)).toBe("Retry board");
  await user.click(screen.getByRole("button", { name: "Save board name" }));
  await screen.findByRole("heading", { name: "Retry rename." });
});

it("recovers a rename conflict with current metadata and does not replay the rename", async () => {
  await show();
  stored.revision = 4;
  boardNames.set(1, "Changed elsewhere");
  await userEvent.click(screen.getByRole("button", { name: "Rename board" }));
  fireEvent.change(screen.getByLabelText("Board name"), { target: { value: "My rename" } });
  fireEvent.submit(screen.getByRole("form", { name: "Rename board" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("changed elsewhere");
  await screen.findByRole("heading", { name: "Changed elsewhere." });
  expect(renameBoard).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "Save board name" }));
  await screen.findByRole("heading", { name: "My rename." });
  expect(renameBoard).toHaveBeenLastCalledWith(1, "My rename", 4);
});

it("retries a failed board list and reports an expired session", async () => {
  const expired = vi.fn();
  vi.mocked(listBoards).mockRejectedValueOnce(new Error("offline"));
  render(<KanbanBoard onSessionExpired={expired} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load your boards");
  vi.mocked(listBoards).mockRejectedValueOnce(new BoardApiError(401));
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(expired).toHaveBeenCalledOnce());
});

it("ignores an earlier board load after a fast switch", async () => {
  await secondBoard();
  let finish!: (state: BoardState) => void;
  vi.mocked(loadBoard).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<KanbanBoard />);
  await waitFor(() => expect(loadBoard).toHaveBeenCalledWith(1));
  await userEvent.selectOptions(screen.getByLabelText("Board", { exact: true }), "2");
  await screen.findByRole("heading", { name: "Second board." });
  await act(async () => finish(structuredClone(stored)));
  expect(screen.getByRole("heading", { name: "Second board." })).toBeInTheDocument();
  expect(screen.queryAllByRole("article")).toHaveLength(0);
});

it("waits for a manual save before following a history switch", async () => {
  await secondBoard();
  let finish!: (state: BoardState) => void;
  vi.mocked(saveBoard).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await show();
  fireEvent.click(screen.getByRole("button", { name: "Delete Draft onboarding" }));
  popTo("2");
  expect(screen.getByLabelText("Board", { exact: true })).toBeDisabled();
  expect(screen.getByRole("heading", { name: "Project board." })).toBeInTheDocument();
  expect(screen.getByText(/Your board will switch afterward/)).toBeInTheDocument();
  await act(async () => finish({ ...stored, revision: 1 }));
  await screen.findByRole("heading", { name: "Second board." });
  expect(screen.queryAllByRole("article")).toHaveLength(0);
  expect(vi.mocked(saveBoard).mock.calls[0][1]).toBe(1);
});

it("honors queued history after board creation without replacing the requested URL", async () => {
  await secondBoard();
  window.history.replaceState(null, "", "/?board=2");
  let finish!: (board: { id: number; name: string; revision: number }) => void;
  vi.mocked(createBoard).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<KanbanBoard />);
  await screen.findByRole("heading", { name: "Second board." });
  await userEvent.click(screen.getByRole("button", { name: "New board" }));
  fireEvent.change(screen.getByLabelText("Board name"), { target: { value: "Third board" } });
  fireEvent.submit(screen.getByRole("form", { name: "Create board" }));
  popTo("1");
  await act(async () => finish({ id: 3, name: "Third board", revision: 0 }));
  await screen.findByRole("heading", { name: "Project board." });
  expect(window.location.search).toBe("?board=1");
  expect(screen.getByRole("option", { name: "Third board" })).toBeInTheDocument();
});

it("does not expire the active session when an obsolete board load later returns 401", async () => {
  await secondBoard();
  const expired = vi.fn();
  let reject!: (error: Error) => void;
  vi.mocked(loadBoard).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  render(<KanbanBoard onSessionExpired={expired} />);
  await waitFor(() => expect(loadBoard).toHaveBeenCalledWith(1));
  await userEvent.selectOptions(screen.getByLabelText("Board", { exact: true }), "2");
  await screen.findByRole("heading", { name: "Second board." });
  await act(async () => reject(new BoardApiError(401)));
  expect(expired).not.toHaveBeenCalled();
  expect(screen.getByRole("heading", { name: "Second board." })).toBeInTheDocument();
});

it("retains an open card draft until cancellation before a queued history switch", async () => {
  await secondBoard();
  await show();
  await userEvent.click(screen.getByRole("button", { name: "Edit Draft onboarding" }));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Unsaved first-board draft" } });
  popTo("2");
  expect(screen.getByLabelText("Title")).toHaveValue("Unsaved first-board draft");
  expect(screen.getByLabelText("Board", { exact: true })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await screen.findByRole("heading", { name: "Second board." });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("keeps per-board AI drafts/history and sends only the selected board ID and history", async () => {
  const user = userEvent.setup();
  await secondBoard();
  await show();
  await openChat();
  await user.type(screen.getByLabelText("Message the assistant"), "First question");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText("Answer to First question");
  await user.type(screen.getByLabelText("Message the assistant"), "First draft");
  await user.click(screen.getByRole("button", { name: "Close assistant" }));
  await user.selectOptions(screen.getByLabelText("Board", { exact: true }), "2");
  await screen.findByRole("heading", { name: "Second board." });
  await openChat();
  expect(screen.getByLabelText("Message the assistant")).toHaveValue("");
  expect(screen.getByRole("log")).not.toHaveTextContent("First question");
  await user.type(screen.getByLabelText("Message the assistant"), "Second question");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText("Answer to Second question");
  expect(sendChat).toHaveBeenLastCalledWith(0, "Second question", [], 2);
  await user.click(screen.getByRole("button", { name: "Close assistant" }));
  await user.selectOptions(screen.getByLabelText("Board", { exact: true }), "1");
  await screen.findByRole("heading", { name: "Project board." });
  await openChat();
  expect(screen.getByLabelText("Message the assistant")).toHaveValue("First draft");
  expect(screen.getByRole("log")).toHaveTextContent("First question");
  expect(screen.getByRole("log")).not.toHaveTextContent("Second question");
});

it("finishes an AI response on its original board before a queued switch", async () => {
  await secondBoard();
  let finish!: (response: ChatResponse) => void;
  vi.mocked(sendChat).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await show();
  await openChat();
  fireEvent.change(screen.getByLabelText("Message the assistant"), { target: { value: "Pending first-board request" } });
  fireEvent.submit(screen.getByRole("button", { name: "Send message" }).closest("form")!);
  await userEvent.click(screen.getByRole("button", { name: "Close assistant" }));
  popTo("2");
  expect(screen.getByRole("heading", { name: "Project board." })).toBeInTheDocument();
  const next = structuredClone(stored);
  next.revision = 1;
  next.board.columns[0].cards.push({ id: "first-ai", title: "First-board AI only", details: "" });
  Object.assign(stored, next);
  await act(async () => finish({ reply: "First board saved", updated: true, state: next }));
  await screen.findByRole("heading", { name: "Second board." });
  expect(screen.queryByRole("article", { name: "First-board AI only" })).not.toBeInTheDocument();
  expect(extraBoards.get(2)?.revision).toBe(0);
  await userEvent.selectOptions(screen.getByLabelText("Board", { exact: true }), "1");
  await screen.findByRole("article", { name: "First-board AI only" });
  await openChat();
  expect(within(screen.getByRole("log")).getByText("First board saved")).toBeInTheDocument();
});

it("clears every board's chat memory when the signed-in account changes", async () => {
  const user = userEvent.setup();
  await secondBoard();
  render(<AuthGate />);
  await screen.findByRole("heading", { name: "Project board." });
  await openChat();
  await user.type(screen.getByLabelText("Message the assistant"), "Private first account draft");
  await user.click(screen.getByRole("button", { name: "Close assistant" }));
  await user.selectOptions(screen.getByLabelText("Board", { exact: true }), "2");
  await screen.findByRole("heading", { name: "Second board." });
  await openChat();
  await user.type(screen.getByLabelText("Message the assistant"), "Another private board draft");
  await user.click(screen.getByRole("button", { name: "Close assistant" }));
  vi.mocked(getSession).mockResolvedValue({ id: 2, username: "second" });
  act(() => window.dispatchEvent(new Event("focus")));
  await screen.findByText("second", { exact: true });
  await screen.findByRole("heading", { name: "Second board." });
  await openChat();
  expect(screen.getByLabelText("Message the assistant")).toHaveValue("");
  await user.click(screen.getByRole("button", { name: "Close assistant" }));
  await user.selectOptions(screen.getByLabelText("Board", { exact: true }), "1");
  await screen.findByRole("heading", { name: "Project board." });
  await openChat();
  expect(screen.getByLabelText("Message the assistant")).toHaveValue("");
});
