import { expect, test } from "./fixtures";

// Browser flow only: backend tests verify Google's signed tokens and single-use state.
test("Google sign-in navigation restores a private session and logout clears the dialog", async ({ page }) => {
  let signedIn = false;
  await page.route("**/api/auth/config", (route) => route.fulfill({ json: { google: true, demo: false } }));
  await page.route("**/api/auth/session", (route) => route.fulfill(signedIn
    ? { json: { username: "Google Person", id: 12 } }
    : { status: 401, json: { detail: "Not authenticated" } }));
  await page.route("**/api/auth/google/start", async (route) => {
    signedIn = true;
    await route.fulfill({ status: 303, headers: { Location: "/" } });
  });
  await page.route("**/api/auth/logout", async (route) => {
    signedIn = false;
    await route.fulfill({ status: 204 });
  });
  await page.goto("/");
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  const google = page.getByRole("link", { name: "Continue with Google" });
  await expect(google).toHaveAttribute("href", "/api/auth/google/start");
  await google.click();
  await expect(page.getByRole("heading", { name: "Project board." })).toBeVisible();
  await expect(page.getByText("Google Person", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("article")).toHaveCount(6);
  await page.getByRole("button", { name: "Board assistant", exact: true }).click();
  await page.getByLabel("Message the assistant").fill("Private Google draft");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(google).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("callback errors explain recovery without showing provider details", async ({ page }) => {
  await page.route("**/api/auth/config", (route) => route.fulfill({ json: { google: true, demo: false } }));
  await page.goto("/?auth_error=invalid");
  await expect(page.locator(".sign-in-card").getByRole("alert")).toContainText("expired or was already used");
  await expect(page.getByRole("link", { name: "Continue with Google" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
});
