import { expect, test } from "@playwright/test";

type Row = { x: number; z: number; weapon: number };
type Hook = {
  session: { room: { state: { players: { get(id: string): Row | undefined } }; send(type: string, msg: unknown): void } };
  game: { debris: { count: number } };
};

/**
 * D-104 in one real browser: a blow to a sentry's arm (the QA command `react:`, the same Casualties path a shot takes) knocks his rifle away. The state shows his fists
 * up, and this page throws the rifle he held to the ground as debris that stays (a latched fact, not a timing: no assertion here waits on a frame rate).
 */
test("an arm shot knocks a sentry's rifle out of his hand, and the page throws it to the ground", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("/?gfx=test&region=kessar");
  await page.waitForSelector("#name", { timeout: 120_000 });
  await page.fill("#name", "Ada");
  await page.click("#create");
  await page.waitForFunction(() => Boolean((window as unknown as { __cb?: { session: { predicted?: unknown } } }).__cb?.session.predicted), undefined, { timeout: 120_000 });
  await page.waitForFunction(() => Boolean((window as unknown as { __cb: Hook }).__cb.session.room.state.players.get("npc:sentry-3")?.weapon), undefined, { timeout: 30_000 });
  const before = await page.evaluate(() => {
    const h = (window as unknown as { __cb: Hook }).__cb;
    const s = h.session.room.state.players.get("npc:sentry-3")!;
    h.session.room.send("debug", { cmd: `tp:${s.x + 2.2}:${s.z + 5}:0` });
    return { weapon: s.weapon, debris: h.game.debris.count };
  });
  expect(before.weapon).not.toBe(7); // (a firearm in hand, not fists: weaponToWire(FISTS) is 7)
  await page.evaluate(() => (window as unknown as { __cb: Hook }).__cb.session.room.send("debug", { cmd: "react:3:26:sentry-3" }));
  await expect.poll(() => page.evaluate(() => (window as unknown as { __cb: Hook }).__cb.session.room.state.players.get("npc:sentry-3")!.weapon), { timeout: 30_000 }).toBe(7);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __cb: Hook }).__cb.game.debris.count), { timeout: 60_000 }).toBe(before.debris + 1);
  expect(errors.filter((e) => !/favicon|Failed to load resource/.test(e))).toEqual([]);
});
