import { expect, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.request.post("/api/auth/login", { data: { username: "user", password: "password" } });
  await page.goto("/");
});

test("static board hydrates with no failed assets or runtime errors", async ({ page, request }) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("requestfailed", (request) => failures.push(request.url()));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Project board." })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(6);
  await expect(page.getByRole("region", { name: / column$/ })).toHaveCount(5);
  expect(await (await request.get("/api/health")).json()).toEqual({ status: "ok" });
  expect((await request.get("/api/missing")).status()).toBe(404);
  expect((await request.get("/_next/missing.js")).status()).toBe(404);
  expect(failures).toEqual([]);
});

test("creates, edits, moves, deletes, and updates progress", async ({ page }) => {
  await page.getByRole("button", { name: "Add card to Backlog" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Ship the release");
  await page.getByLabel("Details", { exact: true }).fill("Final acceptance checks");
  await page.getByRole("button", { name: "Create card", exact: true }).click();
  await expect(page.getByLabel("7 cards on this board")).toBeVisible();
  await page.getByRole("button", { name: "Edit Ship the release" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Release complete");
  await page.getByLabel("Details", { exact: true }).fill("Ready to celebrate");
  await page.getByLabel("Column", { exact: true }).selectOption("done");
  await page.getByRole("button", { name: "Save changes" }).click();
  const done = page.getByRole("region", { name: "Done column" });
  await expect(done.getByRole("article", { name: "Release complete" })).toContainText("Ready to celebrate");
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "29");
  await page.getByRole("button", { name: "Delete Release complete" }).click();
  await expect(page.getByRole("article")).toHaveCount(6);
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "17");
});

test("cancel and Escape discard edits and restore keyboard focus", async ({ page }) => {
  const edit = page.getByRole("button", { name: "Edit Draft onboarding" });
  await edit.click();
  await expect(page.getByLabel("Title", { exact: true })).toBeFocused();
  await page.getByLabel("Title", { exact: true }).fill("Discard this edit");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(edit).toBeFocused();
  await edit.press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(edit).toBeFocused();
  await expect(page.getByRole("article", { name: "Draft onboarding" })).toBeVisible();
});

test("column rename commits once and survives refresh", async ({ page }) => {
  const review = page.getByRole("textbox", { name: "Rename Review" });
  await review.fill("Final review");
  await review.press("Enter");
  await expect(page.getByRole("region", { name: "Final review column" })).toHaveCount(1);
  await expect(page.getByRole("region", { name: / column$/ })).toHaveCount(5);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Rename Final review" })).toHaveValue("Final review");
});

test("native drag/drop moves a card and dropping in the same column is a no-op", async ({ page, isMobile }) => {
  test.skip(isMobile, "Touch users move cards through the editor's column selector.");
  const card = page.getByRole("article", { name: "Design sprint plan" });
  const todo = page.getByRole("region", { name: "To do column" });
  await card.dragTo(todo.locator(".column-header"));
  await expect(todo.getByRole("article")).toHaveCount(1);
  const done = page.getByRole("region", { name: "Done column" });
  await card.dragTo(done.locator(".column-header"));
  await expect(done.getByRole("article", { name: "Design sprint plan" })).toBeVisible();
  await expect(todo.getByRole("article")).toHaveCount(0);
  await expect(todo.getByText("A little breathing room.")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(6);
});

test("layout contains horizontal scrolling and modal fits the viewport", async ({ page }, testInfo) => {
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({ path: testInfo.outputPath("board.png"), fullPage: true });
  await page.getByRole("button", { name: "Add card to Backlog" }).click();
  const dialog = page.getByRole("dialog");
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  await page.getByLabel("Title", { exact: true }).fill("Keyboard task");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Details", { exact: true })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("editor.png"), fullPage: true });
});
