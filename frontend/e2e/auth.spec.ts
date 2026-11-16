import { expect, test } from "./fixtures";

async function signIn(page: import("@playwright/test").Page) {
  await page.getByLabel("Username", { exact: true }).fill("user");
  await page.getByLabel("Password", { exact: true }).fill("password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Project board." })).toBeVisible();
}

test("login is required, errors are clear, and the session survives reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.getByLabel("Username", { exact: true }).fill("user");
  await page.getByLabel("Password", { exact: true }).fill("wrong");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("form", { name: "Sign in" }).getByRole("alert")).toContainText("Username or password is incorrect.");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  await signIn(page);
  await expect(page.getByRole("article")).toHaveCount(6);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Project board." })).toBeVisible();
  const cookies = await page.context().cookies();
  const session = cookies.find((cookie) => cookie.name === "kanban_session")!;
  expect(session.httpOnly).toBe(true);
  expect(session.sameSite).toBe("Strict");
  expect(await page.evaluate(() => document.cookie)).not.toContain("kanban_session");
});

test("logout clears private UI while saved board edits survive sign-in", async ({ page }) => {
  await page.goto("/");
  await signIn(page);
  await page.getByRole("textbox", { name: "Rename Backlog" }).fill("Private draft");
  await page.getByRole("textbox", { name: "Rename Backlog" }).press("Enter");
  await expect(page.getByRole("region", { name: "Private draft column" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  expect((await page.request.get("/api/auth/session")).status()).toBe(401);
  expect((await page.context().cookies()).some((cookie) => cookie.name === "kanban_session")).toBe(false);
  await page.goto("/api/health");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.reload();
  await signIn(page);
  await expect(page.getByRole("textbox", { name: "Rename Private draft" })).toHaveValue("Private draft");
});

test("a cleared or tampered session cannot restore the board", async ({ page, context }) => {
  await page.goto("/");
  await signIn(page);
  await context.clearCookies();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await context.addCookies([{ name: "kanban_session", value: "tampered", url: new URL(page.url()).origin }]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("login service failure shows a retryable error without revealing the board", async ({ page }) => {
  await page.route("**/api/auth/login", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"Unavailable"}' }));
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("user");
  await page.getByLabel("Password", { exact: true }).fill("password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("form", { name: "Sign in" }).getByRole("alert")).toContainText("Couldn't sign in.");
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.unroute("**/api/auth/login");
  await signIn(page);
});

test("sign-in layout fits the viewport and works with the keyboard", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.getByLabel("Username", { exact: true }).focus();
  await page.keyboard.type("user");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
  await page.keyboard.type("password");
  await page.screenshot({ path: testInfo.outputPath("sign-in.png"), fullPage: true });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
});
