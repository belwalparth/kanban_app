import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanBoard } from "./KanbanBoard";
import { BoardApiError, loadBoard, saveBoard } from "@/lib/board-api";
import { resetBoardServer, stored } from "@/test/board-server";

vi.mock("@/lib/board-api", async (original) => ({ ...await original<typeof import("@/lib/board-api")>(), listBoards: vi.fn(), createBoard: vi.fn(), renameBoard: vi.fn(), loadBoard: vi.fn(), saveBoard: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); resetBoardServer(); });

async function showBoard() {
  render(<KanbanBoard />);
  await screen.findByRole("heading", { name: "Project board." });
}

describe("Kanban board interactions", () => {
  it("shows five columns, six cards, and completion progress", async () => {
    await showBoard();
    expect(screen.getAllByRole("region", { name: / column$/ })).toHaveLength(5);
    expect(screen.getAllByRole("article")).toHaveLength(6);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "17");
  });

  it("creates a card with trimmed title/details and updates counts", async () => {
    const user = userEvent.setup();
    await showBoard();
    await user.click(screen.getByRole("button", { name: "Add card to To do" }));
    expect(screen.getByRole("button", { name: "Create card" })).toBeDisabled();
    await user.type(screen.getByLabelText("Title"), "  Ship feature  ");
    await user.type(screen.getByLabelText("Details"), "  Ready for review  ");
    await user.click(screen.getByRole("button", { name: "Create card" }));
    const column = screen.getByRole("region", { name: "To do column" });
    expect(within(column).getByRole("article", { name: "Ship feature" })).toHaveTextContent("Ready for review");
    expect(screen.getByLabelText("7 cards on this board")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("cancels creation without adding a card", async () => {
    const user = userEvent.setup();
    await showBoard();
    await user.click(screen.getByRole("button", { name: "Add card to Backlog" }));
    await user.type(screen.getByLabelText("Title"), "Discarded");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getAllByRole("article")).toHaveLength(6);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("saves edited text and moves the card through the editor", async () => {
    const user = userEvent.setup();
    await showBoard();
    await user.click(screen.getByRole("button", { name: "Edit Draft onboarding" }));
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Onboarding complete");
    await user.clear(screen.getByLabelText("Details"));
    await user.type(screen.getByLabelText("Details"), "Final copy approved");
    await user.selectOptions(screen.getByLabelText("Column"), "done");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    const done = screen.getByRole("region", { name: "Done column" });
    expect(within(done).getByRole("article", { name: "Onboarding complete" })).toHaveTextContent("Final copy approved");
    expect(screen.getAllByRole("article")).toHaveLength(6);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "33");
  });

  it("keeps original text on cancel and dismisses on Escape", async () => {
    const user = userEvent.setup();
    await showBoard();
    await user.click(screen.getByRole("button", { name: "Edit Draft onboarding" }));
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Discarded");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("article", { name: "Draft onboarding" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit Draft onboarding" }));
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not accept a whitespace-only title", async () => {
    const user = userEvent.setup();
    await showBoard();
    await user.click(screen.getByRole("button", { name: "Edit Draft onboarding" }));
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "   ");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("deletes a card and displays the empty column", async () => {
    const user = userEvent.setup();
    await showBoard();
    await user.click(screen.getByRole("button", { name: "Delete Design sprint plan" }));
    expect(screen.queryByRole("article", { name: "Design sprint plan" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("5 cards on this board")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "To do column" })).getByText("A little breathing room.")).toBeInTheDocument();
  });

  it("renames a column without changing the number of columns or cards", async () => {
    const user = userEvent.setup();
    await showBoard();
    const title = screen.getByRole("textbox", { name: "Rename Review" });
    await user.clear(title);
    await user.type(title, "Final review");
    expect(saveBoard).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    await screen.findByRole("region", { name: "Final review column" });
    expect(screen.getByRole("region", { name: "Final review column" })).toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: / column$/ })).toHaveLength(5);
    expect(screen.getAllByRole("article")).toHaveLength(6);
  });

  it("moves a dragged card exactly once and updates counts", async () => {
    await showBoard();
    const card = screen.getByRole("article", { name: "Design sprint plan" });
    const done = screen.getByRole("region", { name: "Done column" });
    fireEvent.dragStart(card, { dataTransfer: { setData() {}, effectAllowed: "" } });
    fireEvent.dragOver(done);
    fireEvent.drop(done);
    expect(await within(done).findByRole("article", { name: "Design sprint plan" })).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(6);
    expect(saveBoard).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("Your board is saved.");
  });

  it("shows a loading state and retries a failed initial load", async () => {
    vi.mocked(loadBoard).mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    render(<KanbanBoard />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading your board");
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load your board");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Project board." })).toBeInTheDocument();
  });

  it("retains a failed card draft and saves it on explicit retry", async () => {
    vi.mocked(saveBoard).mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    await showBoard();
    await user.click(screen.getByRole("button", { name: "Edit Draft onboarding" }));
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Recoverable draft");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save");
    expect(screen.getByLabelText("Title")).toHaveValue("Recoverable draft");
    expect(screen.getByRole("article", { name: "Draft onboarding" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("article", { name: "Recoverable draft" })).toBeInTheDocument();
    expect(stored.revision).toBe(1);
  });

  it("keeps failed deletes and moves visible in their saved columns", async () => {
    vi.mocked(saveBoard).mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    await showBoard();
    await user.click(screen.getByRole("button", { name: "Delete Design sprint plan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save");
    const todo = screen.getByRole("region", { name: "To do column" });
    const card = within(todo).getByRole("article", { name: "Design sprint plan" });
    fireEvent.dragStart(card, { dataTransfer: { setData() {}, effectAllowed: "" } });
    fireEvent.drop(screen.getByRole("region", { name: "Done column" }));
    await waitFor(() => expect(saveBoard).toHaveBeenCalledTimes(2));
    expect(within(todo).getByRole("article", { name: "Design sprint plan" })).toBeInTheDocument();
  });

  it("prevents overlapping saves and disables closing a pending draft", async () => {
    let complete!: (state: typeof stored) => void;
    vi.mocked(saveBoard).mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
    const user = userEvent.setup();
    await showBoard();
    await user.click(screen.getByRole("button", { name: "Edit Draft onboarding" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add card to Backlog" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    expect(saveBoard).toHaveBeenCalledOnce();
    await act(async () => { complete({ ...stored, revision: 1 }); });
  });

  it("reloads canonical state after a conflict without replaying the edit", async () => {
    vi.mocked(saveBoard).mockRejectedValueOnce(new BoardApiError(409));
    const user = userEvent.setup();
    await showBoard();
    const latest = structuredClone(stored);
    latest.revision = 4;
    latest.board.columns[0].title = "Another tab";
    vi.mocked(loadBoard).mockResolvedValueOnce(latest);
    await user.click(screen.getByRole("button", { name: "Delete Draft onboarding" }));
    expect(await screen.findByRole("region", { name: "Another tab column" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("your edit was not saved");
    expect(screen.getByRole("article", { name: "Draft onboarding" })).toBeInTheDocument();
    expect(saveBoard).toHaveBeenCalledOnce();
  });

  it("blocks edits after a conflict reload fails until explicit reload succeeds", async () => {
    const user = userEvent.setup();
    await showBoard();
    vi.mocked(saveBoard).mockRejectedValueOnce(new BoardApiError(409));
    vi.mocked(loadBoard).mockRejectedValueOnce(new Error("offline"));
    await user.click(screen.getByRole("button", { name: "Delete Draft onboarding" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Reload the board before editing");
    expect(screen.getByRole("button", { name: "Delete Draft onboarding" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Reload board" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete Draft onboarding" })).toBeEnabled());
  });

  it("rejects blank column names and allows Escape to discard typing", async () => {
    const user = userEvent.setup();
    await showBoard();
    const title = screen.getByRole("textbox", { name: "Rename Review" });
    await user.clear(title);
    await user.keyboard("{Enter}");
    expect(title).toHaveValue("Review");
    expect(saveBoard).not.toHaveBeenCalled();
    await user.type(title, "Discard");
    await user.keyboard("{Escape}");
    expect(title).toHaveValue("Review");
    expect(saveBoard).not.toHaveBeenCalled();
  });

  it("reports an expired session on load and save", async () => {
    const expired = vi.fn();
    vi.mocked(loadBoard).mockRejectedValueOnce(new BoardApiError(401));
    const first = render(<KanbanBoard onSessionExpired={expired} />);
    await waitFor(() => expect(expired).toHaveBeenCalledOnce());
    first.unmount();
    render(<KanbanBoard onSessionExpired={expired} />);
    await screen.findByRole("heading", { name: "Project board." });
    vi.mocked(saveBoard).mockRejectedValueOnce(new BoardApiError(401));
    await userEvent.setup().click(screen.getByRole("button", { name: "Delete Draft onboarding" }));
    await waitFor(() => expect(expired).toHaveBeenCalledTimes(2));
  });
});

it.each([413, 422])("retains failed edits and explains rejected large board saves after HTTP %s", async (status) => {
  await showBoard();
  vi.mocked(saveBoard).mockRejectedValueOnce(new BoardApiError(status));
  fireEvent.click(screen.getByRole("button", { name: "Edit Draft onboarding" }));
  fireEvent.change(screen.getByLabelText("Details"), { target: { value: "Keep this draft for correction" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("shorten large card text");
  expect(screen.getByLabelText("Details")).toHaveValue("Keep this draft for correction");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
});
