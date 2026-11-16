import { test, expect } from "./fixtures";
import { DEFAULT_COLUMNS } from "../lib/board";

test.beforeEach(async ({ page }) => {
  await page.request.post("/api/auth/login", { data: { username: "user", password: "password" } });
});

test("a failed card save retains the draft and an explicit retry persists it", async ({ page }) => {
  let fail = true;
  await page.route("**/api/board", async (route) => {
    if (fail && route.request().method() === "PUT") await route.fulfill({ status: 503, json: { detail: "Unavailable" } });
    else await route.fallback();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Edit Draft onboarding" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Recovered draft");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Couldn't save");
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Recovered draft");
  fail = false;
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("article", { name: "Recovered draft" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("article", { name: "Recovered draft" })).toBeVisible();
});

test("conflicts load the latest board without replaying a rejected edit", async ({ page }) => {
  let conflict = false;
  let writes = 0;
  const latest = { revision: 3, board: { columns: structuredClone(DEFAULT_COLUMNS) } };
  latest.board.columns[0].title = "Changed in another tab";
  await page.route("**/api/board", async (route) => {
    if (route.request().method() === "PUT") {
      writes += 1;
      conflict = true;
      await route.fulfill({ status: 409, json: { detail: "Conflict" } });
    } else if (conflict) await route.fulfill({ json: latest });
    else await route.fallback();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Delete Draft onboarding" }).click();
  await expect(page.locator(".board-error").getByRole("alert")).toContainText("your edit was not saved");
  await expect(page.getByRole("region", { name: "Changed in another tab column" })).toBeVisible();
  await expect(page.getByRole("article", { name: "Draft onboarding" })).toBeVisible();
  expect(writes).toBe(1);
});

test("an expired session during save removes the board and its draft", async ({ page, context }) => {
  await page.route("**/api/board", async (route) => {
    if (route.request().method() === "PUT") await route.continue();
    else await route.fallback();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Edit Draft onboarding" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Private unsaved draft");
  await context.clearCookies();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("a failed initial board load offers retry instead of demo data", async ({ page }) => {
  let fail = true;
  await page.route("**/api/board", async (route) => {
    if (fail) await route.fulfill({ status: 503, json: { detail: "Unavailable" } });
    else await route.fallback();
  });
  await page.goto("/");
  await expect(page.locator(".session-retry").getByRole("alert")).toContainText("Couldn't load your board");
  await expect(page.getByRole("article")).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("article")).toHaveCount(6);
});
