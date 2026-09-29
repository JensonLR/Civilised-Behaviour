import { BUTTON, axisToWire, clamp } from "@cb/shared";

/** A sampled intent for one fixed simulation step. */
export interface Intent {
  moveF: number;
  moveR: number;
  buttons: number;
}

const DEADZONE = 0.18;

/** Keys whose press must never be lost between two fixed input samples. */
const TAP_BUTTONS: Record<string, number> = {
  Space: BUTTON.JUMP,
  KeyE: BUTTON.INTERACT,
  KeyR: BUTTON.RELOAD,
  KeyV: BUTTON.MELEE,
  KeyG: BUTTON.THROW,
};

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

  constructor(
    private readonly canvas: HTMLCanvasElement,
    readonly settings: ControlSettings,
  ) {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.usingGamepad = false;
      this.latched |= TAP_BUTTONS[e.code] ?? 0;
      if (e.code === "F3") {
        e.preventDefault();
        this.onToggleDebug?.();
      }
      if (e.code === "ShiftLeft" && !this.settings.holdToSprint) this.sprintToggled = !this.sprintToggled;
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.mouseButtons = 0;
    });
    canvas.addEventListener("mousedown", (e) => {
      if (document.pointerLockElement !== canvas) void canvas.requestPointerLock?.();
      this.mouseButtons |= 1 << e.button;
    });
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
    const p = this.pad();
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
    let f = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    let r = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    let buttons = 0;

    const sprintKey = this.settings.holdToSprint ? k.has("ShiftLeft") : this.sprintToggled;
    if (sprintKey) buttons |= BUTTON.SPRINT;
    if (k.has("ControlLeft") || k.has("KeyC")) buttons |= BUTTON.CROUCH;
    if (k.has("Space")) buttons |= BUTTON.JUMP;
    if (k.has("KeyE")) buttons |= BUTTON.INTERACT;
    if (k.has("KeyR")) buttons |= BUTTON.RELOAD;
    if (k.has("KeyV")) buttons |= BUTTON.MELEE;
    if (k.has("KeyG")) buttons |= BUTTON.THROW;
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

  get aiming(): boolean {
    const p = this.pad();
    return (this.mouseButtons & 4) !== 0 || (p?.buttons[6]?.pressed ?? false);
  }
}
