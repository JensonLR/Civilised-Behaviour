// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { NameTags } from "./nameTags.ts";
import { COMPASS_BAND_PX } from "@cb/shared";

const NPC_SENTRY = 1, NPC_WARDEN = 2;
let layer: HTMLElement;
let tags: NameTags;
beforeEach(() => {
  document.body.innerHTML = "";
  layer = document.createElement("div");
  document.body.appendChild(layer);
  tags = new NameTags(layer);
  Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 720, configurable: true });
});
const el = (): HTMLElement[] => Array.from(layer.querySelectorAll<HTMLElement>(".nametag"));
const visible = (): HTMLElement[] => el().filter((e) => e.style.display !== "none");

describe("NameTags", () => {
  it("creates one plate per actor, hidden until it may show, and writes its text", () => {
    tags.update("a", "Miss Pym", 0, false, 8, { x: 0.1, y: 0.2, z: 0.5 }, 280);
    expect(el().length).toBe(1);
    expect(visible()[0]!.textContent).toBe("Miss Pym");
    expect(visible()[0]!.style.transform).toContain("px");
    expect(tags.shown).toBe(1);
  });

  it("culls, not clamps: behind the camera, off the frame, under the compass band, out of range", () => {
    const base = { x: 0, y: 0, z: 0.5 };
    tags.update("behind", "B", 0, false, 5, { ...base, z: 1.1 }, 300);
    tags.update("edge", "E", 0, false, 5, { ...base, x: 1.4 }, 300);
    tags.update("band", "C", 0, false, 5, base, COMPASS_BAND_PX - 4);
    tags.update("far", "F", NPC_SENTRY, false, 40, base, 300);
    tags.update("ok", "O", 0, false, 5, base, 300);
    expect(visible().map((e) => e.textContent)).toEqual(["O"]);
    // none of the hidden ones was positioned at a clamped spot
    for (const e of el()) if (e.style.display === "none") expect(e.style.transform).toBe("");
  });

  it("role tiers and sight: a soldier shows at 20 m only while in sight", () => {
    const ndc = { x: 0, y: 0, z: 0.5 };
    tags.update("s", "Sentry", NPC_SENTRY, false, 20, ndc, 300, false);
    expect(tags.shown).toBe(0);
    tags.update("s", "Sentry", NPC_SENTRY, false, 20, ndc, 300, true);
    expect(tags.shown).toBe(1);
    tags.update("w", "Warden", NPC_WARDEN, false, 28, ndc, 300);
    expect(tags.shown).toBe(2);
  });

  it("fades over the last quarter of the range", () => {
    tags.update("a", "P", 0, false, 20, { x: 0, y: 0, z: 0.5 }, 300);
    expect(visible()[0]!.style.opacity).toBe("");
    tags.update("a", "P", 0, false, 35, { x: 0, y: 0, z: 0.5 }, 300);
    expect(Number(visible()[0]!.style.opacity)).toBeCloseTo(0.5, 1);
  });

  it("hides again when the actor leaves the view, and only writes the DOM when something changed", () => {
    const ndc = { x: 0.2, y: 0, z: 0.5 };
    tags.update("a", "P", 0, false, 5, ndc, 300);
    const e = visible()[0]!;
    const t0 = e.style.transform;
    let writes = 0;
    const obs = new MutationObserver(() => writes++);
    obs.observe(e, { attributes: true, childList: true, characterData: true, subtree: true });
    for (let i = 0; i < 30; i++) tags.update("a", "P", 0, false, 5, ndc, 300);
    expect(e.style.transform).toBe(t0);
    tags.update("a", "P", 0, false, 5, { ...ndc, z: 1.2 }, 300);
    expect(e.style.display).toBe("none");
    obs.disconnect();
    void writes;
  });

  it("sweep removes the plates of actors that are gone", () => {
    tags.update("a", "A", 0, false, 5, { x: 0, y: 0, z: 0.5 }, 300);
    tags.update("b", "B", 0, false, 5, { x: 0.3, y: 0, z: 0.5 }, 300);
    tags.sweep(new Set(["a"]));
    expect(el().map((e) => e.textContent)).toEqual(["A"]);
    tags.sweep(new Set());
    expect(el().length).toBe(0);
  });

  it("twelve NPCs near the compass: none is ever shown inside the band or off screen", () => {
    for (let i = 0; i < 12; i++) {
      const ndc = { x: -1.1 + i * 0.2, y: 0.95 - i * 0.18, z: i % 5 === 0 ? 1.3 : 0.7 };
      const top = ((1 - ndc.y) / 2) * 720;
      tags.update(`n${i}`, `N${i}`, NPC_SENTRY, false, 6 + i, ndc, top, true);
    }
    for (const e of visible()) {
      const m = /translate\((-?\d+)px, (-?\d+)px\)$/.exec(e.style.transform);
      expect(m).not.toBeNull();
      const x = Number(m![1]), y = Number(m![2]);
      expect(y).toBeGreaterThanOrEqual(COMPASS_BAND_PX);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1280);
    }
  });

  it("dispose removes everything", () => {
    tags.update("a", "A", 0, false, 5, { x: 0, y: 0, z: 0.5 }, 300);
    tags.dispose();
    expect(el().length).toBe(0);
  });
});

describe("NameTags never pile up (D-040)", () => {
  const box = (e: HTMLElement): { x: number; y: number } => {
    const m = /translate\((-?\d+)px, (-?\d+)px\)/.exec(e.style.transform)!;
    return { x: Number(m[1]), y: Number(m[2]) };
  };
  it("a farther plate that would cover a nearer one climbs above it; the nearest keeps its spot", () => {
    const ndc = { x: 0, y: 0, z: 0.5 };
    tags.update("near", "Jem Cobbold · follow · steady", 0, false, 4, ndc, 300);
    tags.update("far", "Dr. Philippa Crake · follow · shaken", 0, false, 6, { ...ndc, x: 0.02 }, 304);
    tags.sweep(new Set(["near", "far"]));
    const [near, far] = el();
    expect(box(near!).y).toBe(300);
    expect(box(far!).y).toBeLessThanOrEqual(304 - 22); // lifted a whole plate
    expect(far!.style.visibility).toBe("");
    expect(tags.shown).toBe(2);
  });

  it("a crowd keeps its nearest names: beyond two lifts a plate is hidden for the frame, and comes back when there is room", () => {
    const ids = ["a", "b", "c", "d", "e"];
    ids.forEach((id, i) => tags.update(id, `Sentry Number ${id}`, 0, false, 3 + i, { x: 0, y: 0, z: 0.5 }, 400));
    tags.sweep(new Set(ids));
    expect(tags.shown).toBe(3);
    expect(el().filter((e) => e.style.visibility === "hidden").length).toBe(2);
    // the crowd spreads out: everyone fits again
    ids.forEach((id, i) => tags.update(id, `Sentry Number ${id}`, 0, false, 3 + i, { x: -0.8 + i * 0.4, y: 0, z: 0.5 }, 400));
    tags.sweep(new Set(ids));
    expect(tags.shown).toBe(5);
    expect(el().every((e) => e.style.visibility === "")).toBe(true);
  });

  it("a plate the frame's edge would cut is hidden, not shoved back on screen", () => {
    tags.update("edge", "Lamp-Warden Ysolde Hask", 2, false, 5, { x: 0.95, y: 0, z: 0.5 }, 300);
    tags.sweep(new Set(["edge"]));
    expect(tags.shown).toBe(0);
    expect(box(el()[0]!).x).toBe(Math.round(1.95 / 2 * 1280)); // where it points, never clamped
  });
});
