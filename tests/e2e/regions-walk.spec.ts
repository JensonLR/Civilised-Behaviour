/**
 * REGIONS-WALK e2e (D-038, docs/_notes/polish2.md section 12 item 5; docs/LEVEL_PLAN.md section 8): in a real browser, against the real server, a scripted bot WALKS (client prediction plus the
 * authoritative step, no teleport between legs) the audited routes of each of the five regions and ends within 1.5 m of each waypoint; then it walks THROUGH the hero interior's door to the middle
 * of the room, and the roof over that room drops while the bot is inside it and comes back when it leaves. No page error is raised anywhere.
 *
 * The routes and the doors come from the same adapters the level audit runs (`LEVEL_ADAPTERS`, packages/shared/src/levelAuditAdapters.ts), so the walk and the audit can never disagree about what
 * a route is. Only the first two routes of a region are walked (the headless renderer is ~10 fps; the audit walks all of them in pure simulation, over many seeds). Waits are polls on state.
 */
import { expect, test, type Page } from "@playwright/test";
import { LEVEL_ADAPTERS } from "../../packages/shared/src/levelAuditAdapters.ts";

const REGIONS = ["hollowmere", "kessar", "highmark", "vesper", "saltmarket"] as const;
type Region = (typeof REGIONS)[number];
type Pt = { x: number; z: number };

type Hook = {
  session: { predicted?: { x: number; z: number }; room: { state: { region: string; seed: number }; send(t: string, m: unknown): void } };
  game: { rig: { yaw: number } };
  controls: { sample: () => { moveF: number; moveR: number; buttons: number } };
  stage: { scene: { getObjectByName(n: string): { visible: boolean } | undefined } };
};
type Bot = { tx: number; tz: number; on: boolean };

/** Installs the bot: while `on`, the view turns to the target and the input is "forward"; the real input path (prediction, the server's step) does the rest. */
const installBot = (page: Page) =>
  page.evaluate(() => {
    const h = (window as unknown as { __cb: Hook }).__cb;
    const bot: Bot = { tx: 0, tz: 0, on: false };
    (window as unknown as { __bot: Bot }).__bot = bot;
    const real = h.controls.sample.bind(h.controls);
    h.controls.sample = () => (bot.on ? { moveF: 127, moveR: 0, buttons: 0 } : real());
    window.setInterval(() => {
      const p = h.session.predicted;
      if (!bot.on || !p) return;
      h.game.rig.yaw = Math.atan2(-(bot.tx - p.x), -(bot.tz - p.z)); // yaw 0 looks down -Z; the shared step is camera-relative
    }, 25);
  });

const where = (page: Page): Promise<Pt> => page.evaluate(() => {
  const p = (window as unknown as { __cb: Hook }).__cb.session.predicted!;
  return { x: p.x, z: p.z };
});
const tp = (page: Page, x: number, z: number, facing: number) =>
  page.evaluate(([a, b, f]) => (window as unknown as { __cb: Hook }).__cb.session.room.send("debug", { cmd: `tp:${a}:${b}:${f}` }), [x, z, facing] as const);

/** Walks to (x, z) and returns when within `tol`; fails when the bot stops making progress for 25 s (a wall, a stuck pocket, a door that is not one). */
async function walkTo(page: Page, x: number, z: number, tol = 1.5, what = ""): Promise<void> {
  await page.evaluate(([a, b]) => {
    const bot = (window as unknown as { __bot: Bot }).__bot;
    bot.tx = a as number;
    bot.tz = b as number;
    bot.on = true;
  }, [x, z] as const);
  let best = Infinity;
  let since = Date.now();
  const end = Date.now() + 180_000;
  for (;;) {
    const p = await where(page);
    const d = Math.hypot(p.x - x, p.z - z);
    if (d <= tol) break;
    if (d < best - 0.3) {
      best = d;
      since = Date.now();
    }
    if (Date.now() - since > 25_000 || Date.now() > end) {
      await page.evaluate(() => ((window as unknown as { __bot: Bot }).__bot.on = false));
      throw new Error(`the bot is stuck ${d.toFixed(1)} m short of ${what || `${x.toFixed(1)},${z.toFixed(1)}`} at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
    }
    await page.waitForTimeout(250);
  }
  await page.evaluate(() => ((window as unknown as { __bot: Bot }).__bot.on = false));
}

const roofVisible = (page: Page, id: string): Promise<boolean | undefined> =>
  page.evaluate((n) => (window as unknown as { __cb: Hook }).__cb.stage.scene.getObjectByName(`roof:${n}`)?.visible, id);

for (const region of REGIONS) {
  test(`${region}: a bot walks the audited routes to within 1.5 m of every waypoint, and the hero interior's roof lifts while it is inside`, async ({ page }) => {
    test.setTimeout(900_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text()));
    await page.addInitScript(() => localStorage.setItem("cb.seenOrientation", "1"));
    await page.goto(region === "hollowmere" ? "/?gfx=test" : `/?gfx=test&region=${region}`);
    await page.waitForSelector("#name", { timeout: 120_000 });
    await page.fill("#name", "Marcher");
    await page.click("#create");
    await page.waitForFunction(() => Boolean((window as unknown as { __cb?: Hook }).__cb?.session.predicted), undefined, { timeout: 180_000 });
    expect(await page.evaluate(() => (window as unknown as { __cb: Hook }).__cb.session.room.state.region)).toBe(region);
    const seed = await page.evaluate(() => (window as unknown as { __cb: Hook }).__cb.session.room.state.seed);
    const audit = LEVEL_ADAPTERS[region as Region](seed);
    await installBot(page);

    // ---- the routes: from the first point of each, walked to the last, waypoint by waypoint -------------------------------------------------
    for (const route of audit.routes.slice(0, 2)) {
      const first = route.points[0]!;
      const next = route.points[1] ?? first;
      await tp(page, first.x, first.z, Math.atan2(-(next.x - first.x), -(next.z - first.z)));
      await expect.poll(async () => { const p = await where(page); return Math.hypot(p.x - first.x, p.z - first.z); }, { timeout: 60_000 }).toBeLessThan(2);
      for (let i = 1; i < route.points.length; i++) {
        const q = route.points[i]!;
        await walkTo(page, q.x, q.z, 1.5, `${region} ${route.id}[${i}]`);
      }
    }

    // ---- the hero interior: the door, the room, the roof ----------------------------------------------------------------------------------
    const door = audit.doors.find((d) => d.room !== undefined);
    expect(door, `${region} declares an enterable interior`).toBeDefined();
    const c = Math.cos(door!.yaw);
    const s = Math.sin(door!.yaw);
    const out = { x: door!.x + c * 5, z: door!.z + s * 5 }; // the outward unit vector is (cos yaw, sin yaw)
    await tp(page, out.x, out.z, Math.atan2(-(door!.x - out.x), -(door!.z - out.z)));
    await expect.poll(async () => { const p = await where(page); return Math.hypot(p.x - out.x, p.z - out.z); }, { timeout: 60_000 }).toBeLessThan(2);
    await expect.poll(() => roofVisible(page, door!.building), { timeout: 30_000, message: `${region}: the roof is on while the bot is outside` }).toBe(true);
    await walkTo(page, door!.x, door!.z, 1.0, `${region} ${door!.id} threshold`);
    await walkTo(page, door!.room!.x, door!.room!.z, 1.5, `${region} ${door!.building} room`);
    await expect.poll(() => roofVisible(page, door!.building), { timeout: 30_000, message: `${region}: the roof over ${door!.building} drops while the bot is inside` }).toBe(false);
    await walkTo(page, out.x, out.z, 1.5, `${region} back out of ${door!.id}`);
    await expect.poll(() => roofVisible(page, door!.building), { timeout: 30_000 }).toBe(true);

    expect(errors).toEqual([]);
  });
}
