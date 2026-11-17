import { expect, test } from "@playwright/test";
import type { BoardState } from "../lib/board-api";

// Run explicitly against the disposable Part 10 container, never the user's board.
test("live AI answers and creates, edits, and moves cards through the sidebar", async ({ page, baseURL }, testInfo) => {
  test.skip(process.env.KANBAN_LIVE_AI !== "1" || testInfo.project.name !== "desktop", "Explicit live-provider check on a disposable database only.");
  expect(baseURL).toBe("http://localhost:8001");
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("user");
  await page.getByLabel("Password", { exact: true }).fill("password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const input = page.getByLabel("Message the assistant");
  await input.fill("How many cards are on this board? Answer with the count. Do not change the board.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Answer received. Board unchanged.")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("log")).toContainText(/6|six/i);
  const initial = await (await page.request.get("/api/board")).json() as BoardState;
  expect(initial.revision).toBe(0);
  await input.fill('Create a card with ID "live-chat-check", title "Live release checklist", and details "Synthetic browser check" in todo. Edit card-1 title to "Live onboarding updated", preserving its details. Move card-3 from todo to done, appending it. Preserve all other cards and columns exactly.');
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Board updated and saved.")).toBeVisible({ timeout: 45_000 });
  const expected = structuredClone(initial);
  expected.revision = 1;
  expected.board.columns[0].cards.find((card) => card.id === "card-1")!.title = "Live onboarding updated";
  const moved = expected.board.columns[1].cards.find((card) => card.id === "card-3")!;
  expected.board.columns[1].cards = expected.board.columns[1].cards.filter((card) => card.id !== "card-3");
  expected.board.columns[4].cards.push(moved);
  expected.board.columns[1].cards.push({ id: "live-chat-check", title: "Live release checklist", details: "Synthetic browser check" });
  expect(await (await page.request.get("/api/board")).json()).toEqual(expected);
  await expect(page.getByRole("article", { name: "Live release checklist", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("article", { name: "Live onboarding updated", exact: true })).toBeVisible();
  await expect(page.getByRole("log")).not.toContainText("Synthetic browser check");
});
