import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { BoardState } from "../lib/board-api";

test.skip(process.env.KANBAN_SHARING_E2E !== "1" || process.env.PLAYWRIGHT_BASE_URL !== "http://localhost:8003", "Requires the disposable Part 20 browser fixture on localhost:8003");
type Sessions = Record<string, { id: number; cookie: Parameters<BrowserContext["addCookies"]>[0][number] }>;
function sessions(): Sessions { return JSON.parse(readFileSync("../.vercel/part20-sessions.json", "utf8")); }
async function invite(owner: Page, email: string) {
  await owner.getByLabel("Google email to invite").fill(email);
  await owner.getByRole("button", { name: "Create invitation", exact: true }).click();
  await expect(owner.getByLabel("Google email to invite")).toHaveValue("");
  const field = owner.getByLabel("Invitation link", { exact: true });
  await expect(field).toBeVisible();
  await expect(owner.getByRole("dialog").getByRole("status")).toContainText("Invitation created");
  return field.inputValue();
}
async function accept(member: Page, link: string, name: string) {
  await member.goto(link);
  await expect(member.getByRole("button", { name: "Accept invitation" })).toBeVisible();
  await expect(member.getByRole("region", { name: "Kanban columns" })).toHaveCount(0);
  await member.getByRole("button", { name: "Accept invitation" }).click();
  await expect(member.getByRole("heading", { name: name + ".", exact: true })).toBeVisible();
  await expect(member.getByText("Shared with you", { exact: true })).toBeVisible();
}
async function setup(owner: Page, context: BrowserContext, name: string) {
  await context.addCookies([sessions().owner.cookie]);
  const response = await owner.request.post("/api/boards", { data: { name } });
  expect(response.status()).toBe(201);
  const board = await response.json();
  await owner.goto(`/?board=${board.id}`);
  await owner.getByRole("button", { name: "Share board" }).click();
  await expect(owner.getByLabel("Google email to invite")).toBeFocused();
  return board.id as number;
}

test("owner invites two people; saved cards/columns are shared, chat stays private, and links can be revoked", async ({ page, context, browser, baseURL }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const name = `Collaboration ${testInfo.project.name} ${Date.now()}`;
  const boardId = await setup(page, context, name);
  const first = await browser.newContext({ baseURL, viewport: page.viewportSize(), extraHTTPHeaders: { Origin: baseURL! } });
  const second = await browser.newContext({ baseURL, viewport: page.viewportSize(), extraHTTPHeaders: { Origin: baseURL! } });
  try {
    await first.addCookies([sessions().first.cookie]); await second.addCookies([sessions().second.cookie]);
    const member = await first.newPage(), other = await second.newPage();
    const firstLink = await invite(page, "first@example.test");
    await page.getByRole("button", { name: "Copy link" }).click();
    await expect(page.getByRole("dialog").getByRole("status")).toContainText(/copied|copy it manually/);
    await accept(member, firstLink, name);
    await expect(member.getByRole("button", { name: "Share board" })).toHaveCount(0);
    await expect(member.getByRole("button", { name: "Rename board" })).toHaveCount(0);
    const secondLink = await invite(page, "second@example.test");
    await accept(other, secondLink, name);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByRole("button", { name: "Share board" })).toBeFocused();
    await member.getByRole("button", { name: "Add card to Backlog" }).click();
    await member.getByLabel("Title", { exact: true }).fill("A shared task");
    await member.getByRole("button", { name: "Create card", exact: true }).click();
    await member.getByRole("textbox", { name: "Rename Review", exact: true }).fill("Team review");
    await member.getByRole("textbox", { name: "Rename Review", exact: true }).press("Enter");
    await expect(member.getByRole("textbox", { name: "Rename Team review" })).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("article", { name: "A shared task" })).toBeVisible();
    await other.reload();
    await expect(other.getByRole("region", { name: "Team review column" })).toBeVisible();
    await expect(other.getByRole("article", { name: "A shared task" })).toBeVisible();
    // Mock provider result only; persist its proposed board through the real revisioned API.
    await member.route(`**/api/boards/${boardId}/chat`, async route => {
      const body = route.request().postDataJSON();
      expect(body.history).toEqual([]);
      const state: BoardState = await (await member.request.get(`/api/boards/${boardId}`)).json();
      state.board.columns[1].cards.push({ id: `ai-${boardId}`, title: "Shared assistant task", details: "Synthetic provider response" });
      const saved = await member.request.put(`/api/boards/${boardId}`, { data: state });
      expect(saved.status()).toBe(200);
      await route.fulfill({ json: { reply: "Private assistant reply", updated: true, state: await saved.json() } });
    });
    await member.getByRole("button", { name: "Board assistant", exact: true }).click();
    await member.getByLabel("Message the assistant").fill("Create a task");
    await member.getByRole("button", { name: "Send message" }).click();
    await expect(member.getByRole("log")).toContainText("Private assistant reply");
    await other.reload();
    await expect(other.getByRole("article", { name: "Shared assistant task" })).toBeVisible();
    await other.getByRole("button", { name: "Board assistant", exact: true }).click();
    await expect(other.getByRole("log")).not.toContainText("Private assistant reply");
    await expect(other.getByLabel("Message the assistant")).toHaveValue("");
    await page.getByRole("button", { name: "Share board" }).click();
    const revoked = await invite(page, "third@example.test");
    const pendingRow = page.getByRole("listitem").filter({ hasText: "third@example.test" });
    await pendingRow.getByRole("button", { name: "Revoke invitation" }).click();
    await expect(pendingRow).toContainText("revoked");
    await member.goto(revoked);
    await expect(member.getByRole("alert").filter({ hasText: "expired, been revoked, or already been used" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Share board" })).toBeFocused();
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally { await first.close(); await second.close(); }
});

test("a member keeps conflicted drafts and loses board/chat access during a pending AI request", async ({ page, context, browser, baseURL }, testInfo) => {
  const name = `Removal ${testInfo.project.name} ${Date.now()}`;
  const boardId = await setup(page, context, name);
  const peer = await browser.newContext({ baseURL, viewport: page.viewportSize(), extraHTTPHeaders: { Origin: baseURL! } });
  try {
    await peer.addCookies([sessions().first.cookie]); const member = await peer.newPage();
    await accept(member, await invite(page, "first@example.test"), name);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await member.getByRole("button", { name: "Add card to Backlog" }).click();
    await member.getByLabel("Title", { exact: true }).fill("Keep this draft");
    const state: BoardState = await (await page.request.get(`/api/boards/${boardId}`)).json();
    state.board.columns[0].cards.push({ id: `winner-${boardId}`, title: "Owner's winning card", details: "Keep" });
    expect((await page.request.put(`/api/boards/${boardId}`, { data: state })).status()).toBe(200);
    await member.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(member.getByLabel("Title", { exact: true })).toHaveValue("Keep this draft");
    await member.getByRole("button", { name: "Create card", exact: true }).click();
    await expect(member.getByRole("dialog").getByRole("alert")).toContainText("edit was not saved");
    await expect(member.getByLabel("Title", { exact: true })).toHaveValue("Keep this draft");
    await member.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(member.getByRole("article", { name: "Owner's winning card" })).toBeVisible();
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { started = resolve; });
    await member.route(`**/api/boards/${boardId}/chat`, async route => { started(); await waiting; await route.continue(); });
    await member.getByRole("button", { name: "Board assistant", exact: true }).click();
    await member.getByLabel("Message the assistant").fill("Private pending draft");
    await member.getByRole("button", { name: "Send message" }).click(); await ready;
    await page.getByRole("button", { name: "Share board" }).click();
    const row = page.getByRole("listitem").filter({ hasText: "first@example.test" }).filter({ has: page.getByRole("button", { name: "Remove member" }) });
    await row.getByRole("button", { name: "Remove member" }).click();
    await expect(page.getByRole("button", { name: "Confirm removal" })).toBeVisible();
    expect((await member.request.get(`/api/boards/${boardId}`)).status()).toBe(200);
    await page.getByRole("button", { name: "Confirm removal" }).click();
    await expect(page.getByText("Member removed.", { exact: true })).toBeVisible();
    release();
    await expect(member.getByRole("alert").filter({ hasText: "Your access to this board has ended" })).toBeVisible();
    await expect(member.getByRole("dialog")).toHaveCount(0);
    await expect(member.getByRole("heading", { name: "My board.", exact: true })).toBeVisible();
    expect((await member.request.get(`/api/boards/${boardId}`)).status()).toBe(404);
    await accept(member, await invite(page, "first@example.test"), name);
    await member.getByRole("button", { name: "Board assistant", exact: true }).click();
    await expect(member.getByLabel("Message the assistant")).toHaveValue("");
    await expect(member.getByRole("log")).not.toContainText("Private pending draft");
  } finally { await peer.close(); }
});
