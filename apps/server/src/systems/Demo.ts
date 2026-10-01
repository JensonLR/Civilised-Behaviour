import { DEMO, DEMO_OVER_TEXT, DEMO_REFUSED_TEXT, demoWarnText, isDemoRegion, isRegionId } from "@cb/shared";

/**
 * The bounded web demo, enforced by the SERVER (D-036, package D). A demo is a configuration of the one game: the same room, the same rules, with four things added here and
 * nothing forked: a region gate (Hollowmere and Kessar only), warnings at 10 and 2 minutes left, a hard close at 0 (every client gets `DEMO.closeCode`, which the client reads as
 * "show the wishlist card"), and no persistence at all (the room binds no saver and refuses `resume` when a demo is configured; this class never touches a store). The
 * client only SHOWS the countdown; it enforces nothing, so editing the client cannot extend a session.
 *
 * Pure of I/O: everything it does goes through the host (a clock, a notice, a close), so it is tested on a fake host with a fake clock.
 */
export interface DemoHost {
  now(): number;
  startedAtMs: number;
  notice(text: string): void;
  closeAll(code: number): void;
}

export interface DemoConfig {
  enabled: boolean;
  /** Seconds a demo room lasts: `DEMO.sessionMinutes * 60`, or the test override (never outside development/test). */
  sessionSeconds: number;
}

const FULL = DEMO.sessionMinutes * 60;
const TRUE = new Set(["1", "true", "yes", "on"]);

/**
 * `DEMO_MODE` (1/true/yes/on, anything else, including garbage, means off: a demo is never switched on by accident) and `DEMO_SESSION_SECONDS` (an integer 5..FULL; honoured ONLY when
 * `NODE_ENV` is not production, so a production demo can never be shortened or lengthened by a stray variable). Never throws.
 */
export function parseDemoEnv(env: Readonly<Record<string, string | undefined>>): DemoConfig {
  const raw = env.DEMO_MODE;
  const enabled = typeof raw === "string" && raw.length <= 8 && TRUE.has(raw.trim().toLowerCase());
  let sessionSeconds = FULL;
  const o = env.DEMO_SESSION_SECONDS;
  if (enabled && env.NODE_ENV !== "production" && typeof o === "string" && /^\d{1,5}$/.test(o.trim())) {
    const n = Number(o.trim());
    if (n >= 5 && n <= FULL) sessionSeconds = n;
  }
  return { enabled, sessionSeconds };
}

const REFUSE_EVERY_MS = 4000;

export class Demo {
  /** Demo campaigns are never saved and never resumed. The room checks this before it touches a store. */
  readonly persists = DEMO.persist;
  private readonly endMs: number;
  /** The warnings (seconds left) that are still to be sent, most distant first. */
  private readonly pending: number[];
  private over = false;
  private lastRefusedMs = -Infinity;

  constructor(private readonly host: DemoHost, opts: { sessionSeconds?: number } = {}) {
    const s = opts.sessionSeconds;
    const seconds = typeof s === "number" && Number.isFinite(s) && s >= 1 && s <= FULL ? s : FULL;
    this.endMs = host.startedAtMs + seconds * 1000;
    // A warning is only useful (and only true) when it is shorter than the whole session.
    this.pending = DEMO.warnAtMinutes.map((m) => m * 60).filter((w) => w < seconds);
  }

  get ended(): boolean {
    return this.over;
  }

  /** Whole seconds left (never negative). */
  remainingS(): number {
    return Math.max(0, Math.ceil((this.endMs - this.host.now()) / 1000));
  }

  /** Called every server tick: cheap. Sends each warning once, then closes every client once. */
  tick(): void {
    if (this.over) return;
    const left = (this.endMs - this.host.now()) / 1000;
    if (!(left > 0)) {
      this.over = true;
      this.pending.length = 0;
      this.host.notice(DEMO_OVER_TEXT);
      this.host.closeAll(DEMO.closeCode);
      return;
    }
    let due = -1;
    while (this.pending.length > 0 && left <= this.pending[0]!) due = this.pending.shift()!;
    // Several thresholds crossed at once (a stalled process): only the most urgent warning is worth sending, and each is still sent at most once.
    if (due >= 0) this.host.notice(demoWarnText(Math.round(due / 60)));
  }

  /**
   * May a party sail to `to`? True only for a real demo region. A real region outside the demo (Highmark, and every later one) is refused WITH a notice (at most one every four
   * seconds); a forged or unknown value is refused silently. Always false once the session is over.
   */
  regionAllowed(to: unknown): boolean {
    if (this.over) return false;
    if (isDemoRegion(to)) return true;
    if (isRegionId(to)) {
      const t = this.host.now();
      if (t - this.lastRefusedMs >= REFUSE_EVERY_MS) {
        this.lastRefusedMs = t;
        this.host.notice(DEMO_REFUSED_TEXT);
      }
    }
    return false;
  }
}
