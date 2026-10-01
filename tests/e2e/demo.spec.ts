import { expect, test, type Page } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The bounded web demo (D-036), against the demo project's own client (:5175, `VITE_DEMO=1`) and server (:2568, `DEMO_MODE=1`, a 20 s session, a FILE store in test-results/demo-saves).
 * The SERVER enforces; the client only shows. Waits are polls on state, never timers.
 */
type Room = { state: { region: string; travelPhase: number }; send(type: string, msg: unknown): void };
type Hook = { session: { room: Room } };

const SAVES = resolve("test-results/demo-saves");
const send = (page: Page, type: string, msg: unknown) => page.evaluate(([t, m]) => (window as unknown as { __cb: Hook }).__cb.session.room.send(t as string, m), [type, msg] as const);
const noise = (errors: string[]) => errors.filter((e) => !/favicon|Failed to load resource|Left room|Failed to execute 'send'/.test(e));

test("the demo shows its licence tag, refuses a sailing to Highmark, saves nothing, and ends on the wish-list card", async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.addInitScript(() => localStorage.setItem("cb.seenOrientation", "1"));
  await page.goto("/?gfx=test");
  await page.waitForSelector("#name", { timeout: 120_000 });
  await page.fill("#name", "Ada");
  await page.click("#create");
  await page.waitForFunction(() => Boolean((window as unknown as { __cb?: { session: { predicted?: unknown } } }).__cb?.session.predicted), undefined, { timeout: 120_000 });

  // the licence tag counts down on the client's own clock (the server's warnings only correct it)
  await expect(page.locator(".demo-banner")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".demo-banner")).toContainText("Demonstration licence");

  // the region gate lives on the server: a proposal to Highmark (a real, reachable region) from the map table is ignored
  await send(page, "debug", { cmd: "tp:-2.4:-5.8:0" });
  await page.waitForTimeout(400);
  await send(page, "travelPropose", { to: "highmark" });
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => (window as unknown as { __cb: Hook }).__cb.session.room.state.travelPhase)).toBe(0);

  // the door never offers to resume in a demo: a join that finds nothing has no "resume" button (checked after the end, on the door)
  // the server closes the room at the end of the session: the wish-list card (no store URL is configured here: "coming soon", no link)
  await expect(page.locator("#sheet-wishlist")).toBeVisible({ timeout: 120_000 });
  await expect(page.locator("#sheet-wishlist")).toContainText("The Licence Has Expired");
  await expect(page.locator("#sheet-wishlist a, #sheet-wishlist .go")).toHaveCount(0);

  // nothing was saved: the demo server runs a FILE store, and the directory has no record in it
  const files = existsSync(SAVES) ? readdirSync(SAVES, { recursive: true }).map(String) : [];
  expect(files.filter((f) => /\.json$/.test(f))).toEqual([]);

  // Escape returns to the front door
  await page.keyboard.press("Escape");
  await page.waitForSelector("#name", { timeout: 120_000 });
  expect(noise(errors)).toEqual([]);
});
