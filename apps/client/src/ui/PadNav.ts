/**
 * Generic gamepad navigation for DOM menus: D-pad/left stick up-down moves focus, left-right adjusts
 * sliders and selects, A activates, B dispatches `padback` on the root. One implementation for every
 * menu screen so controller support is never an afterthought (brief: "controller focus from the start").
 */
export function startPadNav(root: HTMLElement, isActive: () => boolean): () => void {
  let raf = 0;
  let moveCooldown = 0;
  let adjustCooldown = 0;
  let aWas = false;
  let bWas = false;

  const focusables = (): HTMLElement[] =>
    [...root.querySelectorAll<HTMLElement>("input, select, button")].filter(
      (el) => !(el as HTMLInputElement).disabled && el.offsetParent !== null && el.getAttribute("tabindex") !== "-1",
    );

  const adjust = (el: HTMLElement, dir: number, fast: boolean): void => {
    if (el instanceof HTMLInputElement && el.type === "range") {
      const step = Number(el.step || 1) * (fast ? 8 : 4);
      el.value = String(Math.max(Number(el.min), Math.min(Number(el.max), Number(el.value) + dir * step)));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else if (el instanceof HTMLSelectElement) {
      const next = Math.max(0, Math.min(el.options.length - 1, el.selectedIndex + dir));
      if (next !== el.selectedIndex) {
        el.selectedIndex = next;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  };

  const tick = (): void => {
    raf = requestAnimationFrame(tick);
    if (!isActive()) return;
    const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p?.connected && p.mapping === "standard");
    if (!pad) return;
    const now = performance.now();
    const ay = pad.axes[1] ?? 0;
    const ax = pad.axes[0] ?? 0;
    const up = ay < -0.6 || pad.buttons[12]?.pressed;
    const down = ay > 0.6 || pad.buttons[13]?.pressed;
    const left = ax < -0.6 || pad.buttons[14]?.pressed;
    const right = ax > 0.6 || pad.buttons[15]?.pressed;

    const items = focusables();
    const current = document.activeElement as HTMLElement | null;
    if ((up || down) && now > moveCooldown && items.length) {
      moveCooldown = now + 190;
      const i = current ? items.indexOf(current) : -1;
      items[(i + (down ? 1 : -1) + items.length) % items.length]?.focus();
    }
    if ((left || right) && now > adjustCooldown && current) {
      adjustCooldown = now + 70;
      adjust(current, right ? 1 : -1, Math.abs(ax) > 0.95);
    }
    const a = pad.buttons[0]?.pressed ?? false;
    if (a && !aWas && current instanceof HTMLButtonElement) current.click();
    aWas = a;
    const b = pad.buttons[1]?.pressed ?? false;
    if (b && !bWas) root.dispatchEvent(new CustomEvent("padback"));
    bWas = b;
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
