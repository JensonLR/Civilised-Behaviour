// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { PerspectiveCamera } from "three";
import { BARK_SHOW_S, Barks, MAX_BARKS } from "./Barks.ts";

/** D-087: the party's barks as slips over their heads. */
describe("the speech slips", () => {
  const layer = document.createElement("div");
  document.body.appendChild(layer);
  const cam = new PerspectiveCamera(60, 1, 0.1, 500);
  cam.position.set(0, 2, 10);
  cam.lookAt(0, 2, 0);
  cam.updateMatrixWorld();
  const at = (): { x: number; y: number; z: number } => ({ x: 0, y: 0, z: 0 });
  afterEach(() => (layer.innerHTML = ""));

  it("shows the words over the speaker, headed with the name, for its time; a speaker who speaks again replaces their own slip", () => {
    const b = new Barks(layer, cam);
    b.say("ada", "Splendid!", "Ada", 1000);
    b.frame(1500, at);
    const slip = layer.querySelector<HTMLElement>(".folk-say")!;
    expect(slip.textContent).toBe("Splendid!");
    expect(slip.dataset.kicker).toBe("ADA");
    expect(slip.style.display).toBe("block");
    b.say("ada", "Bother!", "Ada", 1600);
    expect(b.showing).toEqual([{ id: "ada", text: "Bother!" }]);
    b.frame(1600 + BARK_SHOW_S * 1000 + 1, at);
    expect(b.showing).toEqual([]);
    expect(slip.style.display).toBe("none");
    b.dispose();
  });

  it("a few voices at most; a speaker who has gone (no row) shows nothing but times out as usual", () => {
    const b = new Barks(layer, cam);
    for (let i = 0; i < MAX_BARKS + 2; i++) b.say(`p${i}`, `Line ${i}`, `P${i}`, 1000 + i);
    expect(b.showing.length).toBe(MAX_BARKS);
    expect(b.showing[0]!.id).toBe("p2");
    b.frame(1200, () => undefined);
    expect([...layer.querySelectorAll<HTMLElement>(".folk-say")].every((e) => e.style.display !== "block")).toBe(true);
    b.dispose();
  });
});
