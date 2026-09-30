import { BUTTON, CARRIED, axisToWire, clamp, type WeaponId } from "@cb/shared";
import { actionForCode, heldButtons, isHeld, tapButtonFor } from "./bindings.ts";

/** A sampled intent for one fixed simulation step. */
export interface Intent {
  moveF: number;
  moveR: number;
  buttons: number;
}

const DEADZONE = 0.18;

/** Default keyboard key that toggles first/third person (V is melee). The live key comes from the bindings (input/bindings.ts) and can be rebound. */
export const VIEW_KEY = "KeyX";
/** Standard-mapping gamepad button that toggles it: R3, the right stick click (Y is melee, and the face buttons and bumpers are all bound). */
export const VIEW_PAD_BUTTON = 11;

const isTextEntry = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** Radial deadzone with rescale, so slow sticks stay precise and never drift. */
function stick(x: number, y: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m < DEADZONE) return [0, 0];
  const s = Math.min(1, (m - DEADZONE) / (1 - DEADZONE)) / m;
  return [x * s, y * s];
}

export interface ControlSettings {
  sensitivity: number;
  padSensitivity: number;
  holdToSprint: boolean;
}

/**
 * Keyboard + mouse and gamepad, treated as equals. Look deltas are accumulated between frames
 * and drained by the camera; movement/buttons are sampled once per fixed input step.
 */
export class Controls {
  private keys = new Set<string>();
  private mouseButtons = 0;
  private lookX = 0;
  private lookY = 0;
  private sprintToggled = false;
  /** Buttons pressed since the last sample: a tap shorter than one 33 ms step must still register. */
  private latched = 0;
  /** Set true whenever the last meaningful input came from a pad (drives UI glyphs). */
  usingGamepad = false;
  onToggleDebug: (() => void) | undefined;
  /** Switch between first and third person. V is taken (melee), so the keyboard key is VIEW_KEY; on a pad it is a click of the right stick. */
  onToggleView: (() => void) | undefined;
  private viewPadWas = false;
  private isBlocked = false;
  /** The weapon the player wants in hand: a `WEAPON` id, or -1 for empty hands. Keys 1-5, the wheel and the d-pad change it; the game sends it with every input frame and the server has the final say. */
  weaponWish: WeaponId | -1 = -1;
  private padWas = 0;

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
    }
  }

  constructor(
    private readonly canvas: HTMLCanvasElement,
    readonly settings: ControlSettings,
  ) {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.usingGamepad = false;
      this.latched |= tapButtonFor(e.code); // keys whose press must never be lost between two input samples (bindings.ts)
      if (e.code === "F3") {
        e.preventDefault();
        this.onToggleDebug?.();
      }
      const action = actionForCode(e.code);
      if (action === "view" && !isTextEntry(e.target)) this.onToggleView?.();
      if (!this.isBlocked && !isTextEntry(e.target)) this.weaponKey(e.code);
      if (action === "sprint" && !this.settings.holdToSprint) this.sprintToggled = !this.sprintToggled;
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.mouseButtons = 0;
    });
    canvas.addEventListener("mousedown", (e) => {
      if (document.pointerLockElement !== canvas) void canvas.requestPointerLock?.();
      this.mouseButtons |= 1 << e.button;
      if (e.button === 0 && !this.isBlocked) this.latched |= BUTTON.FIRE; // a click shorter than one input step must still be a shot
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
    });
  }

  private pad(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) if (p?.connected && p.mapping === "standard") return p;
    return null;
  }

  /** Drains accumulated look input. Mouse is in pixels (scaled by sensitivity in CameraRig); pad in rad/s-ish. */
  drainLook(dt: number): [number, number] {
    let dx = this.lookX;
    let dy = this.lookY;
    this.lookX = 0;
    this.lookY = 0;
    if (this.isBlocked) return [0, 0];
    const p = this.pad();
    // Edge-triggered so holding the stick down toggles once.
    const viewNow = p?.buttons[VIEW_PAD_BUTTON]?.pressed ?? false;
    if (viewNow && !this.viewPadWas) {
      this.usingGamepad = true;
      this.onToggleView?.();
    }
    this.viewPadWas = viewNow;
    if (p && !this.isBlocked) {
      // d-pad: left / right cycle the weapons, up holsters (edge-triggered)
      const bits = (p.buttons[14]?.pressed ? 1 : 0) | (p.buttons[15]?.pressed ? 2 : 0) | (p.buttons[12]?.pressed ? 4 : 0);
      const fresh = bits & ~this.padWas;
      this.padWas = bits;
      if (fresh & 1) this.cycleWeapon(-1);
      if (fresh & 2) this.cycleWeapon(1);
      if (fresh & 4) this.weaponWish = -1;
      if (fresh) this.usingGamepad = true;
    }
    if (p) {
      const [rx, ry] = stick(p.axes[2] ?? 0, p.axes[3] ?? 0);
      if (rx || ry) this.usingGamepad = true;
      // Pad look is in "pixel-equivalents per second" so one sensitivity scale serves both devices.
      const k = 900 * this.settings.padSensitivity * dt;
      dx += rx * k;
      dy += ry * k;
    }
    return [dx, dy];
  }

  sample(): Intent {
    const k = this.keys;
    if (this.blocked) {
      this.latched = 0;
      return { moveF: 0, moveR: 0, buttons: 0 };
    }
    let f = (isHeld(k, "forward") ? 1 : 0) - (isHeld(k, "back") ? 1 : 0);
    let r = (isHeld(k, "right") ? 1 : 0) - (isHeld(k, "left") ? 1 : 0);
    // Held keys -> wire buttons through the rebindable table (bindings.ts). Sprint may be a toggle instead of a hold.
    let buttons = heldButtons(k) & ~BUTTON.SPRINT;
    if (this.settings.holdToSprint ? isHeld(k, "sprint") : this.sprintToggled) buttons |= BUTTON.SPRINT;
    if (this.mouseButtons & 1) buttons |= BUTTON.FIRE;
    if (this.mouseButtons & 4) buttons |= BUTTON.AIM;

    const p = this.pad();
    if (p) {
      const [sx, sy] = stick(p.axes[0] ?? 0, p.axes[1] ?? 0);
      if (sx || sy) {
        this.usingGamepad = true;
        r = sx;
        f = -sy;
      }
      const b = (i: number) => p.buttons[i]?.pressed ?? false;
      if (b(0)) buttons |= BUTTON.JUMP;
      if (b(1)) buttons |= BUTTON.CROUCH;
      if (b(2)) buttons |= BUTTON.INTERACT | BUTTON.RELOAD;
      if (b(3)) buttons |= BUTTON.MELEE;
      if (b(4)) buttons |= BUTTON.THROW;
      if (b(5)) buttons |= BUTTON.GRAB; // RB
      if (b(6) || (p.buttons[6]?.value ?? 0) > 0.4) buttons |= BUTTON.AIM;
      if (b(7) || (p.buttons[7]?.value ?? 0) > 0.4) buttons |= BUTTON.FIRE;
      if (b(10)) buttons |= BUTTON.SPRINT;
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

  get aiming(): boolean {
    const p = this.pad();
    return (this.mouseButtons & 4) !== 0 || (p?.buttons[6]?.pressed ?? false);
  }
}
