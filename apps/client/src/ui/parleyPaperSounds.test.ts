// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePaper, newCampaign, type ParleyView } from "@cb/shared";

const calls: string[] = [];
vi.mock("../audio/index.ts", () => ({ playSfx: (name: string) => calls.push(name), attachUiSounds: () => undefined }));
const { Parley } = await import("./Parley.ts");
const { NewspaperView } = await import("./Newspaper.ts");

let host: HTMLElement;
beforeEach(() => {
  calls.length = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
});
afterEach(() => {
  document.body.innerHTML = "";
});

const view: ParleyView = {
  round: 1,
  speaker: "Lamp-Warden Ysolde Hask",
  line: "The toll is forty pounds.",
  toll: 40,
  mood: "neutral",
  options: [
    { id: "pay", label: "Pay the toll", cost: 40, hint: "Quick. Dull." },
    { id: "walk_away", label: "Walk away", cost: 0, hint: "She notes the time." },
  ],
};

describe("the parley stamp and the paper's rustle", () => {
  it("picking an option (click or number key) stamps the deal BEFORE the server is told; closing the sheet does not stamp", () => {
    const p = new Parley(host);
    const order: string[] = [];
    p.open(view, (i) => order.push(`pick${i}:${calls.length}`), () => order.push("close"));
    host.ownerDocument.querySelector<HTMLButtonElement>('button[data-i="0"]')!.click();
    expect(calls).toEqual(["parley_stamp"]);
    expect(order).toEqual(["pick0:1"]); // the stamp was already down when the pick was sent
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "2" }));
    expect(calls).toEqual(["parley_stamp", "parley_stamp"]);
    expect(order[1]).toBe("pick1:2");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "9" })); // no such option
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(calls).toHaveLength(2);
    p.closeUi();
    expect(calls).toHaveLength(2);
    p.dispose();
  });

  it("the broadsheet rustles when it is unfolded, once, and not when it is folded away", () => {
    const n = new NewspaperView(host);
    n.show(generatePaper(newCampaign(3), 3), () => undefined);
    expect(calls).toEqual(["paper_rustle"]);
    n.hide();
    expect(calls).toEqual(["paper_rustle"]);
    n.dispose();
  });
});
