import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { KanbanBoard } from "./KanbanBoard";

describe("Kanban board interactions", () => {
  it("shows five columns, six cards, and completion progress", () => {
    render(<KanbanBoard />);
    expect(screen.getAllByRole("region", { name: / column$/ })).toHaveLength(5);
    expect(screen.getAllByRole("article")).toHaveLength(6);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "17");
  });

  it("creates a card with trimmed title/details and updates counts", async () => {
    const user = userEvent.setup();
    render(<KanbanBoard />);
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
    render(<KanbanBoard />);
    await user.click(screen.getByRole("button", { name: "Add card to Backlog" }));
    await user.type(screen.getByLabelText("Title"), "Discarded");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getAllByRole("article")).toHaveLength(6);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("saves edited text and moves the card through the editor", async () => {
    const user = userEvent.setup();
    render(<KanbanBoard />);
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
    render(<KanbanBoard />);
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
    render(<KanbanBoard />);
    await user.click(screen.getByRole("button", { name: "Edit Draft onboarding" }));
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "   ");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("deletes a card and displays the empty column", async () => {
    const user = userEvent.setup();
    render(<KanbanBoard />);
    await user.click(screen.getByRole("button", { name: "Delete Design sprint plan" }));
    expect(screen.queryByRole("article", { name: "Design sprint plan" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("5 cards on this board")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "To do column" })).getByText("A little breathing room.")).toBeInTheDocument();
  });

  it("renames a column without changing the number of columns or cards", async () => {
    const user = userEvent.setup();
    render(<KanbanBoard />);
    const title = screen.getByRole("textbox", { name: "Rename Review" });
    await user.clear(title);
    await user.type(title, "Final review");
    expect(screen.getByRole("region", { name: "Final review column" })).toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: / column$/ })).toHaveLength(5);
    expect(screen.getAllByRole("article")).toHaveLength(6);
  });

  it("moves a dragged card exactly once and updates counts", () => {
    render(<KanbanBoard />);
    const card = screen.getByRole("article", { name: "Design sprint plan" });
    const done = screen.getByRole("region", { name: "Done column" });
    fireEvent.dragStart(card, { dataTransfer: { setData() {}, effectAllowed: "" } });
    fireEvent.dragOver(done);
    fireEvent.drop(done);
    expect(within(done).getByRole("article", { name: "Design sprint plan" })).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(6);
    expect(screen.getByRole("status")).toHaveTextContent("Card moved to Done.");
  });
});
