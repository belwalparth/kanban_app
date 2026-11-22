import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { AuthGate } from "./AuthGate";
import { KanbanBoard } from "./KanbanBoard";
import { BoardApiError, createBoard, listBoards, loadBoard, saveBoard } from "@/lib/board-api";
import { acceptInvitation, createInvitation, inspectInvitation, listInvitations, listMembers, removeMember, revokeInvitation } from "@/lib/sharing-api";
import { getAuthConfig, getSession, signIn, signOut } from "@/lib/auth";
import { sendChat } from "@/lib/chat-api";
import { boardNames, getStoredBoard, resetBoardServer } from "@/test/board-server";

vi.mock("@/lib/board-api", async original => ({ ...await original<typeof import("@/lib/board-api")>(), listBoards: vi.fn(), createBoard: vi.fn(), renameBoard: vi.fn(), loadBoard: vi.fn(), saveBoard: vi.fn() }));
vi.mock("@/lib/sharing-api", async original => ({ ...await original<typeof import("@/lib/sharing-api")>(), acceptInvitation: vi.fn(), inspectInvitation: vi.fn(), createInvitation: vi.fn(), listInvitations: vi.fn(), listMembers: vi.fn(), removeMember: vi.fn(), revokeInvitation: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthConfig: vi.fn(), getSession: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/chat-api", () => ({ sendChat: vi.fn() }));
const token = "a".repeat(43);
const pending = { id: 3, email: "guest@example.test", expires_at: 2000000000, status: "pending" as const };

beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear(); resetBoardServer();
  vi.mocked(getSession).mockResolvedValue({ id: 1, username: "Owner" });
  vi.mocked(getAuthConfig).mockResolvedValue({ google: true, demo: true });
  vi.mocked(signOut).mockResolvedValue(undefined);
  vi.mocked(signIn).mockResolvedValue({ id: 1, username: "Owner" });
  vi.mocked(listInvitations).mockResolvedValue([]);
  vi.mocked(listMembers).mockResolvedValue([]);
  vi.mocked(inspectInvitation).mockResolvedValue({ board_id: 1, name: "Project board", status: "pending" });
  vi.mocked(acceptInvitation).mockResolvedValue({ id: 1, name: "Project board", revision: 0, role: "member" });
});

it("creates a link only on explicit invite, keeps it out of URLs and confirms member removal", async () => {
  const user = userEvent.setup();
  vi.mocked(createInvitation).mockResolvedValue({ ...pending, link: `http://testserver/#invite=${token}` });
  vi.mocked(listMembers).mockResolvedValue([{ user_id: 2, email: "guest@example.test", display_name: "Guest", joined_at: 1 }]);
  render(<KanbanBoard />);
  await user.click(await screen.findByRole("button", { name: "Share board" }));
  const dialog = screen.getByRole("dialog", { name: "Share Project board" });
  await waitFor(() => expect(screen.getByLabelText("Google email to invite")).toHaveFocus());
  await user.type(screen.getByLabelText("Google email to invite"), "guest@example.test");
  await user.click(screen.getByRole("button", { name: "Create invitation" }));
  expect(await screen.findByLabelText("Invitation link")).toHaveValue(`http://testserver/#invite=${token}`);
  expect(createInvitation).toHaveBeenCalledWith(1, "guest@example.test");
  expect(window.location.href).not.toContain(token);
  await user.click(within(dialog).getByRole("button", { name: "Remove member" }));
  expect(removeMember).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Keep member" }));
  await user.click(screen.getByRole("button", { name: "Remove member" }));
  await user.click(screen.getByRole("button", { name: "Confirm removal" }));
  await waitFor(() => expect(removeMember).toHaveBeenCalledWith(1, 2));
  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.getByRole("button", { name: "Share board" })).toHaveFocus();
});

it("revokes pending invitations and retains invite input after failures", async () => {
  vi.mocked(listInvitations).mockResolvedValue([pending]);
  vi.mocked(createInvitation).mockRejectedValueOnce(new BoardApiError(409));
  const user = userEvent.setup(); render(<KanbanBoard />);
  await user.click(await screen.findByRole("button", { name: "Share board" }));
  await screen.findByText("guest@example.test");
  await user.type(screen.getByLabelText("Google email to invite"), "guest@example.test");
  await user.click(screen.getByRole("button", { name: "Create invitation" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("already has access");
  expect(screen.getByLabelText("Google email to invite")).toHaveValue("guest@example.test");
  await user.click(screen.getByRole("button", { name: "Revoke invitation" }));
  await waitFor(() => expect(revokeInvitation).toHaveBeenCalledWith(1, 3));
});

it("validates an invitation before showing its name and waits for explicit acceptance", async () => {
  window.history.replaceState(null, "", `/#invite=${token}`);
  let inspected!: (value: { board_id: number; name: string; status: "pending" }) => void;
  vi.mocked(inspectInvitation).mockImplementation(() => new Promise(resolve => { inspected = resolve; }));
  render(<AuthGate />);
  await screen.findByText("Checking your invitation...");
  expect(screen.queryByText("Project board")).not.toBeInTheDocument();
  expect(window.location.hash).toBe("");
  expect(sessionStorage.getItem("kanban.pendingInvitation")).toBe(token);
  await act(async () => inspected({ board_id: 1, name: "Project board", status: "pending" }));
  expect(acceptInvitation).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Accept invitation" }));
  await screen.findByRole("heading", { name: "Project board." });
  expect(acceptInvitation).toHaveBeenCalledWith(token);
  expect(window.location.search).toBe("?board=1");
  expect(sessionStorage.getItem("kanban.pendingInvitation")).toBeNull();
});

it("retains only the invitation token through sign-in and a wrong-account sign-out", async () => {
  window.history.replaceState(null, "", `/#invite=${token}`);
  vi.mocked(getSession).mockResolvedValue(null);
  vi.mocked(inspectInvitation).mockRejectedValue(new BoardApiError(403));
  const view = render(<AuthGate />);
  expect(await screen.findByText(/Sign in with the invited Google account/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Continue with Google" })).toHaveAttribute("href", "/api/auth/google/start");
  expect(inspectInvitation).not.toHaveBeenCalled();
  view.unmount(); // The OAuth round trip replaces the page but retains tab session storage.
  vi.mocked(getSession).mockResolvedValue({ id: 2, username: "Wrong account" });
  render(<AuthGate />);
  expect(await screen.findByRole("alert")).toHaveTextContent("account this invitation was sent to");
  expect(screen.queryByText("Project board")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Use another Google account" }));
  await screen.findByRole("link", { name: "Continue with Google" });
  expect(sessionStorage.getItem("kanban.pendingInvitation")).toBe(token);
});

it.each([404, 422])("explains unavailable invitations without disclosing board contents (%s)", async status => {
  window.history.replaceState(null, "", `/#invite=${token}`);
  vi.mocked(inspectInvitation).mockRejectedValue(new BoardApiError(status));
  render(<AuthGate />);
  expect(await screen.findByRole("alert")).toHaveTextContent("expired, been revoked, or already been used");
  expect(screen.queryByRole("button", { name: "Accept invitation" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Go to my boards" }));
  await screen.findByRole("heading", { name: "Project board." });
  expect(sessionStorage.getItem("kanban.pendingInvitation")).toBeNull();
});

it("shows member permissions and refreshes saved changes on focus", async () => {
  vi.mocked(listBoards).mockResolvedValue([{ id: 1, name: "Project board", revision: 0, role: "member" }]);
  render(<KanbanBoard />); await screen.findByRole("heading", { name: "Project board." });
  expect(screen.getByText("Shared with you")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Share board" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Rename board" })).not.toBeInTheDocument();
  const next = getStoredBoard(); next.revision++; next.board.columns[0].title = "Member update";
  fireEvent.focus(window);
  await screen.findByRole("region", { name: "Member update column" });
});

it("opens the user's own initial board even when an older joined board is listed first", async () => {
  const own = await createBoard("My initial board");
  vi.mocked(listBoards).mockResolvedValue([
    { id: 1, name: "Earlier shared board", revision: 0, role: "member" }, { ...own, role: "owner" },
  ]);
  render(<KanbanBoard />);
  await screen.findByRole("heading", { name: "My initial board." });
  expect(window.location.search).toBe("?board=2");
});

it("preserves an open draft on focus and after conflict, with explicit retry", async () => {
  const user = userEvent.setup(); render(<KanbanBoard />);
  await user.click(await screen.findByRole("button", { name: "Add card to Backlog" }));
  await user.type(screen.getByLabelText("Title", { exact: true }), "Keep my draft");
  getStoredBoard().revision++;
  getStoredBoard().board.columns[0].title = "Other member column";
  fireEvent.focus(window);
  await waitFor(() => expect(loadBoard).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText("Title", { exact: true })).toHaveValue("Keep my draft");
  expect(screen.queryByRole("region", { name: "Other member column column" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Create card" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("edit was not saved");
  expect(screen.getByLabelText("Title", { exact: true })).toHaveValue("Keep my draft");
  expect(saveBoard).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Create card" }));
  await screen.findByRole("article", { name: "Keep my draft" });
});

it("clears inaccessible board/chat state on focus even during an unsaved edit", async () => {
  const user = userEvent.setup(); render(<KanbanBoard />);
  await user.click(await screen.findByRole("button", { name: "Board assistant" }));
  await user.type(screen.getByLabelText("Message the assistant"), "Private memory");
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: true, cancelable: true }));
  await user.click(screen.getByRole("button", { name: "Add card to Backlog" }));
  vi.mocked(loadBoard).mockRejectedValueOnce(new BoardApiError(404));
  boardNames.delete(1);
  fireEvent.focus(window);
  expect(await screen.findByText(/Your access to this board has ended/)).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  boardNames.set(1, "Project board");
  await user.click(screen.getByRole("button", { name: "Reload list" }));
  await screen.findByRole("heading", { name: "Project board." });
  await user.click(screen.getByRole("button", { name: "Board assistant" }));
  expect(screen.getByLabelText("Message the assistant")).toHaveValue("");
  expect(sendChat).not.toHaveBeenCalled();
});
