import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { KanbanBoard } from "./KanbanBoard";
import { AuthGate } from "./AuthGate";
import { BoardApiError, loadBoard, saveBoard } from "@/lib/board-api";
import { sendChat, type ChatResponse } from "@/lib/chat-api";
import { getAuthConfig, getSession, signIn, signOut } from "@/lib/auth";
import { resetBoardServer, stored } from "@/test/board-server";

vi.mock("@/lib/chat-api", () => ({ sendChat: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthConfig: vi.fn(), getSession: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/board-api", async (original) => ({ ...await original<typeof import("@/lib/board-api")>(), loadBoard: vi.fn(), saveBoard: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAuthConfig).mockResolvedValue({ google: false, demo: true });
  resetBoardServer();
  vi.mocked(sendChat).mockImplementation(async () => ({ reply: "Six cards.", updated: false, state: structuredClone(stored) }));
});
async function show() {
  render(<KanbanBoard />);
  fireEvent.click(await screen.findByRole("button", { name: "Board assistant" }));
  await screen.findByRole("heading", { name: "Board assistant" });
}
function submit(message = "Count the cards") {
  fireEvent.change(screen.getByLabelText("Message the assistant"), { target: { value: message } });
  fireEvent.submit(screen.getByRole("button", { name: /Send message|Send again/ }).closest("form")!);
}

it("sends trimmed messages with the current revision/history and renders text safely", async () => {
  vi.mocked(sendChat).mockResolvedValueOnce({ reply: '<img src=x onerror="alert(1)">', updated: false, state: structuredClone(stored) });
  await show();
  submit("  Count the cards  ");
  expect(await screen.findByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(sendChat).toHaveBeenCalledWith(0, "Count the cards", []);
  expect(screen.getByLabelText("Message the assistant")).toHaveValue("");
  submit("What next?");
  await screen.findByText("Six cards.");
  expect(sendChat).toHaveBeenLastCalledWith(0, "What next?", [
    { role: "user", content: "Count the cards" }, { role: "assistant", content: '<img src=x onerror="alert(1)">' },
  ]);
  expect(saveBoard).not.toHaveBeenCalled();
});

it("applies combined AI changes immediately and uses its revision for the next manual save", async () => {
  const next = structuredClone(stored);
  next.revision = 1;
  const card = next.board.columns[0].cards.shift()!;
  card.title = "AI edited card";
  next.board.columns[4].cards.push(card);
  next.board.columns[1].cards.push({ id: "ai-new", title: "AI new card", details: "Added by assistant" });
  vi.mocked(sendChat).mockResolvedValue({ reply: "Created, edited, and moved.", updated: true, state: next });
  await show();
  submit("Create, edit, and move cards");
  await screen.findByText("Board updated and saved.");
  expect(within(screen.getByRole("region", { name: "Done column" })).getByRole("article", { name: "AI edited card" })).toBeInTheDocument();
  expect(screen.getByRole("article", { name: "AI new card" })).toHaveTextContent("Added by assistant");
  vi.mocked(saveBoard).mockImplementationOnce(async (state) => ({ ...state, revision: 2 }));
  fireEvent.click(screen.getByRole("button", { name: "Delete AI new card" }));
  await waitFor(() => expect(saveBoard).toHaveBeenCalled());
  expect(vi.mocked(saveBoard).mock.calls[0][0].revision).toBe(1);
});

it("prevents duplicate submissions and manual edits during AI requests, then restores focus", async () => {
  let finish!: (value: ChatResponse) => void;
  vi.mocked(sendChat).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  await show();
  submit();
  fireEvent.submit(screen.getByRole("button", { name: "Working..." }).closest("form")!);
  expect(sendChat).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Message the assistant")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Delete Draft onboarding" })).toBeDisabled();
  await act(async () => finish({ reply: "Done", updated: false, state: stored }));
  expect(screen.getByLabelText("Message the assistant")).toHaveFocus();
});

it.each([413, 502, 503, 504, 422])("retains a failed draft for explicit retry after HTTP %s", async (status) => {
  vi.mocked(sendChat).mockRejectedValueOnce(new BoardApiError(status));
  await show();
  submit("Keep this request");
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Message the assistant")).toHaveValue("Keep this request");
  expect(within(screen.getByRole("log")).queryByText("Keep this request")).not.toBeInTheDocument();
  expect(sendChat).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Send again" }));
  await screen.findByText("Six cards.");
  expect(sendChat).toHaveBeenLastCalledWith(0, "Keep this request", []);
});

it("reloads a conflict and sends a fresh revision only after explicit resubmission", async () => {
  vi.mocked(sendChat).mockRejectedValueOnce(new BoardApiError(409));
  await show();
  const latest = structuredClone(stored);
  latest.revision = 8;
  latest.board.columns[0].title = "Latest backlog";
  vi.mocked(loadBoard).mockResolvedValueOnce(latest);
  submit();
  expect(await screen.findByRole("alert")).toHaveTextContent("latest version is loaded");
  expect(screen.getByLabelText("Rename Latest backlog")).toBeInTheDocument();
  expect(sendChat).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Send again" }));
  await waitFor(() => expect(sendChat).toHaveBeenCalledTimes(2));
  expect(sendChat).toHaveBeenLastCalledWith(8, "Count the cards", []);
});

it("blocks writes when conflict reload fails and recovers with Reload board", async () => {
  await show();
  vi.mocked(sendChat).mockRejectedValueOnce(new BoardApiError(409));
  vi.mocked(loadBoard).mockRejectedValueOnce(new Error("offline"));
  submit();
  await screen.findByRole("button", { name: "Reload board" });
  expect(screen.getByRole("button", { name: "Send again" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Reload board" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Send again" })).toBeEnabled());
});

it("requires a board review after an uncertain network result instead of silently repeating a write", async () => {
  await show();
  vi.mocked(sendChat).mockRejectedValueOnce(new Error("connection lost"));
  submit();
  await screen.findByRole("button", { name: "Reload board" });
  expect(screen.getByRole("button", { name: "Send again" })).toBeDisabled();
  expect(sendChat).toHaveBeenCalledTimes(1);
});

it("keeps at most twenty conversation entries", async () => {
  await show();
  for (let i = 0; i < 12; i++) {
    submit(`Question ${i}`);
    await waitFor(() => expect(screen.getByLabelText("Message the assistant")).toHaveValue(""));
  }
  expect(vi.mocked(sendChat).mock.calls[11][2]).toHaveLength(20);
  expect(within(screen.getByRole("log")).queryByText("Question 0")).not.toBeInTheDocument();
});

it("clears history and drafts on logout and returns to login when chat expires", async () => {
  vi.mocked(getSession).mockResolvedValue({ username: "user" });
  vi.mocked(signIn).mockResolvedValue({ username: "user" });
  vi.mocked(signOut).mockResolvedValue(undefined);
  render(<AuthGate />);
  fireEvent.click(await screen.findByRole("button", { name: "Board assistant" }));
  await screen.findByRole("heading", { name: "Board assistant" });
  submit();
  await screen.findByText("Six cards.");
  fireEvent.change(screen.getByLabelText("Message the assistant"), { target: { value: "Private draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await screen.findByLabelText("Username");
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Username"), "user");
  await user.type(screen.getByLabelText("Password"), "password");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  fireEvent.click(await screen.findByRole("button", { name: "Board assistant" }));
  await screen.findByRole("heading", { name: "Board assistant" });
  expect(screen.getByLabelText("Message the assistant")).toHaveValue("");
  expect(screen.queryByText("Six cards.")).not.toBeInTheDocument();
  vi.mocked(sendChat).mockRejectedValueOnce(new BoardApiError(401));
  submit();
  await screen.findByLabelText("Username");
  expect(screen.queryByRole("log")).not.toBeInTheDocument();
});

it("opens on demand, preserves drafts and history on close, and restores launcher focus", async () => {
  render(<KanbanBoard />);
  const launcher = await screen.findByRole("button", { name: "Board assistant" });
  expect(screen.queryByRole("dialog", { name: "Board assistant" })).not.toBeInTheDocument();
  launcher.focus();
  fireEvent.click(launcher);
  expect(screen.getByLabelText("Message the assistant")).toHaveFocus();
  submit("Remember this question");
  await screen.findByText("Six cards.");
  fireEvent.change(screen.getByLabelText("Message the assistant"), { target: { value: "Keep this draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Close assistant" }));
  expect(launcher).toHaveFocus();
  expect(launcher).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(launcher);
  expect(screen.getByLabelText("Message the assistant")).toHaveValue("Keep this draft");
  expect(screen.getByRole("log")).toHaveTextContent("Remember this question");
  expect(screen.getByRole("log")).toHaveTextContent("Six cards.");
});
