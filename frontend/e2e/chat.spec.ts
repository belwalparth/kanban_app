import { expect, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.request.post("/api/auth/login", { data: { username: "user", password: "password" } });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Board assistant" })).toBeVisible();
});

test("AI multi-card changes appear immediately, survive reload, and keep manual saves working", async ({ page, boardStore }) => {
  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.revision).toBe(boardStore.state.revision);
    expect(body.history).toEqual([]);
    const next = structuredClone(boardStore.state);
    next.revision++;
    const card = next.board.columns[0].cards.shift()!;
    card.title = "AI onboarding done";
    next.board.columns[4].cards.push(card);
    next.board.columns[1].cards.push({ id: "chat-test", title: "AI release checklist", details: "Check release" });
    boardStore.state = next;
    await route.fulfill({ json: { reply: "Created a checklist and updated onboarding.", updated: true, state: next } });
  });
  const input = page.getByLabel("Message the assistant");
  await input.fill("Create a checklist and edit/move onboarding to Done");
  await input.press("Tab");
  await expect(page.getByRole("button", { name: "Send message" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Board updated and saved.")).toBeVisible();
  await expect(input).toBeFocused();
  await expect(page.locator('[data-column="done"]').getByRole("article", { name: "AI onboarding done" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("article", { name: "AI release checklist" })).toBeVisible();
  await expect(page.getByRole("log")).not.toContainText("Created a checklist");
  await page.getByRole("button", { name: "Delete AI release checklist" }).click();
  await expect(page.getByRole("article", { name: "AI release checklist" })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Username", { exact: true }).fill("user");
  await page.getByLabel("Password", { exact: true }).fill("password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(input).toHaveValue("");
  await expect(page.getByRole("log")).not.toContainText("Create a checklist and edit/move");
  await expect(page.getByRole("article", { name: "AI onboarding done" })).toBeVisible();
});

test("answer-only replies forward history, display plain text, and clear on logout", async ({ page, boardStore }) => {
  let calls = 0;
  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.history).toHaveLength(calls * 2);
    calls++;
    await route.fulfill({ json: { reply: "<b>Six cards.</b>", updated: false, state: boardStore.state } });
  });
  const input = page.getByLabel("Message the assistant");
  await input.fill("How many cards?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("log")).toContainText("<b>Six cards.</b>");
  await expect(page.getByRole("log").locator("b")).toHaveCount(0);
  await input.fill("What next?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(input).toHaveValue("");
  expect(calls).toBe(2);
  expect(boardStore.state.revision).toBe(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("log")).toHaveCount(0);
});

test("pending requests block duplicate actions and provider failures retain the draft for retry", async ({ page, boardStore }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  await page.route("**/api/chat", async (route) => {
    calls++;
    if (calls === 1) { await gate; await route.fulfill({ status: 503, json: { detail: "Unavailable" } }); }
    else await route.fulfill({ json: { reply: "Recovered", updated: false, state: boardStore.state } });
  });
  const input = page.getByLabel("Message the assistant");
  await input.fill("Keep this draft");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("button", { name: "Working..." })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Delete Draft onboarding" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeDisabled();
  release();
  await expect(page.getByRole("complementary", { name: "Board assistant" }).getByRole("alert")).toContainText("AI is unavailable");
  await expect(input).toHaveValue("Keep this draft");
  expect(calls).toBe(1);
  await page.getByRole("button", { name: "Send again" }).click();
  await expect(page.getByRole("log")).toContainText("Recovered");
});

test("conflicts reload canonical state and keep requests explicit; expiry clears chat", async ({ page, boardStore }) => {
  await page.route("**/api/chat", async (route) => {
    boardStore.state.revision = 4;
    boardStore.state.board.columns[0].title = "Fresh backlog";
    await route.fulfill({ status: 409, json: { detail: "Conflict" } });
  });
  await page.getByLabel("Message the assistant").fill("Move a card");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("complementary", { name: "Board assistant" }).getByRole("alert")).toContainText("latest version is loaded");
  await expect(page.getByLabel("Rename Fresh backlog")).toHaveValue("Fresh backlog");
  await page.unroute("**/api/chat");
  await page.route("**/api/chat", (route) => route.fulfill({ status: 401, json: { detail: "Expired" } }));
  await page.getByRole("button", { name: "Send again" }).click();
  await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
  await expect(page.getByRole("log")).toHaveCount(0);
});

test("sidebar fits desktop and narrow screens without page overflow", async ({ page }, testInfo) => {
  const sidebar = page.getByRole("complementary", { name: "Board assistant" });
  await sidebar.scrollIntoViewIfNeeded();
  const box = (await sidebar.boundingBox())!;
  const width = page.viewportSize()!.width;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/chat-${testInfo.project.name}.png`, fullPage: true });
});
