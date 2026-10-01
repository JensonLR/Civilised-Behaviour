import { expect, test, type Page } from "@playwright/test";

type Room = { state: { region: string; travelPhase: number; party: string; campaign: string; mounts: { size: number }; players: { forEach(cb: (p: { npc: number; cmd: number }) => void): void } }; send(type: string, msg: unknown): void };
type Hook = { session: { predicted?: unknown; room: Room } };

const hook = (page: Page) => page.evaluate(() => {
  const r = (window as unknown as { __cb: Hook }).__cb.session.room.state;
  const c = JSON.parse(r.campaign) as { purse: number };
  const party = r.party ? (JSON.parse(r.party) as { loadout: Record<string, unknown> }) : undefined;
  return { region: r.region, phase: r.travelPhase, purse: c.purse, loadout: party?.loadout, mounts: r.mounts.size };
});

const send = (page: Page, type: string, msg: unknown) => page.evaluate(([t, m]) => (window as unknown as { __cb: Hook }).__cb.session.room.send(t as string, m), [type, msg] as const);

async function start(page: Page, url: string, errors: string[]): Promise<void> {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url);
  await page.waitForSelector("#name", { timeout: 120_000 });
  await page.fill("#name", "Ada");
  await page.click("#create");
  await page.waitForFunction(() => Boolean((window as unknown as { __cb?: Hook }).__cb?.session.predicted), undefined, { timeout: 120_000 });
}

const noise = (errors: string[]) => errors.filter((e) => !/favicon|Failed to load resource/.test(e));

/** The expedition's prep: the manifest sheet opens at the supply pyramid, commits, and what it ordered comes ashore. */
test("the supply pyramid opens the manifest sheet; the manifest is charged at sailing and a horse stands at the landing", async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  await start(page, "/?gfx=test", errors);
  expect(await hook(page)).toMatchObject({ region: "hollowmere", phase: 0 });
  const purse0 = (await hook(page)).purse;
  expect((await hook(page)).mounts).toBe(3); // the stable: two horses and a wagon, ready from the first tick

  // stand a step east of the supply pyramid, facing it, and press USE
  await send(page, "debug", { cmd: "tp:-4.85:-6.85:1.5708" });
  await page.waitForTimeout(400);
  await page.keyboard.press("KeyE");
  await expect(page.locator("#sheet-loadout")).toBeVisible({ timeout: 30_000 });
  await page.locator('#sheet-loadout [data-k="horses+"]').click();
  await page.locator('#sheet-loadout [data-k="ammo+"]').click();
  await expect.poll(async () => (await hook(page)).loadout, { timeout: 30_000 }).toMatchObject({ horses: 1, ammo: 1 }); // the server took the manifest
  await page.locator('#sheet-loadout [data-k="prepare"]').click();
  await expect(page.locator("#sheet-loadout")).toBeHidden();

  // to the map table, put it to the vote (a lone player sails at once)
  await send(page, "debug", { cmd: "tp:-2.4:-5.8:0" });
  await page.waitForTimeout(400);
  await send(page, "travelPropose", { to: "kessar" });
  await expect.poll(async () => (await hook(page)).region, { timeout: 60_000 }).toBe("kessar");
  await expect.poll(async () => (await hook(page)).phase, { timeout: 120_000 }).toBe(0); // this page built the new shore and said so
  const ashore = await hook(page);
  expect(ashore.purse).toBe(purse0 - 38); // a horse (28) and a crate of rounds (10), charged once, when the ship left
  expect(ashore.mounts).toBe(1); // the horse is at the landing; the stable stayed home
  await expect(page.locator(".objectives")).toContainText("Secure the River Crossing", { timeout: 30_000 }); // the first contract is always the crossing
  expect(noise(errors)).toEqual([]);
});

/** The contracts the campaign can offer: each loads at Kessar (`&scenario=<id>`) and the orders card names it. */
for (const [id, title] of [
  ["hostage_rescue", "The Cartwright's Cage"],
  ["convoy_ambush", "The Syndicate Wagon"],
  ["border_incident", "Marker Stone No. 4"],
] as const) {
  test(`the ${id} contract loads at Kessar and the tracker shows its title`, async ({ page }) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    await start(page, `/?gfx=test&region=kessar&scenario=${id}`, errors);
    expect(await hook(page)).toMatchObject({ region: "kessar", phase: 0 });
    await expect(page.locator(".objectives")).toContainText(title, { timeout: 60_000 });
    expect(noise(errors)).toEqual([]);
  });
}
