import { test, expect } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.request.post("/api/auth/login", { data: { username: "user", password: "password" } });
});

test("create, rename, switch, history and reload preserve independent boards", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Project board." })).toBeVisible();
  await page.getByRole("button", { name: "New board", exact: true }).click();
  await expect(page.getByLabel("Board name", { exact: true })).toBeFocused();
  await page.getByLabel("Board name", { exact: true }).fill("Launch work");
  await page.getByRole("button", { name: "Create board", exact: true }).click();
  await expect(page).toHaveURL(/\?board=2$/);
  await expect(page.getByRole("heading", { name: "Launch work." })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.getByRole("button", { name: "Add card to Backlog" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Only on launch board");
  await page.getByRole("button", { name: "Create card", exact: true }).click();
  await expect(page.getByRole("article", { name: "Only on launch board" })).toBeVisible();
  await page.getByRole("textbox", { name: "Rename Review" }).fill("Launch review");
  await page.getByRole("textbox", { name: "Rename Review" }).press("Enter");
  await expect(page.getByRole("region", { name: "Launch review column" })).toBeVisible();
  await page.getByRole("button", { name: "Rename board", exact: true }).click();
  await page.getByLabel("Board name", { exact: true }).fill("Release board");
  await page.getByRole("button", { name: "Save board name" }).click();
  await expect(page.getByRole("heading", { name: "Release board." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rename board", exact: true })).toBeFocused();
  await page.getByLabel("Board", { exact: true }).selectOption("1");
  await expect(page.getByRole("article")).toHaveCount(6);
  await expect(page.getByRole("article", { name: "Only on launch board" })).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Release board." })).toBeVisible();
  await expect(page.getByRole("article", { name: "Only on launch board" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Launch review column" })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { name: "Project board." })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("assistant drafts and conversations are private to the selected board", async ({ page, boardStore }) => {
  boardStore.additional.set(2, { name: "Second board", state: { revision: 0, board: { columns: structuredClone(boardStore.state.board.columns).map(column => ({ ...column, cards: [] })) } } });
  const calls: { id: number; history: unknown[] }[] = [];
  await page.route("**/api/boards/*/chat", async route => {
    const id = Number(new URL(route.request().url()).pathname.split("/")[3]);
    const body = route.request().postDataJSON();
    calls.push({ id, history: body.history });
    await route.fulfill({ json: { reply: `Answer for board ${id}`, updated: false, state: id === 1 ? boardStore.state : boardStore.additional.get(id)!.state } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Board assistant", exact: true }).click();
  await page.getByLabel("Message the assistant").fill("First conversation");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("log")).toContainText("Answer for board 1");
  await page.getByLabel("Message the assistant").fill("First draft");
  await page.keyboard.press("Escape");
  await page.getByLabel("Board", { exact: true }).selectOption("2");
  await expect(page.getByRole("heading", { name: "Second board." })).toBeVisible();
  await page.getByRole("button", { name: "Board assistant", exact: true }).click();
  await expect(page.getByLabel("Message the assistant")).toHaveValue("");
  await expect(page.getByRole("log")).not.toContainText("First conversation");
  await page.getByLabel("Message the assistant").fill("Second conversation");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("log")).toContainText("Answer for board 2");
  expect(calls).toEqual([{ id: 1, history: [] }, { id: 2, history: [] }]);
  await page.keyboard.press("Escape");
  await page.getByLabel("Board", { exact: true }).selectOption("1");
  await page.getByRole("button", { name: "Board assistant", exact: true }).click();
  await expect(page.getByLabel("Message the assistant")).toHaveValue("First draft");
  await expect(page.getByRole("log")).toContainText("First conversation");
  await expect(page.getByRole("log")).not.toContainText("Second conversation");
});

test("history navigation waits for a pending AI response without mixing boards or losing its reply", async ({ page, boardStore }) => {
  boardStore.additional.set(2, { name: "Second board", state: { revision: 0, board: { columns: structuredClone(boardStore.state.board.columns).map(column => ({ ...column, cards: [] })) } } });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/boards/2/chat", async route => {
    await gate;
    const second = boardStore.additional.get(2)!;
    second.state.revision++;
    second.state.board.columns[0].cards.push({ id: "pending-second", title: "Second board AI only", details: "" });
    await route.fulfill({ json: { reply: "Second board saved", updated: true, state: second.state } });
  });
  try {
    await page.goto("/");
    await page.getByLabel("Board", { exact: true }).selectOption("2");
    await expect(page.getByRole("heading", { name: "Second board." })).toBeVisible();
    await page.getByRole("button", { name: "Board assistant", exact: true }).click();
    await page.getByLabel("Message the assistant").fill("Create a temporary card");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Working on your request...")).toBeVisible();
    await page.getByRole("button", { name: "Close assistant" }).click();
    await page.goBack();
    await expect(page.getByText(/Your board will switch afterward/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Second board." })).toBeVisible();
    release();
    await expect(page.getByRole("heading", { name: "Project board." })).toBeVisible();
    await expect(page.getByRole("article", { name: "Second board AI only" })).toHaveCount(0);
    await page.goForward();
    await expect(page.getByRole("article", { name: "Second board AI only" })).toBeVisible();
    await page.getByRole("button", { name: "Board assistant", exact: true }).click();
    await expect(page.getByRole("log")).toContainText("Second board saved");
  } finally { release(); }
});

test("invalid board links recover through the selector without revealing other board data", async ({ page }) => {
  await page.goto("/?board=999");
  await expect(page.locator(".session-retry").getByRole("alert")).toContainText("unavailable");
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.getByLabel("Board", { exact: true }).selectOption("1");
  await expect(page.getByRole("heading", { name: "Project board." })).toBeVisible();
});

test("board selection works with keyboard and mobile controls without overflowing long names", async ({ page, boardStore }, testInfo) => {
  const name = "Second " + "board".repeat(15);
  boardStore.additional.set(2, { name, state: { revision: 0, board: { columns: structuredClone(boardStore.state.board.columns).map(column => ({ ...column, cards: [] })) } } });
  await page.goto("/");
  const picker = page.getByLabel("Board", { exact: true });
  await expect(page.getByRole("heading", { name: "Project board." })).toBeVisible();
  if (testInfo.project.name === "desktop") {
    await picker.focus();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
  } else await picker.selectOption("2");
  await expect(page.getByRole("heading", { name: `${name}.`, exact: true })).toBeVisible();
  await expect(picker).toHaveValue("2");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("Back during pending creation keeps URL and board aligned after the new board is saved", async ({ page, boardStore }) => {
  boardStore.additional.set(2, { name: "Second board", state: { revision: 0, board: { columns: structuredClone(boardStore.state.board.columns).map(column => ({ ...column, cards: [] })) } } });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/boards", async route => {
    if (route.request().method() === "POST") await gate;
    await route.fallback();
  });
  try {
    await page.goto("/");
    await page.getByLabel("Board", { exact: true }).selectOption("2");
    await expect(page.getByRole("heading", { name: "Second board." })).toBeVisible();
    await page.getByRole("button", { name: "New board", exact: true }).click();
    await page.getByLabel("Board name", { exact: true }).fill("Third board");
    await page.getByRole("button", { name: "Create board", exact: true }).click();
    await expect(page.getByRole("button", { name: "Saving...", exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByText(/Your board will switch afterward/)).toBeVisible();
    release();
    await expect(page.getByRole("heading", { name: "Project board." })).toBeVisible();
    await expect(page).toHaveURL(/\?board=1$/);
    await expect(page.getByRole("option", { name: "Third board", exact: true })).toHaveCount(1);
  } finally { release(); }
});
