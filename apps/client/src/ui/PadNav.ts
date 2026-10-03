import { playSfx, wakeAudio } from "../audio/index.ts";

/**
 * Generic gamepad navigation for DOM menus: D-pad/left stick up-down moves focus (in reading order, the focused control scrolled into view), left-right adjusts sliders, selects and
 * checkboxes, A activates (a button, a switch, a tab, a link; on a select it steps to the next option), B dispatches `padback` on the root, and the bumpers (LB/RB) dispatch `padtab`
 * ({detail: -1 | +1}) so tabbed sheets can switch page. A TRAPPED sheet (an `.overlay`, or anything with an `aria-modal` dialog in it) never loses its focus: if the focused control is removed
 * or disabled (a list rebuilt, a stepper that has reached its limit) the pad's next input lands on the sheet's primary action instead of nowhere.
 * One implementation for every menu screen so controller support is never an afterthought (brief: "controller focus from the start").
 */
/** A held direction steps once, waits this long, then repeats this often (ms). */
export const NAV_FIRST_REPEAT_MS = 420, NAV_REPEAT_MS = 150;

/**
 * THE LETTER DIAL (D-049, the console path): a text field with `data-pad-chars` (its alphabet) is typed by pad alone, with no keyboard on screen. A on the field starts the dial on its
 * first letter (the letter being turned is the field's own selection, so it needs no drawing); up and down turn it through the alphabet, left and right move along (right past the end
 * adds a letter, up to the field's maxlength), X (Square) takes the letter out, A stops (and, on a field marked `data-pad-send`, sends: an Enter keydown, which the field already answers) and B stops. The field hears `paddial` ({detail: true | false}) as the dial
 * starts and stops, so its sheet can say how it works. Before this a pad player on a console or a Deck could not type the five letters of a friend's code.
 */
export function dialTurn(value: string, slot: number, dir: number, chars: string): string {
  const ch = value[slot];
  const at = ch === undefined ? -1 : chars.indexOf(ch); // (not indexOf(""): that is 0)
  const next = chars[(((at < 0 ? (dir > 0 ? -1 : 0) : at) + dir) % chars.length + chars.length) % chars.length]!;
  return value.slice(0, slot) + next + value.slice(slot + 1);
}
/** X (Square) takes out the letter being turned: [the new value, the new slot] (the slot stays put, or steps back off the end). */
export function dialDelete(value: string, slot: number): [string, number] {
  const v = value.slice(0, slot) + value.slice(slot + 1);
  return [v, Math.max(0, Math.min(slot, v.length - 1))];
}
/** Left or right along the field: [the new value, the new slot]. Right past the last letter adds one (the alphabet's first), while the field has room. */
export function dialMove(value: string, slot: number, dir: number, chars: string, maxLen: number): [string, number] {
  if (dir < 0) return [value, Math.max(0, slot - 1)];
  if (slot + 1 < value.length) return [value, slot + 1];
  if (value.length >= maxLen) return [value, slot];
  return [value + chars[0], value.length];
}

let padWoke = false;

export function startPadNav(root: HTMLElement, isActive: () => boolean): () => void {
  let raf = 0;
  let moveCooldown = 0;
  /** The direction held at the last poll (-1 up, 1 down, 0 none): a new press steps at once, a held one waits for the repeat. */
  let navHeld = 0;
  let adjustCooldown = 0;
  let aWas = false;
  let bWas = false;
  let lbWas = false;
  let rbWas = false;
  let xWas = false;
  /** The field being typed by the dial, and the letter being turned. */
  let dial: { el: HTMLInputElement; chars: string; slot: number } | null = null;

  /** A control in a `hidden` section of the root (the door's Continue row before there is anything to continue) is not a stop, whatever the layout engine says. */
  const insideHidden = (el: HTMLElement): boolean => {
    const h = el.closest("[hidden]");
    return h !== null && h !== root && root.contains(h);
  };
  const focusables = (): HTMLElement[] =>
    [...root.querySelectorAll<HTMLElement>("input, select, button, a[href], [role='menuitem'], [role='button']")].filter(
      (el) => !(el as HTMLInputElement).disabled && el.getAttribute("aria-disabled") !== "true" && el.offsetParent !== null && el.getAttribute("tabindex") !== "-1" && !el.closest("[inert]") && !insideHidden(el),
    );
  const trapped = (): boolean => root.classList.contains("overlay") || root.querySelector("[aria-modal='true']") !== null;
  /** The sheet's primary action: what it marks for autofocus, else its primary button, else the first control. */
  const primary = (items: HTMLElement[]): HTMLElement | undefined => items.find((el) => el.hasAttribute("data-autofocus")) ?? items.find((el) => el.classList.contains("primary")) ?? items[0];
  const focusEl = (el: HTMLElement | undefined): void => {
    if (!el) return;
    el.focus();
    el.scrollIntoView?.({ block: "nearest" });
  };

  const adjust = (el: HTMLElement, dir: number, fast: boolean): void => {
    if (el instanceof HTMLInputElement && el.type === "range") {
      // About 40 presses end to end (a third of that when the stick is pushed all the way), whatever the slider's scale.
      const step = Number(el.step || 1);
      const span = Number(el.max) - Number(el.min);
      const base = Math.max(step, Math.round(span / 40 / step) * step);
      const next = Math.max(Number(el.min), Math.min(Number(el.max), Number(el.value) + dir * base * (fast ? 3 : 1)));
      if (next !== Number(el.value)) {
        el.value = String(next);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    } else if (el instanceof HTMLInputElement && el.type === "checkbox") {
      const want = dir > 0;
      if (el.checked !== want) el.click();
    } else if (el instanceof HTMLSelectElement) {
      const next = Math.max(0, Math.min(el.options.length - 1, el.selectedIndex + dir));
      if (next !== el.selectedIndex) {
        el.selectedIndex = next;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  };

  const showDial = (): void => {
    if (!dial) return;
    dial.el.focus();
    dial.el.setSelectionRange?.(dial.slot, dial.slot + 1);
  };
  const setDialValue = (v: string): void => {
    if (!dial || v === dial.el.value) return;
    dial.el.value = v;
    dial.el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const startDial = (el: HTMLInputElement, chars: string): void => {
    dial = { el, chars, slot: 0 };
    if (!el.value) setDialValue(chars[0]!);
    el.classList.add("dialing");
    el.dispatchEvent(new CustomEvent("paddial", { detail: true, bubbles: true }));
    showDial();
  };
  const endDial = (send: boolean): void => {
    if (!dial) return;
    const el = dial.el;
    dial = null;
    el.classList.remove("dialing");
    el.setSelectionRange?.(el.value.length, el.value.length);
    el.dispatchEvent(new CustomEvent("paddial", { detail: false, bubbles: true }));
    if (send) el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  };

  /** A on the focused control: press a button, tab, link or switch; step a select to its next option (wrapping); start the letter dial on a field that has one. A slider is moved by left and right, not A. */
  const activate = (el: HTMLElement): void => {
    if (el instanceof HTMLInputElement && el.dataset.padChars && !el.readOnly) {
      startDial(el, el.dataset.padChars);
    } else if (el instanceof HTMLSelectElement) {
      el.selectedIndex = (el.selectedIndex + 1) % Math.max(1, el.options.length);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (el instanceof HTMLInputElement) {
      if (el.type === "checkbox" || el.type === "radio" || el.type === "button" || el.type === "submit") el.click();
    } else el.click();
  };

  const tick = (): void => {
    raf = requestAnimationFrame(tick);
    if (!isActive()) return;
    const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p?.connected && p.mapping === "standard");
    if (!pad) return;
    // the first pad input asks for sound (a pad press is no gesture to a browser, which keeps it waiting for a click; the desktop build starts at once anyway)
    if (!padWoke && pad.buttons.some((b) => b?.pressed)) {
      padWoke = true;
      wakeAudio();
    }
    const now = performance.now();
    const ay = pad.axes[1] ?? 0;
    const ax = pad.axes[0] ?? 0;
    const up = ay < -0.6 || pad.buttons[12]?.pressed;
    const down = ay > 0.6 || pad.buttons[13]?.pressed;
    const left = ax < -0.6 || pad.buttons[14]?.pressed;
    const right = ax > 0.6 || pad.buttons[15]?.pressed;

    // the dial has the pad to itself until A sends or B stops (or its field goes: a sheet closed under it)
    if (dial && (!dial.el.isConnected || dial.el.disabled || dial.el.offsetParent === null)) endDial(false);
    if (dial) {
      const d = dial;
      const vdir = down ? -1 : up ? 1 : 0;
      const hdir = right ? 1 : left ? -1 : 0;
      const key = vdir !== 0 ? 12 + vdir : hdir !== 0 ? 15 + hdir : 0; // (never a menu direction, -1 or 1; one held direction at a time, each with its own first-step-then-repeat)
      if (key !== 0 && (key !== navHeld || now >= moveCooldown)) {
        moveCooldown = now + (key !== navHeld ? NAV_FIRST_REPEAT_MS : NAV_REPEAT_MS);
        if (vdir !== 0) setDialValue(dialTurn(d.el.value, d.slot, vdir, d.chars));
        else {
          const [v, slot] = dialMove(d.el.value, d.slot, hdir, d.chars, d.el.maxLength > 0 ? d.el.maxLength : 32);
          setDialValue(v);
          d.slot = slot;
        }
        showDial();
        playSfx("ui_hover");
      }
      navHeld = key;
      const x = pad.buttons[2]?.pressed ?? false;
      if (x && !xWas) {
        const [v, slot] = dialDelete(d.el.value, d.slot);
        setDialValue(v);
        d.slot = slot;
        showDial();
      }
      xWas = x;
      const a = pad.buttons[0]?.pressed ?? false;
      const b = pad.buttons[1]?.pressed ?? false;
      if (a && !aWas) endDial(d.el.hasAttribute("data-pad-send"));
      else if (b && !bWas) endDial(false);
      aWas = a;
      bWas = b;
      lbWas = pad.buttons[4]?.pressed ?? false;
      rbWas = pad.buttons[5]?.pressed ?? false;
      return;
    }

    const items = focusables();
    let current = document.activeElement as HTMLElement | null;
    // a trapped sheet whose focused control has gone: land on the primary action (and let this input be spent on that, not on moving off it)
    if (trapped() && items.length && (!current || !root.contains(current) || !items.includes(current))) {
      if (up || down || left || right || (pad.buttons[0]?.pressed ?? false)) {
        focusEl(primary(items));
        current = document.activeElement as HTMLElement | null;
        navHeld = up ? -1 : down ? 1 : 0; // (this press is spent on the landing)
        moveCooldown = now + NAV_FIRST_REPEAT_MS;
        aWas = true;
      }
    }
    // One step per press, then (still held) a pause before the repeat starts: a press a little slower than a flick is still ONE step (D-041: a held
    // direction stepped again after 190 ms, so a casual press, or a slow frame, skipped the control the player wanted).
    const dir = down ? 1 : up ? -1 : 0;
    if (dir !== 0 && items.length && (dir !== navHeld || now >= moveCooldown)) {
      moveCooldown = now + (dir !== navHeld ? NAV_FIRST_REPEAT_MS : NAV_REPEAT_MS);
      const i = current ? items.indexOf(current) : -1;
      focusEl(items[i < 0 ? (down ? 0 : items.length - 1) : (i + (down ? 1 : -1) + items.length) % items.length]);
      playSfx("ui_hover");
    }
    navHeld = dir;
    if ((left || right) && now > adjustCooldown && current) {
      adjustCooldown = now + 70;
      adjust(current, right ? 1 : -1, Math.abs(ax) > 0.95);
    }
    const a = pad.buttons[0]?.pressed ?? false;
    if (a && !aWas && current) activate(current);
    aWas = a;
    const b = pad.buttons[1]?.pressed ?? false;
    if (b && !bWas) root.dispatchEvent(new CustomEvent("padback"));
    bWas = b;
    const lb = pad.buttons[4]?.pressed ?? false;
    const rb = pad.buttons[5]?.pressed ?? false;
    if (lb && !lbWas) root.dispatchEvent(new CustomEvent("padtab", { detail: -1 }));
    if (rb && !rbWas) root.dispatchEvent(new CustomEvent("padtab", { detail: 1 }));
    lbWas = lb;
    rbWas = rb;
  };
  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    endDial(false);
  };
}
