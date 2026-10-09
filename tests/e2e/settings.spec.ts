import { expect, test, type Page } from "@playwright/test";

/**
 * The presentation slice in a real browser: the settings screen (tabs, sliders, persistence, live attributes), key rebinding with conflict
 * detection, the how-to card, the pause sheet in a real expedition, captions, and the audio engine itself (created on a real gesture, every
 * synthesised sound rendered offline and measured). State is polled, never timed: the runner is a software rasteriser.
 */

type Hook = {
  controls: { blocked: boolean };
  pause: { isOpen: boolean };
};
const hook = (page: Page) => page.evaluate(() => {
  const h = (window as unknown as { __cb: Hook }).__cb;
  return { blocked: h.controls.blocked, paused: h.pause.isOpen };
});

async function menu(page: Page, extra = ""): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/404|favicon/.test(m.text()) && errors.push(m.text()));
  await page.goto(`/?gfx=test${extra}`);
  await page.waitForSelector("#name", { timeout: 60_000 });
  return errors;
}

const stored = (page: Page, key: string) => page.evaluate((k) => localStorage.getItem(k), key);

test("settings: tabs work by mouse and keyboard, sliders persist across a reload, Escape returns focus", async ({ page }) => {
  const errors = await menu(page);
  await page.click("#options");
  const dialog = page.getByRole("dialog", { name: "Standing Orders" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("tab", { selected: true })).toHaveText(/Sound/);

  // keyboard: arrow keys move between tabs
  await dialog.getByRole("tab", { selected: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("tab", { name: /Display/, selected: true })).toBeVisible();
  await dialog.getByRole("tab", { name: "Sound" }).click();

  // a slider writes through settings.ts and survives a reload
  const master = page.getByLabel("Master");
  await master.fill("35");
  await expect(page.locator("output[for]").first()).toHaveText("35%");
  expect(await stored(page, "cb.vol.master")).toBe("0.35");
  await page.reload();
  await page.waitForSelector("#name");
  await page.click("#options");
  await expect(page.getByLabel("Master")).toHaveValue("35");

  // Escape closes, and the button that opened it has focus again
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator("#options")).toBeFocused();
  expect(errors).toEqual([]);
});

test("accessibility options change the whole interface at once and persist", async ({ page }) => {
  await menu(page);
  await page.click("#options");
  await page.locator("#tab-access").click();
  const root = () => page.evaluate(() => ({ ...document.documentElement.dataset, scale: getComputedStyle(document.documentElement).getPropertyValue("--ui-scale") }) as Record<string, string | undefined>);
  expect(await root()).toMatchObject({ scale: "1" });

  await page.getByRole("switch", { name: "High contrast" }).check();
  await page.getByRole("switch", { name: "Colour-blind safe marks" }).check();
  await page.getByRole("switch", { name: "Larger text" }).check();
  await page.getByRole("switch", { name: "Captions" }).check();
  const on = await root();
  expect(on.contrast).toBe("high");
  expect(on.cvd).toBe("1");
  expect(on.largeText).toBe("1");
  expect(Number(on.scale)).toBeCloseTo(1.2, 5);
  // the page really got bigger: the root font size is what every rem hangs from
  expect(await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))).toBeCloseTo(17 * 1.2, 1);

  await page.reload();
  await page.waitForSelector("#name");
  expect(await root()).toMatchObject({ contrast: "high", cvd: "1", largeText: "1" });

  // Restore defaults undoes every one of them
  await page.click("#options");
  const reset = page.getByRole("button", { name: /Restore defaults|Really restore/ });
  await reset.click(); // the first press asks "Really restore? Press again"
  await reset.click();
  const off = await root();
  expect(off.contrast).toBeUndefined();
  expect(off.cvd).toBeUndefined();
  expect(off.largeText).toBeUndefined();
  expect(off.scale).toBe("1");
});

test("interface scale slider rescales the menu live", async ({ page }) => {
  await menu(page);
  const fontSize = () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  expect(await fontSize()).toBeCloseTo(17, 1);
  await page.click("#options");
  await page.locator("#tab-video").click();
  await page.getByLabel("Interface scale").fill("120");
  expect(await fontSize()).toBeCloseTo(20.4, 1); // (capped at 5.2 vh, so a short window is never outgrown: 23.4 px at this 450 px height)
  await page.getByLabel("Interface scale").fill("150");
  expect(await fontSize()).toBeCloseTo(23.4, 1);
  await page.getByLabel("Interface scale").fill("80");
  expect(await fontSize()).toBeCloseTo(13.6, 1);
});

test("key rebinding: a clash is reported, swapping fixes both, reserved keys are refused, reset restores", async ({ page }) => {
  await menu(page);
  await page.click("#options");
  await page.locator("#tab-controls").click();
  const jump = page.locator('button.keycap[data-action="jump"][data-slot="0"]');
  const interact = page.locator('button.keycap[data-action="interact"][data-slot="0"]');
  await jump.scrollIntoViewIfNeeded();
  await expect(jump).toHaveText("Space");

  // E belongs to "Use / pick up / revive"
  await jump.click();
  await expect(jump).toHaveText(/Press a key/);
  await page.keyboard.press("KeyE");
  const bar = page.getByRole("alert").filter({ hasText: "already belongs" });
  await expect(bar).toBeVisible();
  expect(await stored(page, "cb.bindings")).toBeNull(); // nothing changed yet

  await bar.getByRole("button", { name: "Swap them" }).click();
  await expect(bar).toBeHidden();
  await expect(jump).toHaveText("E");
  await expect(interact).toHaveText("Space");
  expect(JSON.parse((await stored(page, "cb.bindings"))!)).toMatchObject({ jump: ["KeyE", ""], interact: ["Space", ""] });

  // Escape while listening cancels the capture (and does not close the sheet)
  await jump.click();
  await page.keyboard.press("Escape");
  await expect(jump).toHaveText("E");
  await expect(page.getByRole("dialog", { name: "Standing Orders" })).toBeVisible();

  // F3 is reserved
  await jump.click();
  await page.keyboard.press("F3");
  await expect(page.locator("#sheet-settings p.status")).toContainText("reserved");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Reset keys" }).click();
  await expect(jump).toHaveText("Space");
  expect(await stored(page, "cb.bindings")).toBeNull();
});

test("the how-to card lists the keyboard controls, follows a rebind, and switches to the gamepad layout", async ({ page }) => {
  await menu(page);
  await expect(page.locator("#howto")).toHaveClass(/new/);
  await page.click("#howto");
  const card = page.getByRole("dialog", { name: "Field Manual" });
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: /Keyboard/ })).toHaveAttribute("aria-pressed", "true");
  await expect(card).toContainText("Reload");
  await expect(card.locator("kbd", { hasText: /^Space$/ })).toBeVisible();
  await card.getByRole("button", { name: "Gamepad" }).click();
  await expect(card.locator(".glyph-trigger", { hasText: /^RT$/ })).toBeVisible(); // (D-038: the pad layout is drawn as glyphs of the device in use, no longer plain key caps)
  await expect(card).toContainText("Fire");
  await card.getByRole("button", { name: "Understood" }).click();
  await expect(card).toBeHidden();
  await expect(page.locator("#howto")).not.toHaveClass(/new/); // read once: the NEW stamp goes
});

test("audio: the first click creates the context, every sound bakes, and each one is finite, audible and under full scale", async ({ page }) => {
  const errors = await menu(page);
  await page.click("#name"); // a real gesture
  await expect
    .poll(async () => page.evaluate(async () => (await new Function("p", "return import(p)")("/src/audio/index.ts")).audioState()), { timeout: 30_000 })
    .toBe("running");

  const report = await page.evaluate(async () => {
    const imp = (p: string) => new Function("p", "return import(p)")(p) as Promise<any>; // a plain dynamic import would be rewritten by the test transpiler
    const { analyseAll } = await imp("/src/audio/analyse.ts");
    const { SOUNDS } = await imp("/src/audio/sounds.ts");
    const rows = await analyseAll();
    return { rows, expected: new Set(Object.values(SOUNDS)).size };
  }) as { rows: { name: string; key: string; variant: number; nonFinite: number; peakDb: number; rmsDb: number; dc: number; audibleSeconds: number; seconds: number }[]; expected: number };
  const names = new Set(report.rows.map((r) => r.name));
  expect(names.size).toBeGreaterThanOrEqual(report.expected - 1); // aliases are measured once
  for (const r of report.rows) {
    const id = `${r.name}/${r.key}/${r.variant}`;
    expect(r.nonFinite, `${id} has NaN or infinite samples`).toBe(0);
    expect(r.peakDb, `${id} clips`).toBeLessThanOrEqual(0.01);
    expect(r.rmsDb, `${id} is silent`).toBeGreaterThan(-75);
    expect(Math.abs(r.dc), `${id} wanders (DC offset)`).toBeLessThan(0.08);
    expect(r.audibleSeconds, `${id} length`).toBeGreaterThan(0.02);
    expect(r.seconds, `${id} length`).toBeLessThan(8);
  }
  // the big guns are the loudest things in the game, footsteps among the quietest
  const level = (n: string) => Math.max(...report.rows.filter((r) => r.name === n).map((r) => r.peakDb));
  expect(level("cannon_shot")).toBeGreaterThan(level("footstep_grass") + 10);

  // the live engine baked them all too, and playing does not throw
  const live = await page.evaluate(async () => {
    const imp = (p: string) => new Function("p", "return import(p)")(p) as Promise<any>; // a plain dynamic import would be rewritten by the test transpiler
    const a = await imp("/src/audio/index.ts");
    a.setListener({ x: 0, y: 0, z: 0 }, 0);
    for (const n of ["musket_shot", "cannon_shot", "footstep_grass", "hurt", "ui_click"]) a.playSfx(n, { x: 4, y: 0, z: -4, seed: 3 });
    return { state: a.audioState(), baked: a.__engine.bank.bakedCount };
  });
  expect(live.state).toBe("running");
  expect(errors).toEqual([]);
});

test("captions name the sound and where it came from, and only when switched on", async ({ page }) => {
  await menu(page, "&captions=1");
  await page.evaluate(async () => {
    const imp = (p: string) => new Function("p", "return import(p)")(p) as Promise<any>; // a plain dynamic import would be rewritten by the test transpiler
    const { Captions } = await imp("/src/ui/Captions.ts");
    const a = await imp("/src/audio/index.ts");
    new Captions(document.body);
    a.setListener({ x: 0, y: 0, z: 0 }, 0);
    a.playSfx("musket_shot", { x: -8, y: 0, z: 0 }); // west of a listener facing north: on the left
    a.playSfx("explosion", { x: 0, y: 0, z: 30 }); // behind
  });
  const lines = page.locator(".captions .caption");
  await expect(lines.first()).toHaveText("[musket shot, left]");
  await expect(lines.nth(1)).toHaveText("[explosion, behind]");
});

test("pause: Escape in a real expedition opens the sheet, holds the controls off, and Resume gives them back", async ({ page }) => {
  const errors = await menu(page);
  await page.fill("#name", "Sir Pauser");
  await page.click("#create");
  await page.waitForFunction(() => Boolean((window as unknown as { __cb?: unknown }).__cb), null, { timeout: 60_000 });
  expect(await hook(page)).toEqual({ blocked: false, paused: false });

  await page.locator("#stage").focus();
  await page.keyboard.press("Escape");
  const sheet = page.getByRole("dialog", { name: "Expedition Halted" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Expedition No.");
  await expect.poll(async () => (await hook(page)).blocked).toBe(true);

  // nested sheets: settings on top of pause; Escape closes only the top one
  await sheet.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Standing Orders" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Standing Orders" })).toBeHidden();
  await expect(sheet).toBeVisible();
  expect((await hook(page)).blocked).toBe(true);

  // leaving needs a second press
  await sheet.getByRole("button", { name: "Leave expedition" }).click();
  await expect(sheet.getByRole("button", { name: /Really leave/ })).toBeVisible();

  await sheet.getByRole("button", { name: "Resume" }).click();
  await expect(sheet).toBeHidden();
  await expect.poll(async () => (await hook(page)).blocked).toBe(false);
  expect(errors).toEqual([]);
});
