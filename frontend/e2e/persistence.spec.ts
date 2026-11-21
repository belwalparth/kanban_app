import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import type { BoardState } from "../lib/board-api";

test("real API saves card creation, editing, movement, deletion, and reload/login persistence", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One real-data check; responsive interactions are covered separately.");
  const title = `Persistence check ${randomUUID()}`;
  await page.request.post("/api/auth/login", { data: { username: "user", password: "password" } });
  try {
    await page.goto("/");
    await page.locator('[data-column="backlog"]').getByRole("button", { name: /Add card/ }).click();
    await page.getByLabel("Title", { exact: true }).fill(title);
    await page.getByLabel("Details", { exact: true }).fill("First saved details");
    await page.getByRole("button", { name: "Create card", exact: true }).click();
    await expect(page.getByRole("article", { name: title, exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: `Edit ${title}`, exact: true }).click();
    await page.getByLabel("Title", { exact: true }).fill(`${title} edited`);
    await page.getByLabel("Details", { exact: true }).fill("Persisted through FastAPI and SQLite");
    await page.getByLabel("Column", { exact: true }).selectOption("done");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator('[data-column="done"]').getByRole("article", { name: `${title} edited`, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByLabel("Username", { exact: true }).fill("user");
    await page.getByLabel("Password", { exact: true }).fill("password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("article", { name: `${title} edited`, exact: true })).toContainText("Persisted through FastAPI and SQLite");
    await page.getByRole("button", { name: `Delete ${title} edited`, exact: true }).click();
    await expect(page.getByRole("article", { name: `${title} edited`, exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("progressbar", { name: "Project progress" })).toBeVisible();
    await expect(page.getByRole("article", { name: `${title} edited`, exact: true })).toHaveCount(0);
  } finally {
    await page.request.post("/api/auth/login", { data: { username: "user", password: "password" } });
    const state = await (await page.request.get("/api/board")).json() as BoardState;
    let removed = false;
    for (const column of state.board.columns) {
      const remaining = column.cards.filter((card) => !card.title.startsWith(title));
      removed ||= remaining.length !== column.cards.length;
      column.cards = remaining;
    }
    if (removed) expect((await page.request.put("/api/board", { data: state })).ok()).toBe(true);
  }
});
