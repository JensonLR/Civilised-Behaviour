import { BUTTON, CARRIED, axisToWire, clamp, type WeaponId } from "@cb/shared";
import { getAimAssist, getHoldToAim, getPadAimSensitivity, getPadCurve, getPadDeadzone, getPadRumble } from "../settings.ts";
import { AIM } from "./aim.ts";
import { actionForCode, heldButtons, isHeld, tapButtonFor } from "./bindings.ts";
import { deviceTracker, padFamily, PAD_INDEX, wireGlyphPreference, type PadControl } from "./devices.ts";
import { Gesture, getPadBindings, rumble, shapeStick, type PadAction, type PadButton, type RumbleKind, type Stick2 } from "./padProfile.ts";
import { TOUCH, TOUCH_BUTTONS, stickRuns, type TouchButton, type TouchContext, type TouchSource } from "./touchLogic.ts";

/** A sampled intent for one fixed simulation step. */
export interface Intent {
  moveF: number;
  moveR: number;
  buttons: number;
}

/** Default keyboard key that toggles first/third person (V is melee). The live key comes from the bindings (input/bindings.ts) and can be rebound. */
export const VIEW_KEY = "KeyX";
/** Standard-mapping gamepad button that toggles it: R3, the right stick click, HELD for 0.3 s (the default of `PadBindings.view`; the live control comes from `getPadBindings()`). */
export const VIEW_PAD_BUTTON = PAD_INDEX.r3;

const isTextEntry = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export interface ControlSettings {
  sensitivity: number;
  padSensitivity: number;
  holdToSprint: boolean;
}

/** The buttons the pad reader keeps a gesture for (the standard mapping; sticks are axes). */
const PAD_BUTTONS: readonly PadButton[] = ["a", "b", "x", "y", "lb", "rb", "lt", "rt", "back", "start", "l3", "r3", "up", "down", "left", "right"];

/** The wire button each rebindable pad action holds while its control is down (aim and sprint are handled with their own rules; interact and view have gestures). */
const HELD_BUTTON: Readonly<Partial<Record<PadAction, number>>> = { jump: BUTTON.JUMP, crouch: BUTTON.CROUCH, melee: BUTTON.MELEE, throw: BUTTON.THROW, grab: BUTTON.GRAB, fire: BUTTON.FIRE };
/** The ones whose press must never be lost between two input samples (a tap shorter than one 33 ms step). */
const TAP_BUTTON: readonly PadAction[] = ["jump", "melee", "throw", "grab", "fire"];

/**
 * Keyboard + mouse and gamepad, treated as equals. Look deltas are accumulated between frames and drained by the camera; movement/buttons are sampled once per fixed input step.
 *
 * Pad v2 (D-038): the layout is the rebindable `PadBindings` (padProfile.ts); sticks go through the player's deadzone and curve; X is USE on a tap when something can be used
 * (`canInteract`) and RELOAD otherwise, and a HOLD past 0.3 s always reloads unless the thing in reach is itself a hold (`holdInteract`: reviving); the view switch is a 0.3 s HOLD of R3
 * so a stick press in a fight never flips the camera; every pad event notes the device for the glyphs; rumble goes through `rumble()`.
 */
export class Controls {
  private keys = new Set<string>();
  private mouseButtons = 0;
  private lookX = 0;
  private lookY = 0;
  private sprintToggled = false;
  /** Aim as a toggle (setting `holdToAim` off): flipped by a press of the aim control. */
  private aimToggled = false;
  /** Buttons pressed since the last sample: a tap shorter than one 33 ms step must still register. */
  private latched = 0;
  /** Set true whenever the last meaningful input came from a pad (drives UI glyphs). */
  usingGamepad = false;
  onToggleDebug: (() => void) | undefined;
  /** Switch between first and third person. V is taken (melee), so the keyboard key is the bound view key; on a pad it is a HOLD of the bound control (R3). */
  onToggleView: (() => void) | undefined;
  /** HOLD the Command action (T, or the d-pad's down) to open the wheel for the hired hands: `down` on press, `up` on release. The game owns what opens. */
  onCommand: ((phase: "down" | "up") => void) | undefined;
  /** While the wheel is open the number keys belong to it (not the weapon slots) and the pad's right stick is its pointer, not the camera. */
  wheelOpen = false;
  /** The right stick as last read (shaped; x right, y DOWN), for the wheel; zero when idle. */
  padStick: Stick2 = { x: 0, y: 0 };
  /** The left stick as last read (shaped). */
  readonly padMove: Stick2 = { x: 0, y: 0 };
  /**
   * Is there something in reach the Use control would act on (a prop, a downed comrade, a station, a horse)? The game sets it from the same rules as its prompt. While it says no, a tap of the pad's
   * Use control reloads. Unwired it says yes, so a tap is Use and a hold is Reload: never the two at once (the old "X does both" fiddliness).
   */
  canInteract: () => boolean = () => true;
  /** D-068: what the player can do this frame (the touch overlay shows only those buttons). Undefined: every button stays. */
  touchContext: () => TouchContext | undefined = () => undefined;
  /** The thing in reach is a HOLD (revive, dress a wound): holding Use keeps Use down instead of reloading. */
  holdInteract: () => boolean = () => false;
  /** Multiplier on the pad's look speed from the aim assist (1 = none); the game writes it every frame from `assistLook().slow`. */
  lookSlow = 1;
  private isBlocked = false;
  /** The weapon the player wants in hand: a `WEAPON` id, or -1 for empty hands. Keys 1-5, the wheel and the d-pad change it; the game sends it with every input frame and the server has the final say. */
  weaponWish: WeaponId | -1 = -1;

  /** The touch player asked for the pause sheet (the on-screen PAUSE button; the keyboard has Escape and the pad Start). */
  onPause: (() => void) | undefined;
  /** Set true while the last meaningful input came from the touch overlay (the aim assist serves it as it serves a pad). */
  usingTouch = false;

  // touch reader state (D-049): the overlay reports fingers, the rules are here beside the pad's
  private touch: TouchSource | undefined;
  private readonly tg = {} as Record<TouchButton, Gesture>;
  private touchSeen = false;
  private touchHeld = 0;
  private touchAim = false;
  private touchCrouch = false;
  private touchUseUsable = false;
  private touchOrdersWas = false;
  /** The touch stick as last read (x right, y DOWN), for the step. */
  readonly touchMove: Stick2 = { x: 0, y: 0 };

  // pad reader state
  private readonly gest = {} as Record<PadButton, Gesture>;
  private padHeld = 0;
  private padFresh = false;
  private useWasUsable = false;
  private padSeen = false;
  private commandPadWas = false;
  private sprintGate = false;
  private readonly rawL: Stick2 = { x: 0, y: 0 };
  private readonly rawR: Stick2 = { x: 0, y: 0 };

  /**
   * While an overlay (pause, settings, how-to) is up the game keeps running for everyone else, but this player's hands are off the controls:
   * no movement, no buttons, no look. Setting it also drops every held key so nothing is stuck when the overlay closes.
   */
  get blocked(): boolean {
    return this.isBlocked;
  }
  set blocked(on: boolean) {
    this.isBlocked = on;
    if (on) {
      this.keys.clear();
      this.mouseButtons = 0;
      this.lookX = 0;
      this.lookY = 0;
      this.latched = 0;
      this.padHeld = 0;
      this.aimToggled = false;
      for (const b of PAD_BUTTONS) this.gest[b].reset();
      for (const b of TOUCH_BUTTONS) this.tg[b].reset();
      this.touchHeld = 0;
      this.touchAim = false;
      this.touchCrouch = false;
    }
  }

  constructor(
    private readonly canvas: HTMLCanvasElement,
    readonly settings: ControlSettings,
  ) {
    for (const b of PAD_BUTTONS) this.gest[b] = new Gesture();
    for (const b of TOUCH_BUTTONS) this.tg[b] = new Gesture();
    wireGlyphPreference();
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.usingGamepad = false;
      this.usingTouch = false;
      deviceTracker.note("keyboard");
      this.latched |= tapButtonFor(e.code); // keys whose press must never be lost between two input samples (bindings.ts)
      if (e.code === "F3") {
        e.preventDefault();
        this.onToggleDebug?.();
      }
      const action = actionForCode(e.code);
      if (action === "view" && !isTextEntry(e.target)) this.onToggleView?.();
      if (action === "command" && !this.isBlocked && !isTextEntry(e.target) && !this.commandKeyDown) {
        this.commandKeyDown = true;
        this.onCommand?.("down");
      }
      if (!this.isBlocked && !this.wheelOpen && !isTextEntry(e.target)) this.weaponKey(e.code);
      if (action === "sprint" && !this.settings.holdToSprint) this.sprintToggled = !this.sprintToggled;
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
      if (this.commandKeyDown && actionForCode(e.code) === "command") {
        this.commandKeyDown = false;
        this.onCommand?.("up");
      }
    });
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.mouseButtons = 0;
      if (this.commandKeyDown) {
        this.commandKeyDown = false;
        this.onCommand?.("up");
      }
    });
    canvas.addEventListener("mousedown", (e) => {
      // a touch also fires a "compatibility" mouse event: it is not a mouse (no pointer lock on a phone, and never a shot at a tap on the scenery)
      if ((e as MouseEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }).sourceCapabilities?.firesTouchEvents) return;
      if (document.pointerLockElement !== canvas) void canvas.requestPointerLock?.();
      this.mouseButtons |= 1 << e.button;
      this.usingGamepad = false;
      this.usingTouch = false;
      deviceTracker.note("keyboard");
      if (e.button === 0 && !this.isBlocked) this.latched |= BUTTON.FIRE; // a click shorter than one input step must still be a shot
      if (e.button === 2 && !this.isBlocked && !getHoldToAim()) this.aimToggled = !this.aimToggled;
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        if (this.isBlocked || Math.abs(e.deltaY) < 1) return;
        e.preventDefault();
        this.cycleWeapon(e.deltaY > 0 ? 1 : -1);
      },
      { passive: false },
    );
    window.addEventListener("mouseup", (e) => (this.mouseButtons &= ~(1 << e.button)));
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("mousemove", (e) => {
      if (document.pointerLockElement !== canvas) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
      this.usingGamepad = false;
      this.usingTouch = false;
      deviceTracker.note("keyboard");
    });
  }

  private commandKeyDown = false;

  private pad(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) if (p?.connected && p.mapping === "standard") return p;
    return null;
  }

  /** Haptics on the pad in use (shots, hits, being hurt, blasts), if the player has them on and the browser can. `scale` 0..1 weakens it (a blast far away). */
  rumble(kind: RumbleKind, scale = 1): void {
    if (this.isBlocked || !getPadRumble()) return;
    rumble(this.pad(), kind, scale);
  }

  /** The assist is on for this player and this input: a pad or a thumb on glass (never for the mouse). */
  get assistOn(): boolean {
    return (this.usingGamepad || this.usingTouch) && getAimAssist();
  }

  /** Plugs in the touch overlay (D-049). Its fingers become the same intent as the pad's, by the same rules. */
  attachTouch(t: TouchSource): void {
    this.touch = t;
  }

  /** Reads the touch overlay once a frame (beside `pollPad`): gestures for every on-screen button, the stick, and the events (weapon, orders, view, pause). */
  private pollTouch(dt: number): void {
    const t = this.touch;
    if (!t || !t.active) {
      if (this.touchSeen) for (const b of TOUCH_BUTTONS) this.tg[b].reset();
      this.touchSeen = false;
      this.touchHeld = 0;
      this.touchMove.x = this.touchMove.y = 0;
      if (this.touchOrdersWas) {
        this.touchOrdersWas = false;
        this.onCommand?.("up");
      }
      return;
    }
    this.touchSeen = true;
    t.showUse?.(this.canInteract());
    const ctx = this.touchContext();
    if (ctx) t.showContext?.(ctx);
    const g = this.tg;
    let any = t.move.x !== 0 || t.move.y !== 0;
    const tapped = t.takePressed?.() ?? 0; // (a press already let go still counts as down for this one read: the next read lets go, a tap)
    for (let i = 0; i < TOUCH_BUTTONS.length; i++) {
      const b = TOUCH_BUTTONS[i]!;
      if (g[b].update((t.down[b] || (tapped & (1 << i)) !== 0) && !this.isBlocked, dt).pressed) any = true;
    }
    if (any) {
      this.usingTouch = true;
      this.usingGamepad = false;
      deviceTracker.note("touch");
    }
    this.touchMove.x = t.move.x;
    this.touchMove.y = t.move.y;
    if (this.isBlocked) {
      this.touchHeld = 0;
      return;
    }
    let held = 0;
    for (const [b, bit] of [["fire", BUTTON.FIRE], ["jump", BUTTON.JUMP], ["melee", BUTTON.MELEE], ["grab", BUTTON.GRAB], ["throw", BUTTON.THROW]] as const) {
      if (g[b].held) held |= bit;
      if (g[b].pressed) this.latched |= bit; // (a tap shorter than one input step still counts)
    }
    // a thumb cannot hold aim and crouch while it steers: both are toggles on glass
    if (g.aim.pressed) this.touchAim = !this.touchAim;
    if (this.touchAim) held |= BUTTON.AIM;
    if (g.crouch.pressed) this.touchCrouch = !this.touchCrouch;
    if (this.touchCrouch) held |= BUTTON.CROUCH;
    if (stickRuns(t.move)) held |= BUTTON.SPRINT;
    // use / reload: the pad's rule exactly (a tap uses what is in reach, else reloads; a hold reloads unless the thing in reach is itself a hold)
    const useG = g.use;
    if (useG.pressed) {
      this.touchUseUsable = this.canInteract();
      this.latched |= this.touchUseUsable ? BUTTON.INTERACT : BUTTON.RELOAD;
    }
    if (useG.held) {
      const holdUse = this.touchUseUsable && this.holdInteract();
      if (holdUse || (this.touchUseUsable && useG.heldFor < useG.holdS)) held |= BUTTON.INTERACT;
      if (useG.holdFired && !holdUse && this.touchUseUsable) this.latched |= BUTTON.RELOAD;
    }
    // arms: a tap is the next weapon, a hold puts it away
    if (g.weapon.tapped) this.cycleWeapon(1);
    if (g.weapon.holdFired) this.weaponWish = -1;
    const orders = g.orders.held;
    if (orders !== this.touchOrdersWas) {
      this.touchOrdersWas = orders;
      this.onCommand?.(orders ? "down" : "up");
    }
    if (g.view.pressed) this.onToggleView?.();
    if (g.pause.pressed) this.onPause?.();
    this.touchHeld = held;
  }

  /**
   * Reads the pad once (called by `drainLook` each frame, and by `sample` if no frame has read it since): shapes the sticks, advances every button's gesture and turns the gestures into
   * held bits, latched taps and the view / command / weapon events.
   */
  private pollPad(dt: number): void {
    const p = this.pad();
    this.padFresh = true;
    if (!p) {
      if (this.padSeen) for (const b of PAD_BUTTONS) this.gest[b].reset();
      this.padSeen = false;
      this.padHeld = 0;
      this.padMove.x = this.padMove.y = 0;
      this.padStick.x = this.padStick.y = 0;
      if (this.commandPadWas) {
        this.commandPadWas = false;
        this.onCommand?.("up");
      }
      return;
    }
    this.padSeen = true;
    const dead = getPadDeadzone();
    const curve = getPadCurve();
    shapeStick(p.axes[0] ?? 0, p.axes[1] ?? 0, dead, curve, this.padMove);
    shapeStick(p.axes[2] ?? 0, p.axes[3] ?? 0, dead, curve, this.padStick);
    const g = this.gest;
    let any = this.padMove.x !== 0 || this.padMove.y !== 0 || this.padStick.x !== 0 || this.padStick.y !== 0;
    for (const name of PAD_BUTTONS) {
      const btn = p.buttons[PAD_INDEX[name]];
      const down = !!btn && (btn.pressed || btn.value > 0.4);
      const gs = g[name].update(down && !this.isBlocked, dt);
      if (gs.pressed) any = true;
    }
    if (any) {
      this.usingGamepad = true;
      this.usingTouch = false;
      deviceTracker.note(padFamily(p.id));
    }
    if (this.isBlocked) {
      this.padHeld = 0;
      return;
    }

    const b = getPadBindings();
    let held = 0;
    for (const a of ["jump", "crouch", "melee", "throw", "grab", "fire"] as const) if (g[b[a]].held) held |= HELD_BUTTON[a]!;
    for (const a of TAP_BUTTON) if (g[b[a]].pressed) this.latched |= HELD_BUTTON[a]!;

    // aim: held, or a toggle
    const aimG = g[b.aim];
    if (!getHoldToAim() && aimG.pressed) this.aimToggled = !this.aimToggled;
    if (getHoldToAim() ? aimG.held : this.aimToggled) held |= BUTTON.AIM;

    // sprint: hold (or toggle when the player prefers it) on the stick click
    const sprintG = g[b.sprint];
    if (this.settings.holdToSprint) {
      if (sprintG.held) held |= BUTTON.SPRINT;
    } else {
      if (sprintG.pressed) this.sprintToggled = !this.sprintToggled;
    }

    // use / reload: one control, two jobs, decided by what is in reach
    const useG = g[b.interact];
    if (useG.pressed) {
      this.useWasUsable = this.canInteract();
      if (this.useWasUsable) this.latched |= BUTTON.INTERACT;
      else this.latched |= BUTTON.RELOAD;
    }
    if (useG.held) {
      const holdUse = this.useWasUsable && this.holdInteract();
      if (holdUse || (this.useWasUsable && useG.heldFor < useG.holdS)) held |= BUTTON.INTERACT; // revive / dress keeps Use down; a tap is just the press
      if (useG.holdFired && !holdUse && this.useWasUsable) this.latched |= BUTTON.RELOAD; // a hold always reloads, even beside a pickup
    }

    // view: a deliberate HOLD, never an accidental press
    if (g[b.view].holdFired) this.onToggleView?.();

    // d-pad: left / right cycle the weapons, up holsters, down holds the command wheel
    if (g.left.pressed) this.cycleWeapon(-1);
    if (g.right.pressed) this.cycleWeapon(1);
    if (g.up.pressed) this.weaponWish = -1;
    const cmd = g.down.held;
    if (cmd !== this.commandPadWas) {
      this.commandPadWas = cmd;
      this.onCommand?.(cmd ? "down" : "up");
    }
    this.padHeld = held;
  }

  /** Drains accumulated look input. Mouse is in pixels (scaled by sensitivity in CameraRig); pad in pixel-equivalents. */
  drainLook(dt: number): [number, number] {
    let dx = this.lookX;
    let dy = this.lookY;
    this.lookX = 0;
    this.lookY = 0;
    if (this.isBlocked) {
      this.pollPad(dt); // keeps the gestures current so a button held when the sheet closes is not a fresh press
      this.pollTouch(dt);
      this.touch?.takeLook(); // (a drag across a sheet is not a turn)
      return [0, 0];
    }
    this.pollPad(dt);
    this.pollTouch(dt);
    if (this.touchSeen && this.touch) {
      // a drag on glass, in mouse pixels (the camera's sensitivity multiplies it like the mouse's); on the wheel it is the pointer
      const [tx, ty] = this.touch.takeLook();
      dx += tx * TOUCH.lookScale;
      dy += ty * TOUCH.lookScale;
    }
    const aiming = this.aiming;
    if (aiming) {
      dx *= AIM.look.mouseScale;
      dy *= AIM.look.mouseScale;
    }
    if (this.padSeen) {
      if (this.wheelOpen) return [dx, dy]; // the wheel's pointer, not the camera
      // Pad look is in "pixel-equivalents per second" so one sensitivity scale serves both devices.
      const k = 900 * this.settings.padSensitivity * dt * (aiming ? getPadAimSensitivity() : 1) * this.lookSlow;
      dx += this.padStick.x * k;
      dy += this.padStick.y * k;
    }
    return [dx, dy];
  }

  sample(): Intent {
    const k = this.keys;
    if (this.blocked) {
      this.latched = 0;
      this.padFresh = false;
      return { moveF: 0, moveR: 0, buttons: 0 };
    }
    if (!this.padFresh) {
      this.pollPad(0);
      this.pollTouch(0);
    }
    this.padFresh = false;
    let f = (isHeld(k, "forward") ? 1 : 0) - (isHeld(k, "back") ? 1 : 0);
    let r = (isHeld(k, "right") ? 1 : 0) - (isHeld(k, "left") ? 1 : 0);
    // Held keys -> wire buttons through the rebindable table (bindings.ts). Sprint may be a toggle instead of a hold.
    let buttons = heldButtons(k) & ~BUTTON.SPRINT;
    if (this.settings.holdToSprint ? isHeld(k, "sprint") : this.sprintToggled) buttons |= BUTTON.SPRINT;
    if (this.mouseButtons & 1) buttons |= BUTTON.FIRE;
    if (getHoldToAim() ? (this.mouseButtons & 4) !== 0 : this.aimToggled) buttons |= BUTTON.AIM;

    if (this.padSeen) {
      const sx = this.padMove.x;
      const sy = this.padMove.y;
      if (sx || sy) {
        r = sx;
        f = -sy;
      }
      buttons |= this.padHeld;
      if (!this.settings.holdToSprint && this.sprintToggled) buttons |= BUTTON.SPRINT;
    }
    if (this.touchSeen) {
      const tx = this.touchMove.x;
      const ty = this.touchMove.y;
      if (tx || ty) {
        r = tx;
        f = -ty;
      }
      buttons |= this.touchHeld;
    }
    buttons |= this.latched;
    this.latched = 0;
    const m = Math.hypot(f, r);
    if (m > 1) {
      f /= m;
      r /= m;
    }
    return { moveF: axisToWire(clamp(f, -1, 1)), moveR: axisToWire(clamp(r, -1, 1)), buttons };
  }

  private weaponKey(code: string): void {
    const m = /^Digit([0-9])$/.exec(code);
    if (m) {
      const n = Number(m[1]);
      if (n === 0) this.weaponWish = -1;
      else if (n <= CARRIED.length) this.weaponWish = this.weaponWish === CARRIED[n - 1] ? -1 : CARRIED[n - 1]!; // pressing the drawn weapon's key puts it away
    } else if (code === "Backquote") this.weaponWish = -1;
  }

  /** Next (+1) or previous (-1) weapon, with empty hands as one more stop. */
  cycleWeapon(dir: 1 | -1): void {
    const ring: (WeaponId | -1)[] = [-1, ...CARRIED];
    const i = ring.indexOf(this.weaponWish);
    this.weaponWish = ring[(i + dir + ring.length) % ring.length]!;
  }

  /** Aiming now: the right mouse button or the pad's aim control, held (or toggled when the player chose that). */
  get aiming(): boolean {
    if (this.isBlocked) return false;
    const touch = this.touchSeen && this.touchAim; // (aim on glass is always a toggle)
    if (!getHoldToAim()) return this.aimToggled || touch;
    return (this.mouseButtons & 4) !== 0 || (this.padHeld & BUTTON.AIM) !== 0 || touch;
  }
}
