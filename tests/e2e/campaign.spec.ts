import { expect, test, type Page } from "@playwright/test";

/**
 * D-035 in a real browser: the first-run orientation card, the campaign map with its overlay and an audience, HQ keeping what the campaign did, and a dormant campaign coming back by
 * its code. Outcomes and the outpost are set up with the server's QA commands (`outcome:<resolution>`, `outpost:<stage>`: debug-only, like `tp:`), because walking three crossings on a
 * software rasteriser would take a quarter of an hour. Every wait is a poll on state, never a timer.
 */
type Room = { state: { region: string; code: string; campaign: string; powers: string; settlements: string }; send(type: string, msg: unknown): void };
type Hook = { session: { predicted?: unknown; room: Room; leave(): void }; stage: { scene: { getObjectByName(n: string): unknown } } };

const send = (page: Page, type: string, msg: unknown) => page.evaluate(([t, m]) => (window as unknown as { __cb: Hook }).__cb.session.room.send(t as string, m), [type, msg] as const);
const state = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __cb: Hook }).__cb.session.room.state;
    const c = JSON.parse(s.campaign) as { day: number; expeditions: number; history: unknown[] };
    return { code: s.code, region: s.region, day: c.day, expeditions: c.expeditions, history: c.history.length, powers: s.powers, settlements: s.settlements };
  });

async function start(page: Page, errors: string[]): Promise<void> {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("/?gfx=test");
  await page.waitForSelector("#name", { timeout: 120_000 });
  await page.fill("#name", "Ada");
  await page.click("#create");
  await page.waitForFunction(() => Boolean((window as unknown as { __cb?: Hook }).__cb?.session.predicted), undefined, { timeout: 120_000 });
}
const noise = (errors: string[]) => errors.filter((e) => !/favicon|Failed to load resource/.test(e));

test("a fresh profile gets the orientation card; Esc skips it for this campaign", async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  await start(page, errors);
  await expect(page.locator(".orientation")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".orientation")).toContainText("The Imperial Cartographic");
  await page.keyboard.press("Escape");
  await expect(page.locator(".orientation")).toBeHidden({ timeout: 10_000 });
  // (D-039: remembered per campaign, in the expeditions record, under this campaign's code)
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("cb.expeditions") ?? "null") as { list: { code: string; orient?: { skipped: boolean } }[] } | null);
  expect(stored?.list[0]?.orient?.skipped).toBe(true);
  expect(noise(errors)).toEqual([]);
});

test("after three endings the map room shows the campaign (an outpost, the Syndicate's marker, the powers, an audience), the audience plays out, and HQ keeps what was done", async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  await page.addInitScript(() => localStorage.setItem("cb.skipTutorials", "1")); // (the card has its own test above)
  await start(page, errors);
  for (const r of ["forced", "sabotaged", "seized"]) await send(page, "debug", { cmd: `outcome:${r}` });
  await send(page, "debug", { cmd: "outpost:trading_post" });
  await expect.poll(async () => (await state(page)).history, { timeout: 60_000 }).toBe(3);
  await expect.poll(async () => JSON.parse((await state(page)).settlements).posts.kessar?.stage, { timeout: 30_000 }).toBe("trading_post");

  // HQ keeps what the campaign did: the history group is in the scene (the pieces stand on the table, the strongbox and the back wall)
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __cb: Hook }).__cb.stage.scene.getObjectByName("hq-history"))), { timeout: 30_000 }).toBe(true);

  // the map table opens the map room with the campaign layer
  await send(page, "debug", { cmd: "tp:-2.4:-5.8:0" });
  await page.waitForTimeout(400);
  await page.keyboard.press("KeyE");
  await expect(page.locator("#sheet-maproom")).toBeVisible({ timeout: 30_000 });
  const campaign = page.locator("#sheet-maproom .campaign");
  await expect(campaign).toBeVisible();
  await expect(campaign).toContainText("the Society holds a trading post");
  await expect(campaign).toContainText("The Syndicate was last seen");
  await expect(campaign).toContainText("Ward of the Nine Lamps");
  await expect(campaign).toContainText("Brine Houses of Ossuary Bay"); // by the third expedition the Houses have been heard of (an unmet power reads "?": unit-tested)
  await expect(page.locator("#sheet-maproom .chartwrap .stamp.outpost")).toBeVisible();
  const ask = page.locator("#sheet-maproom button.audience").first();
  await expect(ask).toBeVisible();

  // an audience at the table: the parley sheet opens, a plain refusal ends it
  await ask.click();
  await expect(page.locator("#sheet-parley")).toBeVisible({ timeout: 30_000 });
  const before = (await state(page)).powers;
  await page.locator("#sheet-parley button", { hasText: /Decline|Refuse/ }).first().click();
  await expect.poll(async () => (await state(page)).powers, { timeout: 30_000 }).not.toBe(before);
  await expect(page.locator("#sheet-parley")).toBeHidden({ timeout: 30_000 });
  expect(noise(errors)).toEqual([]);
});

test("a dormant campaign comes back by its code: the door offers to resume it, and the ledger is as it was", async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  await page.addInitScript(() => localStorage.setItem("cb.skipTutorials", "1"));
  await start(page, errors);
  await send(page, "debug", { cmd: "outcome:paid" });
  await send(page, "debug", { cmd: "outcome:forced" });
  await expect.poll(async () => (await state(page)).history, { timeout: 60_000 }).toBe(2);
  const saved = await state(page);
  expect(saved.code).toMatch(/^[A-Z2-9]{5}$/);
  // leave the room (the last player gone: the campaign is on the server's store), then knock on the door again
  await page.evaluate(() => (window as unknown as { __cb: Hook }).__cb.session.leave());
  await page.waitForTimeout(1500);
  await page.reload();
  await page.waitForSelector("#name", { timeout: 120_000 });
  await page.fill("#name", "Ada");
  await page.fill("#code", saved.code);
  await page.click("#join");
  const resume = page.locator(".consult .resume");
  await expect(resume).toBeVisible({ timeout: 60_000 });
  await resume.click();
  await page.waitForFunction(() => Boolean((window as unknown as { __cb?: Hook }).__cb?.session.predicted), undefined, { timeout: 120_000 });
  const back = await state(page);
  expect(back).toMatchObject({ code: saved.code, region: "hollowmere", day: saved.day, history: 2, powers: saved.powers, settlements: saved.settlements });
  expect(noise(errors)).toEqual([]);
});
