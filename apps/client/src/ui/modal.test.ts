// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { Modal } from "./modal.ts";

/** A sheet opens at its top: its focused button may be at the foot (the broadsheet's), and focusing it scrolled the masthead out of sight. */
describe("a sheet opens at its top", () => {
  it("resets the panel's scroll and focuses without scrolling", () => {
    const m = new Modal("scrolltest", "paper", "t");
    const button = document.createElement("button");
    button.dataset.autofocus = "";
    m.panel.append(button);
    m.panel.scrollTop = 400;
    const focus = vi.spyOn(button, "focus");
    m.open();
    expect(m.panel.scrollTop).toBe(0);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    m.close();
  });
});
