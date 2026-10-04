import { deviceTracker } from "./devices.ts";
import type { Stick2 } from "./padProfile.ts";
import { TOUCH, TOUCH_BUTTONS, anchorWithin, hiddenFor, stickFrom, type TouchButton, type TouchContext, type TouchSource } from "./touchLogic.ts";

/**
 * The on-screen controls for a phone or a tablet (D-049). DOM only: it reports what the fingers do (`TouchSource`) and `Controls` applies the rules. Shown in the field while the
 * device in use is touch (the first touch anywhere makes it so; a key, the mouse or a pad hides it again), and hidden under every sheet (the sheets are tapped directly).
 *
 * Every element listens to Pointer Events and keeps its own finger (`setPointerCapture`), so a thumb on the stick, a finger dragging the view and a third on FIRE all work at once, and
 * a finger sliding off a button still lets go of it. `touch-action: none` and `preventDefault` keep the browser from scrolling, zooming or firing its "compatibility" mouse events.
 */

/** The words on each button (the prompts in `devices.ts` print the same words). */
const LABEL: Readonly<Record<TouchButton, string>> = {
  fire: "FIRE", aim: "AIM", jump: "JUMP", use: "USE", crouch: "CROUCH", melee: "MELEE", grab: "GRAB", throw: "THROW", weapon: "ARMS", orders: "ORDERS", view: "VIEW", pause: "PAUSE",
};
/** Where each button sits: the thumb cluster (bottom right), the small row beside it, and the bar at the top right. */
const GROUP: Readonly<Record<TouchButton, "main" | "side" | "top">> = {
  fire: "main", aim: "main", jump: "main", use: "main", crouch: "side", melee: "side", grab: "side", throw: "side", weapon: "side", orders: "top", view: "top", pause: "top",
};

/**
 * D-068: an ink pictogram over each button's word (the words alone did not fit a thumb-sized circle: "CROUCH" and "RELOAD" ran over the rim). Strokes only, in the button's ink, on
 * a 24-unit grid; FIRE keeps its word alone, the bar at the top is pictograms alone. The prompts still print the words, which stay on the buttons as captions.
 */
const ICON: Readonly<Record<TouchButton | "reload" | "full", string>> = {
  fire: "",
  aim: '<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/>',
  jump: '<path d="M12 18V5M6.5 10.5 12 5l5.5 5.5M5 21h14"/>',
  use: '<path d="M8 13V6.5a1.6 1.6 0 0 1 3.2 0V11M11.2 10.5V5a1.6 1.6 0 0 1 3.2 0v6M14.4 11V7a1.6 1.6 0 0 1 3.2 0v7c0 4-2.6 7-6.2 7-2.8 0-4.4-1.6-5.4-3.6L4.4 15a1.5 1.5 0 0 1 2.5-1.6L8 15"/>',
  reload: '<rect x="9" y="3" width="6" height="13" rx="2.5"/><path d="M9 8h6M12 16v5"/>',
  crouch: '<path d="M12 3.5v10M7 9l5 5 5-5M5 20h14"/>',
  melee: '<path d="M5 19 17.5 6.5M14.5 3.5l6 6M3.5 15.5l5 5M6 18l-2.5 2.5"/>',
  grab: '<path d="M6 10.5 9 7.5M9 7.5c1.5-1.5 3.5-1.5 5 0l3 3c1.5 1.5 1.5 3.5 0 5l-3.5 3.5M9 7.5l3 3M12 10.5l-6 6M4 20l3-3"/>',
  throw: '<path d="M4 19c2-8.5 8.5-12.5 15.5-11.5M15.5 4.5l4 3-3 4"/>',
  weapon: '<path d="M4 8.5h13l-3-3M20 15.5H7l3 3"/>',
  orders: '<path d="M6 21V3.5M6 4h11l-2.5 4L17 12H6"/>',
  view: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  full: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
};
const svg = (paths: string): string => `<svg class="t-ico" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;

const isFinger = (e: PointerEvent): boolean => e.pointerType === "touch" || e.pointerType === "pen";

export class TouchControls implements TouchSource {
  readonly root: HTMLElement;
  readonly down = Object.fromEntries(TOUCH_BUTTONS.map((b) => [b, false])) as Record<TouchButton, boolean>;
  readonly move: Stick2 = { x: 0, y: 0 };
  private readonly buttons = new Map<TouchButton, HTMLElement>();
  private readonly ring: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly fullBtn: HTMLElement;
  /** "Turn the device on its side": its own element ABOVE the HUD (inside the touch layer the HUD drew over it: the first portrait look). */
  private readonly portrait: HTMLElement;
  private stickId = -1;
  private ax = 0;
  private ay = 0;
  private radius: number = TOUCH.stickRadiusPx;
  private lookId = -1;
  private lx = 0;
  private ly = 0;
  private lookDX = 0;
  private lookDY = 0;
  private playing = false;
  private isBlocked = false;
  private useUsable: boolean | undefined;
  /** The context last applied (as a bit set of hidden buttons): the DOM is touched only when it changes. */
  private hiddenBits = -1;
  private pressedBits = 0;

  constructor(private readonly doc: Document = document) {
    const el = (tag: string, cls: string, parent: HTMLElement, text = ""): HTMLElement => {
      const e = doc.createElement(tag);
      e.className = cls;
      if (text) e.textContent = text;
      parent.append(e);
      return e;
    };
    this.root = el("div", "touch-layer", doc.body);
    this.root.id = "touch";
    this.root.hidden = true;
    this.root.setAttribute("aria-hidden", "true"); // (the controls are for fingers; a screen reader player uses a keyboard or a pad)
    const look = el("div", "t-look", this.root);
    const stickZone = el("div", "t-stick-zone", this.root);
    this.ring = el("div", "t-ring", this.root);
    this.knob = el("div", "t-knob", this.ring);
    const groups = { main: el("div", "t-main", this.root), side: el("div", "t-side", this.root), top: el("div", "t-top", this.root) };
    for (const b of TOUCH_BUTTONS) {
      const btn = el("button", `t-btn t-${b}`, groups[GROUP[b]]);
      btn.innerHTML = `${ICON[b] ? svg(ICON[b]) : ""}<span class="cap">${LABEL[b]}</span>`;
      btn.setAttribute("type", "button");
      btn.dataset.b = b;
      btn.tabIndex = -1;
      this.buttons.set(b, btn);
      this.wireButton(btn, b);
    }
    // full screen: the browser's own bars take a third of a phone held sideways (a tap is the gesture the request needs; hidden where it cannot be had, e.g. an iPhone)
    this.fullBtn = el("button", "t-btn t-full", groups.top);
    this.fullBtn.innerHTML = `${svg(ICON.full)}<span class="cap">FULL</span>`;
    this.fullBtn.setAttribute("type", "button");
    this.fullBtn.tabIndex = -1;
    this.fullBtn.hidden = !doc.fullscreenEnabled;
    this.fullBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (doc.fullscreenElement) void doc.exitFullscreen?.();
      else void doc.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => undefined);
    });
    this.portrait = el("p", "t-portrait", doc.body, "Turn the device on its side: the field wants the width.");
    this.portrait.hidden = true;

    // the stick: appears where the thumb lands, kept whole on the screen
    stickZone.addEventListener("pointerdown", (e) => {
      if (!isFinger(e) || this.stickId >= 0) return;
      e.preventDefault();
      stickZone.setPointerCapture?.(e.pointerId);
      this.stickId = e.pointerId;
      const w = doc.documentElement.clientWidth || 800;
      const h = doc.documentElement.clientHeight || 400;
      this.radius = TOUCH.stickRadiusPx * Math.min(1.6, Math.max(0.8, Math.min(w, h) / 400));
      const a = anchorWithin(e.clientX, e.clientY, this.radius, w, h);
      this.ax = a.x;
      this.ay = a.y;
      this.ring.style.setProperty("--r", `${this.radius}px`);
      this.ring.style.left = `${this.ax}px`;
      this.ring.style.top = `${this.ay}px`;
      this.ring.classList.add("on");
      this.steer(e.clientX, e.clientY);
    });
    stickZone.addEventListener("pointermove", (e) => {
      if (e.pointerId === this.stickId) this.steer(e.clientX, e.clientY);
    });
    const stickUp = (e: PointerEvent): void => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = -1;
      this.move.x = this.move.y = 0;
      this.ring.classList.remove("on");
      this.knob.style.transform = "";
    };
    for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) stickZone.addEventListener(t, stickUp as EventListener);

    // the view: a drag anywhere free
    look.addEventListener("pointerdown", (e) => {
      if (!isFinger(e) || this.lookId >= 0) return;
      e.preventDefault();
      look.setPointerCapture?.(e.pointerId);
      this.lookId = e.pointerId;
      this.lx = e.clientX;
      this.ly = e.clientY;
    });
    look.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this.lookId) return;
      this.lookDX += e.clientX - this.lx;
      this.lookDY += e.clientY - this.ly;
      this.lx = e.clientX;
      this.ly = e.clientY;
    });
    const lookUp = (e: PointerEvent): void => {
      if (e.pointerId === this.lookId) this.lookId = -1;
    };
    for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) look.addEventListener(t, lookUp as EventListener);

    // any finger on the glass makes this a touch player (the menus included: the field opens with the controls up); any other device takes it back
    doc.defaultView?.addEventListener("pointerdown", (e) => {
      if (isFinger(e)) deviceTracker.note("touch");
    }, { capture: true });
    deviceTracker.onChange(() => this.refresh());
    doc.addEventListener("fullscreenchange", () => {
      this.fullBtn.classList.toggle("on", !!doc.fullscreenElement);
      this.fullBtn.hidden = !doc.fullscreenEnabled || !!doc.fullscreenElement; // (D-068: in full screen already, the browser's own gesture leaves it; the button only took room)
    });
  }

  private wireButton(btn: HTMLElement, b: TouchButton): void {
    btn.addEventListener("pointerdown", (e) => {
      if (!isFinger(e)) return;
      e.preventDefault();
      btn.setPointerCapture?.(e.pointerId);
      this.down[b] = true;
      this.pressedBits |= 1 << TOUCH_BUTTONS.indexOf(b);
      btn.classList.add("down");
    });
    const up = (e: PointerEvent): void => {
      if (!isFinger(e)) return;
      this.down[b] = false;
      btn.classList.remove("down");
    };
    for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) btn.addEventListener(t, up as EventListener);
  }

  private steer(x: number, y: number): void {
    stickFrom(this.ax, this.ay, x, y, this.radius, this.move);
    this.knob.style.transform = `translate(${(this.move.x * this.radius).toFixed(1)}px, ${(this.move.y * this.radius).toFixed(1)}px)`;
  }

  /** Up in the field (a session is running). */
  set inGame(on: boolean) {
    this.playing = on;
    this.refresh();
  }
  /** A sheet is up: the controls step aside (the sheet is tapped). */
  set blocked(on: boolean) {
    this.isBlocked = on;
    this.refresh();
  }

  get active(): boolean {
    return this.playing && !this.isBlocked && deviceTracker.device === "touch";
  }

  takePressed(): number {
    const p = this.pressedBits;
    this.pressedBits = 0;
    return p;
  }

  takeLook(): [number, number] {
    const r: [number, number] = [this.lookDX, this.lookDY];
    this.lookDX = this.lookDY = 0;
    return r;
  }

  /** USE reads RELOAD when there is nothing in reach to use (the tap reloads then: `Controls.pollTouch`). Cheap to call every frame. */
  showUse(usable: boolean): void {
    if (usable === this.useUsable) return;
    this.useUsable = usable;
    const btn = this.buttons.get("use")!;
    btn.innerHTML = `${svg(usable ? ICON.use : ICON.reload)}<span class="cap">${usable ? LABEL.use : "RELOAD"}</span>`;
  }

  /** D-068: only the buttons that mean something now (a hidden button that was held is let go). Cheap to call every frame. */
  showContext(c: TouchContext): void {
    const hide = hiddenFor(c);
    let bits = 0;
    for (let i = 0; i < TOUCH_BUTTONS.length; i++) if (hide.has(TOUCH_BUTTONS[i]!)) bits |= 1 << i;
    if (bits === this.hiddenBits) return;
    this.hiddenBits = bits;
    for (const [b, el] of this.buttons) {
      const h = hide.has(b);
      el.hidden = h;
      if (h && this.down[b]) {
        this.down[b] = false;
        el.classList.remove("down");
      }
    }
  }

  private refresh(): void {
    const on = this.active;
    const touch = deviceTracker.device === "touch";
    this.doc.body.classList.toggle("touch-ui", touch);
    this.portrait.hidden = !on;
    if (this.root.hidden === !on) return;
    this.root.hidden = !on;
    if (!on) {
      // let go of everything: a finger on a button when a sheet opens must not be stuck down when it closes
      for (const b of TOUCH_BUTTONS) this.down[b] = false;
      this.pressedBits = 0;
      for (const el of this.buttons.values()) el.classList.remove("down");
      this.stickId = this.lookId = -1;
      this.move.x = this.move.y = 0;
      this.lookDX = this.lookDY = 0;
      this.ring.classList.remove("on");
    }
  }
}
