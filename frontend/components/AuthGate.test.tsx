import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthConfig, getSession, signIn, signOut } from "@/lib/auth";
import { AuthGate } from "./AuthGate";
import { resetBoardServer } from "@/test/board-server";
import { BoardApiError, saveBoard } from "@/lib/board-api";

vi.mock("@/lib/auth", () => ({ getAuthConfig: vi.fn(), getSession: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/board-api", async (original) => ({ ...await original<typeof import("@/lib/board-api")>(), listBoards: vi.fn(), createBoard: vi.fn(), renameBoard: vi.fn(), loadBoard: vi.fn(), saveBoard: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAuthConfig).mockResolvedValue({ google: false, demo: true });
  vi.mocked(getSession).mockResolvedValue(null);
  vi.mocked(signIn).mockResolvedValue({ username: "user" });
  vi.mocked(signOut).mockResolvedValue(undefined);
  resetBoardServer();
});

async function enterCredentials(username = "user", password = "password") {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Username"), username);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  return user;
}

describe("Authentication gate", () => {
  it("hides the board until the server has checked the session", () => {
    vi.mocked(getSession).mockReturnValue(new Promise(() => {}));
    render(<AuthGate />);
    expect(screen.getByRole("status")).toHaveTextContent("Checking your session");
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("restores a server-confirmed session without a login form", async () => {
    vi.mocked(getSession).mockResolvedValue({ username: "user" });
    render(<AuthGate />);
    expect(await screen.findByRole("heading", { name: "Project board." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("submits credentials to the server before displaying the board", async () => {
    render(<AuthGate />);
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    await enterCredentials();
    expect(signIn).toHaveBeenCalledWith("user", "password");
    expect(await screen.findByRole("heading", { name: "Project board." })).toBeInTheDocument();
  });

  it("shows invalid-credential errors and clears the password", async () => {
    vi.mocked(signIn).mockRejectedValue(new Error("Username or password is incorrect."));
    render(<AuthGate />);
    await enterCredentials("wrong", "wrong");
    expect(signIn).toHaveBeenCalledWith("wrong", "wrong");
    expect(await screen.findByRole("alert")).toHaveTextContent("Username or password is incorrect.");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("Username")).toHaveValue("wrong");
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("disables sign-in controls while a request is pending", async () => {
    vi.mocked(signIn).mockReturnValue(new Promise(() => {}));
    render(<AuthGate />);
    await enterCredentials();
    expect(screen.getByRole("button", { name: "Signing in..." })).toBeDisabled();
    expect(screen.getByLabelText("Username")).toBeDisabled();
    expect(screen.getByLabelText("Password")).toBeDisabled();
  });

  it("unmounts private UI on logout and loads saved edits on sign-in", async () => {
    vi.mocked(getSession).mockResolvedValue({ username: "user" });
    const user = userEvent.setup();
    render(<AuthGate />);
    const column = await screen.findByRole("textbox", { name: "Rename Review" });
    await user.clear(column);
    await user.type(column, "Private draft");
    await user.keyboard("{Enter}");
    await screen.findByRole("region", { name: "Private draft column" });
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledOnce();
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    await enterCredentials();
    expect(await screen.findByRole("textbox", { name: "Rename Private draft" })).toHaveValue("Private draft");
  });

  it("keeps the board visible with an error if logout fails", async () => {
    vi.mocked(getSession).mockResolvedValue({ username: "user" });
    vi.mocked(signOut).mockRejectedValue(new Error("Network unavailable"));
    const user = userEvent.setup();
    render(<AuthGate />);
    await screen.findByRole("heading", { name: "Project board." });
    await user.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't sign out.");
    expect(screen.getAllByRole("article")).toHaveLength(6);
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
  });

  it("lets the user retry a failed initial session check", async () => {
    vi.mocked(getSession).mockRejectedValueOnce(new Error("Network unavailable")).mockResolvedValueOnce(null);
    const user = userEvent.setup();
    render(<AuthGate />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't check your session.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
  });

  it("clears the board when a focus check discovers the session is gone", async () => {
    vi.mocked(getSession).mockResolvedValueOnce({ username: "user" }).mockResolvedValueOnce(null);
    render(<AuthGate />);
    await screen.findByRole("heading", { name: "Project board." });
    fireEvent.focus(window);
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("preserves current edits when a focus check confirms the same session", async () => {
    vi.mocked(getSession).mockResolvedValue({ username: "user" });
    const user = userEvent.setup();
    render(<AuthGate />);
    const column = await screen.findByRole("textbox", { name: "Rename Review" });
    await user.clear(column);
    await user.type(column, "Still editing");
    fireEvent.focus(window);
    expect(await screen.findByRole("textbox", { name: "Rename Review" })).toHaveValue("Still editing");
  });

  it("does not let an older session check restore the board after logout", async () => {
    let finishCheck!: (user: { username: string }) => void;
    vi.mocked(getSession).mockResolvedValueOnce({ username: "user" }).mockReturnValueOnce(new Promise((resolve) => { finishCheck = resolve; }));
    const user = userEvent.setup();
    render(<AuthGate />);
    await screen.findByRole("heading", { name: "Project board." });
    fireEvent.focus(window);
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByRole("heading", { name: "Welcome back" });
    await act(async () => { finishCheck({ username: "user" }); });
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("returns to login and removes the board when a save returns 401", async () => {
    vi.mocked(getSession).mockResolvedValue({ username: "user" });
    vi.mocked(saveBoard).mockRejectedValueOnce(new BoardApiError(401));
    render(<AuthGate />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Delete Draft onboarding" }));
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });
});

it("shows Google sign-in and hides demo credentials when demo login is disabled", async () => {
  vi.mocked(getAuthConfig).mockResolvedValue({ google: true, demo: false });
  render(<AuthGate />);
  const link = await screen.findByRole("link", { name: "Continue with Google" });
  expect(link).toHaveAttribute("href", "/api/auth/google/start");
  expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  expect(screen.queryByText(/Demo access|Local demo access/)).not.toBeInTheDocument();
});

it("explains cancelled Google sign-in and removes the callback error from the URL", async () => {
  window.history.replaceState(null, "", "/?auth_error=cancelled");
  vi.mocked(getAuthConfig).mockResolvedValue({ google: true, demo: false });
  render(<AuthGate />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Google sign-in was cancelled");
  await waitFor(() => expect(window.location.search).toBe(""));
  expect(screen.getByRole("link", { name: "Continue with Google" })).toBeInTheDocument();
});

it("shows unavailable sign-in clearly when neither method is configured", async () => {
  vi.mocked(getAuthConfig).mockResolvedValue({ google: false, demo: false });
  render(<AuthGate />);
  expect(await screen.findByText(/Sign-in is temporarily unavailable/)).toBeInTheDocument();
  expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
});

it("clears the mounted private board when a focus check discovers a different account", async () => {
  vi.mocked(getSession).mockResolvedValueOnce({ username: "Same name", id: 1 }).mockResolvedValueOnce({ username: "Same name", id: 2 });
  render(<AuthGate />);
  fireEvent.click(await screen.findByRole("button", { name: "Board assistant" }));
  fireEvent.change(screen.getByLabelText("Message the assistant"), { target: { value: "First account private draft" } });
  fireEvent.focus(window);
  await screen.findByRole("button", { name: "Board assistant" });
  expect(screen.queryByRole("dialog", { name: "Board assistant" })).not.toBeInTheDocument();
});
