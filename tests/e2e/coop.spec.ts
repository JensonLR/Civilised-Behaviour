import { expect, test, type Page } from "@playwright/test";

type Hook = {
  session: {
    code: string;
    sessionId: string;
    predicted?: { x: number; y: number; z: number };
    room: { state: { players: { size: number } } };
  };
  game: { overlay: { snapshot(): string } };
};

const hook = (page: Page) => page.evaluate(() => {
  const h = (window as unknown as { __cb: Hook }).__cb;
  const p = h.session.predicted;
  return { code: h.session.code, id: h.session.sessionId, players: h.session.room.state.players.size, pos: p ? { x: p.x, y: p.y, z: p.z } : null };
});

// Pages from `browser.newContext()` are not closed when a test ends, and every one keeps rendering a world on the software rasteriser.
// Left open they starve the later specs of the run (starts that take minutes, then a 120 s timeout), so each test closes what it opened.
test.afterEach(async ({ browser }) => {
  for (const c of browser.contexts()) await c.close();
});

async function start(page: Page, name: string, code?: string, extra = "") {
  await page.goto(code ? `/?join=${code}&gfx=test${extra}` : `/?gfx=test${extra}`); // test preset: no shadows, sky clouds, ground cover or people, half-size frame buffer (see PRESETS.test): ~4x the frame rate on the software rasteriser
  await page.waitForSelector("#name", { timeout: 120_000 }); // the game boots via dynamic import after `load` (2-3 s idle; software GL under load can take much longer)
  await page.fill("#name", name);
  await page.click(code ? "#join" : "#create");
  await page.waitForFunction(() => Boolean((window as unknown as { __cb?: unknown }).__cb));
  await page.waitForFunction(() => {
    const h = (window as unknown as { __cb: Hook }).__cb;
    return h.session.predicted !== undefined;
  });
}

test("two players share a campaign, move with prediction, see each other", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const errors: string[] = [];
  a.on("pageerror", (e) => errors.push(e.message));
  a.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await start(a, "Ada");
  const { code } = await hook(a);
  expect(code).toMatch(/^[A-Z2-9]{5}$/);
  // Regression: the HUD once rendered "undefined" because it read the code before first state sync.
  await expect(a.locator(".codebar b")).toHaveText(code);

  const b = await (await browser.newContext()).newPage();
  b.on("pageerror", (e) => errors.push(e.message));
  await start(b, "Bertram", code);
  await expect.poll(async () => (await hook(a)).players, { timeout: 30_000 }).toBe(2);
  // D-101: the welcome card is for the expedition you start: Ada, who founded it, is shown it; Bertram, who joined it running, is not
  await expect(a.locator("#hud .orientation")).toBeVisible({ timeout: 30_000 });
  await expect(b.locator("#hud .orientation")).toBeHidden();

  // Player A holds W until they have travelled 3 m. Polling the displacement (not the clock)
  // keeps this valid on software-rendered CI where frames take ~100 ms.
  const before = (await hook(a)).pos!;
  await a.locator("#stage").focus();
  await a.keyboard.down("KeyW");
  await expect
    .poll(async () => {
      const p = (await hook(a)).pos!;
      return Math.hypot(p.x - before.x, p.z - before.z);
    }, { timeout: 20_000 })
    .toBeGreaterThan(3);
  await a.keyboard.up("KeyW");

  // B's view of A converges on A's own (predicted, reconciled) position once A has stopped. Polled, not read after a fixed wait: on a
  // starved CI runner B's software-rendered frames can hold already-sent patches for over a second (one run read B's copy 4.5 m behind
  // after the old 800 ms sleep while its twin job passed), and a real divergence never converges, so the poll still catches one.
  const idA = (await hook(a)).id;
  const gap = async (): Promise<number> => {
    const after = (await hook(a)).pos!;
    const seenByB = await b.evaluate((id) => {
      const h = (window as unknown as { __cb: Hook & { session: { room: { state: { players: Map<string, { x: number; z: number }> } } } } }).__cb;
      const p = h.session.room.state.players.get(id);
      return p ? { x: p.x, z: p.z } : null;
    }, idA);
    return seenByB ? Math.hypot(seenByB.x - after.x, seenByB.z - after.z) : Infinity;
  };
  await expect.poll(gap, { timeout: 20_000 }).toBeLessThan(0.75);

  await a.screenshot({ path: "test-results/coop-a.png" });
  await b.screenshot({ path: "test-results/coop-b.png" });
  expect(errors.filter((e) => !/favicon|Failed to load resource/.test(e))).toEqual([]);
});

test("joining a bad code shows a friendly error", async ({ page }) => {
  await page.goto("/");
  await page.fill("#name", "Nobody");
  await page.fill("#code", "ZZZZZ");
  await page.click("#join");
  // the failure now shows on the "The Society regrets..." card
  await expect(page.locator("#consult-step")).toContainText(/No campaign/);
});

test("a player walks up to a prop, picks it up, and throws it (real browser, server-authoritative)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page, "Porter");
  const propsHeld = () =>
    page.evaluate(() => {
      const h = (window as unknown as { __cb: { session: { sessionId: string; room: { state: { props: Map<string, { holder: string }> } } } } }).__cb;
      return [...h.session.room.state.props.values()].filter((p) => p.holder === h.session.sessionId).length;
    });

  await page.evaluate(() => (window as unknown as { __cb: { session: { room: { send(t: string, m: unknown): void } } } }).__cb.session.room.send("debug", { cmd: "nearProp" }));
  await expect(page.locator(".prompt")).toContainText("Pick up", { timeout: 20_000 });
  await page.screenshot({ path: "test-results/prop-prompt.png" });

  await page.locator("#stage").focus();
  await page.keyboard.press("KeyE"); // a very short tap must still register (input latching)
  await expect.poll(propsHeld, { timeout: 20_000 }).toBe(1);
  await expect(page.locator(".prompt")).toContainText("Throw");
  await page.screenshot({ path: "test-results/prop-carried.png" });

  await page.keyboard.press("KeyG");
  await expect.poll(propsHeld, { timeout: 20_000 }).toBe(0);
  expect(errors).toEqual([]);
});

test("character creator: customise, join, and each player sees the other's look", async ({ browser }) => {
  const errors: string[] = [];
  const pageWith = async (name: string, code?: string) => {
    const page = await (await browser.newContext()).newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(code ? `/?join=${code}&gfx=test` : "/?gfx=test");
    await page.waitForSelector("#name"); // the game boots via dynamic import after `load`
    return page;
  };
  // D-098: a narrow door (this viewport) shows one panel at a time, the creator behind "Appearance" and back by Done; a wide one shows both
  const dress = async (p: Page) => {
    if (await p.locator("#dress").isVisible()) await p.click("#dress");
    await p.waitForSelector(".creator .fields");
  };
  const undress = async (p: Page) => {
    if (await p.locator(".creator-done").isVisible()) await p.click(".creator-done");
    await p.waitForSelector("#name", { state: "visible" });
  };
  const storedLook = (p: Page) => p.evaluate(() => localStorage.getItem("cb.look"));

  const a = await pageWith("Ada");
  await dress(a);
  const initialLook = await storedLook(a);
  expect(initialLook).toMatch(/^[A-Za-z0-9_-]{40,120}$/);

  // Controls change the stored (and previewed) look.
  await a.click('[data-act="dice"]');
  const dicedLook = await storedLook(a);
  expect(dicedLook).not.toBe(initialLook);
  await a.click('.tabs button[data-tab="face"]');
  const noseSelect = a.locator('.creator select').first();
  const before = await storedLook(a);
  const optionCount = await noseSelect.locator("option").count();
  await noseSelect.selectOption(String((Number(await noseSelect.inputValue()) + 1) % optionCount));
  expect(await storedLook(a)).not.toBe(before);
  await a.click('.tabs button[data-tab="colour"]');
  await a.locator(".swatch").nth(2).click();
  const finalLookA = (await storedLook(a))!;
  await a.screenshot({ path: "test-results/creator.png" });
  await undress(a);

  await a.fill("#name", "Ada");
  await a.click("#create");
  await a.waitForFunction(() => Boolean((window as unknown as { __cb?: { session?: { predicted?: unknown } } }).__cb?.session?.predicted));
  const code = await a.locator(".codebar b").textContent();

  const b = await pageWith("Bertram", code!);
  await dress(b);
  await b.click('[data-act="dice"]');
  const finalLookB = (await storedLook(b))!;
  expect(finalLookB).not.toBe(finalLookA);
  await undress(b);
  await b.fill("#name", "Bertram");
  await b.click("#join");
  await b.waitForFunction(() => Boolean((window as unknown as { __cb?: { session?: { predicted?: unknown } } }).__cb?.session?.predicted));

  const looksSeenBy = (p: Page) =>
    p.evaluate(() => {
      const h = (window as unknown as { __cb: { session: { room: { state: { players: Map<string, { name: string; look: string }> } } } } }).__cb;
      return Object.fromEntries([...h.session.room.state.players.values()].map((pl) => [pl.name, pl.look]));
    });
  await expect.poll(async () => Object.keys(await looksSeenBy(a)).length, { timeout: 30_000 }).toBe(2);
  await expect.poll(async () => Object.keys(await looksSeenBy(b)).length, { timeout: 30_000 }).toBe(2);
  for (const seen of [await looksSeenBy(a), await looksSeenBy(b)]) {
    expect(seen["Ada"]).toBe(finalLookA); // server canonicalised form equals what was submitted (no history to strip)
    expect(seen["Bertram"]).toBe(finalLookB);
  }
  await b.locator("#stage").focus();
  await b.screenshot({ path: "test-results/two-characters.png" });
  expect(errors).toEqual([]);
});

test("a downed player is revived by a teammate holding interact, then dragged to safety (two real browsers)", async ({ browser }) => {
  const errors: string[] = [];
  const mk = async () => {
    const p = await (await browser.newContext()).newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    return p;
  };
  const send = (p: Page, cmd: string) =>
    p.evaluate((c) => (window as unknown as { __cb: { session: { room: { send(t: string, m: unknown): void } } } }).__cb.session.room.send("debug", { cmd: c }), cmd);
  const me = (p: Page) =>
    p.evaluate(() => {
      const h = (window as unknown as { __cb: { session: { sessionId: string; room: { state: { players: Map<string, { flags: number; health: number; x: number; z: number; dragger: string }> } } } } }).__cb;
      const s = h.session.room.state.players.get(h.session.sessionId)!;
      return { flags: s.flags, health: s.health, x: s.x, z: s.z, dragger: s.dragger };
    });
  const DOWNED = 16;
  const DRAGGED = 256;

  const a = await mk();
  await start(a, "Wounded");
  const { code } = await hook(a);
  const b = await mk();
  await start(b, "Medic", code);
  await expect.poll(async () => (await hook(a)).players, { timeout: 30_000 }).toBe(2);

  // A goes down: banner + status appear for A, and B sees the marker on A's nametag.
  await send(a, "down");
  await expect(a.locator(".downed")).toContainText("You are down", { timeout: 20_000 });
  await expect.poll(async () => (await me(a)).flags & DOWNED, { timeout: 20_000 }).toBe(DOWNED);
  expect((await me(a)).health).toBe(0);
  await a.screenshot({ path: "test-results/downed.png" });

  // B stands beside A, sees the prompt, holds E: progress bar climbs, A is revived with partial health.
  await send(b, "nearDowned");
  await expect(b.locator(".prompt")).toContainText("Revive", { timeout: 20_000 });
  await b.locator("#stage").focus();
  await b.keyboard.down("KeyE");
  await expect(b.locator(".progress")).toBeVisible({ timeout: 20_000 });
  await b.screenshot({ path: "test-results/reviving.png" });
  await expect.poll(async () => (await me(a)).flags & DOWNED, { timeout: 30_000 }).toBe(0);
  await b.keyboard.up("KeyE");
  expect((await me(a)).health).toBe(35);
  await expect(a.locator(".downed")).toBeHidden({ timeout: 20_000 });

  // Drag: A down again, B grabs (F) and walks north (W); A's body follows.
  await send(a, "down");
  await expect.poll(async () => (await me(a)).flags & DOWNED, { timeout: 20_000 }).toBe(DOWNED);
  await send(b, "nearDowned");
  await expect(b.locator(".prompt")).toContainText("Drag", { timeout: 20_000 });
  await b.keyboard.press("KeyF");
  await expect.poll(async () => (await me(a)).flags & DRAGGED, { timeout: 20_000 }).toBe(DRAGGED);
  const before = await me(a);
  await b.keyboard.down("KeyW");
  await expect
    .poll(async () => {
      const now = await me(a);
      return Math.hypot(now.x - before.x, now.z - before.z);
    }, { timeout: 40_000 })
    .toBeGreaterThan(2);
  await b.screenshot({ path: "test-results/dragging.png" });
  await b.keyboard.up("KeyW");
  await b.keyboard.press("KeyF"); // let go
  await expect.poll(async () => (await me(a)).flags & DRAGGED, { timeout: 20_000 }).toBe(0);
  expect(errors).toEqual([]);
});

test("wounds are server-owned and visible to everyone; a knock-down plays a ragdoll that ends in the lying pose (two real browsers)", async ({ browser }) => {
  test.setTimeout(360_000); // two software-rendered pages, a full world and a ragdoll: 1.7 min alone, and it has to survive a busy full run
  const errors: string[] = [];
  const mk = async () => {
    const p = await (await browser.newContext()).newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    return p;
  };
  const send = (p: Page, cmd: string) =>
    p.evaluate((c) => (window as unknown as { __cb: { session: { room: { send(t: string, m: unknown): void } } } }).__cb.session.room.send("debug", { cmd: c }), cmd);
  const woundsOf = (p: Page, sessionId: string) =>
    p.evaluate((id) => {
      const h = (window as unknown as { __cb: { session: { room: { state: { players: Map<string, { wounds: number; flags: number }> } } } } }).__cb;
      const s = h.session.room.state.players.get(id);
      return s ? { wounds: s.wounds, flags: s.flags } : null;
    }, sessionId);
  // Test-only peeks into the running game (Game.actors is private in TypeScript but reachable at runtime).
  type Actor = { body: { ragdolled: boolean; root: { traverse(cb: (o: { name: string; visible: boolean }) => void): void } } };
  type GameHook = { __cb: { game: { actors: Map<string, Actor> } } };
  /** Names of the wound meshes currently visible on someone's rig, as THIS page renders it. */
  const visibleWounds = (p: Page, sessionId: string) =>
    p.evaluate((id) => {
      const a = (window as unknown as GameHook).__cb.game.actors.get(id);
      const out: string[] = [];
      a?.body.root.traverse((o) => o.name.startsWith("wound_") && o.visible && out.push(o.name));
      return out.sort();
    }, sessionId);
  const ragdolled = (p: Page, sessionId: string) => p.evaluate((id) => (window as unknown as GameHook).__cb.game.actors.get(id)?.body.ragdolled ?? false, sessionId);

  const a = await mk();
  await start(a, "Bloodied");
  const { code, id: aId } = await hook(a);
  const b = await mk();
  await start(b, "Witness", code);
  await expect.poll(async () => (await hook(a)).players, { timeout: 30_000 }).toBe(2);

  // A grievous head wound (zone 0, 50 damage) and a gash on the right leg (zone 5, 25 damage).
  await send(a, "hit:0:50");
  await send(a, "hit:5:25");
  // head (zone 0) = grievous (3) in bits 0-1; right leg (zone 5) = gash (2) in bits 10-11. Poll for the WHOLE mask: the two hits arrive in separate patches.
  await expect.poll(async () => (await woundsOf(b, aId))?.wounds ?? 0, { timeout: 20_000 }).toBe(3 | (2 << 10));
  // Both the victim and the witness render dressings on exactly those zones.
  await expect.poll(() => visibleWounds(b, aId), { timeout: 20_000 }).toEqual(["wound_0", "wound_5"]);
  await expect.poll(() => visibleWounds(a, aId), { timeout: 20_000 }).toEqual(["wound_0", "wound_5"]);
  // The victim's own HUD shows the injury chart with words, not just colour.
  await expect(a.locator(".wounds")).toBeVisible();
  await expect(a.locator(".wounds .text")).toContainText("head: grievous wound");
  await expect(a.locator(".wounds .text")).toContainText("right leg: gash");
  await b.screenshot({ path: "test-results/wounds-witness.png" });

  // Knock-down: both browsers should see A's body go ragdoll, then settle back into the lying pose.
  for (const p of [a, b]) {
    await p.evaluate((id) => {
      const w = window as unknown as GameHook & { __sawRagdoll?: boolean };
      w.__sawRagdoll = false;
      setInterval(() => {
        if (w.__cb.game.actors.get(id)?.body.ragdolled) w.__sawRagdoll = true;
      }, 20);
    }, aId);
  }
  await send(a, "down");
  await expect.poll(async () => ((await woundsOf(b, aId))?.flags ?? 0) & 16, { timeout: 20_000 }).toBe(16);
  for (const p of [a, b]) {
    // The Rapier WASM loads lazily; give it time, then the fall must have been observed and must end.
    await expect.poll(() => p.evaluate(() => (window as unknown as { __sawRagdoll?: boolean }).__sawRagdoll === true), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => ragdolled(p, aId), { timeout: 120_000 }).toBe(false); // sim time only advances with frames: a starved software rasteriser (two pages + server) can need minutes
  }
  await b.screenshot({ path: "test-results/ragdoll-settled.png" });
  // Revived: wounds are patched (grievous head -> dressing) but not gone.
  expect(errors.filter((e) => !/favicon|Failed to load resource/.test(e))).toEqual([]);
});

test("a severed limb is server-owned: everyone sees the stump and a flying limb, unless they chose not to (two real browsers)", async ({ browser }) => {
  test.setTimeout(360_000); // two software-rendered pages: 22 s alone, but it timed out at 180 s late in a busy full run
  const errors: string[] = [];
  const mk = async () => {
    const p = await (await browser.newContext()).newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    return p;
  };
  const send = (p: Page, cmd: string) =>
    p.evaluate((c) => (window as unknown as { __cb: { session: { room: { send(t: string, m: unknown): void } } } }).__cb.session.room.send("debug", { cmd: c }), cmd);
  type Actor = { body: { root: { traverse(cb: (o: { name: string; visible: boolean }) => void): void } } };
  type GameHook = { __cb: { game: { actors: Map<string, Actor>; debris: { count: number } } } };
  const missingOf = (p: Page, sessionId: string) =>
    p.evaluate((id) => (window as unknown as { __cb: { session: { room: { state: { players: Map<string, { missing: number }> } } } } }).__cb.session.room.state.players.get(id)?.missing ?? -1, sessionId);
  const visible = (p: Page, sessionId: string, prefix: string) =>
    p.evaluate(
      ({ id, prefix: pre }) => {
        const a = (window as unknown as GameHook).__cb.game.actors.get(id);
        const out: string[] = [];
        a?.body.root.traverse((o) => o.name.startsWith(pre) && o.visible && out.push(o.name));
        return out.sort();
      },
      { id: sessionId, prefix },
    );
  const debris = (p: Page) => p.evaluate(() => (window as unknown as GameHook).__cb.game.debris.count);

  const a = await mk();
  await start(a, "Maimed");
  const { code, id: aId } = await hook(a);
  const b = await mk();
  await start(b, "Squeamish", code, "&limbs=0"); // personal setting: do not show severed limbs
  await expect.poll(async () => (await hook(a)).players, { timeout: 30_000 }).toBe(2);

  await send(a, "sever:4"); // LIMB.LEG_L
  // The fact is server-owned and identical for everyone.
  await expect.poll(() => missingOf(b, aId), { timeout: 20_000 }).toBe(4);
  await expect.poll(() => missingOf(a, aId), { timeout: 20_000 }).toBe(4);
  // The victim (limbs shown) sees a stump, a flying limb and the words on the injury chart.
  await expect.poll(() => visible(a, aId, "stump_"), { timeout: 20_000 }).toEqual(["stump_4"]);
  await expect.poll(() => debris(a), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  await expect(a.locator(".wounds .text")).toContainText("left leg: lost");
  // The squeamish witness sees the same injury as an ordinary grievous-wound dressing: no stump, no debris.
  await expect.poll(() => visible(b, aId, "wound_"), { timeout: 20_000 }).toContain("wound_4");
  expect(await visible(b, aId, "stump_")).toEqual([]);
  expect(await debris(b)).toBe(0);
  await a.screenshot({ path: "test-results/severed-victim.png" });
  expect(errors.filter((e) => !/favicon|Failed to load resource/.test(e))).toEqual([]);
});
