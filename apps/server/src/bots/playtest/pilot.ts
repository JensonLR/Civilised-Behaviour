import {
  BUTTON, COMBAT, FLAG, NavQuery, buildNavGrid, isRegionId, newNavPath, newWorldHit, rayWorld, regionNavOptions,
  type JoinOptions, type NavPath, type ParleyView, type PlayerStateType, type RegionId,
} from "@cb/shared";
import { Bot, aimAt, type BotFrame } from "../Bot.ts";

/**
 * A scripted PLAYER for the playtest harness (D-040): it walks where a person would walk (A* over the region's own nav grid, through the real input path and
 * the shared step), presses Use where a person would press it, carries what a person would carry, answers parleys by the words on the buttons, draws, aims and
 * fires. Everything goes through the same messages a browser sends; nothing is teleported unless a plan says so. A plan is an async script over these verbs;
 * the pilot records what a player would have seen (the notices, the objectives ticking off, the health it lost, the ending) with timestamps.
 */

export interface Timeline {
  t: number;
  what: string;
}

const heading = (x: number, z: number, tx: number, tz: number): number => Math.atan2(-(tx - x), -(tz - z));

export class Pilot {
  readonly frame: BotFrame = { moveF: 0, moveR: 0, yaw: 0, buttons: 0, weapon: -1 };
  bot!: Bot;
  readonly log: Timeline[] = [];
  readonly notices: string[] = [];
  parley: ParleyView | undefined;
  parleyLines: string[] = [];
  private readonly t0 = Date.now();
  private goal: { x: number; z: number; within: number; sprint: boolean } | undefined;
  private path: NavPath = newNavPath();
  private pathAt = 0;
  private wp = 0;
  private nav: NavQuery | undefined;
  private navKey = "";
  private pulse = 0;
  private hold = 0;
  private aimAtPoint: { x: number; y: number; z: number } | undefined;
  private lastObjectives = "";
  minHealth = 100;
  downs = 0;
  private wasDown = false;
  stuckFor = 0;
  private lastPos = { x: 0, z: 0, t: 0 };

  constructor(readonly name: string) {}

  get secs(): number {
    return (Date.now() - this.t0) / 1000;
  }

  note(what: string): void {
    this.log.push({ t: Math.round(this.secs * 10) / 10, what });
  }

  async join(url: string, opts: Partial<JoinOptions>): Promise<void> {
    this.bot = await Bot.create(url, this.name, (tick, self) => this.step(tick, self), opts);
    const room = this.bot.room;
    room.onMessage("notice", (m: { text: string }) => {
      this.notices.push(m.text);
      this.note(`NOTICE ${m.text}`);
    });
    room.onMessage("parley", (m: { view?: ParleyView; line?: string; closed?: boolean }) => {
      if (m.view) {
        this.parley = m.view;
        this.note(`PARLEY ${m.view.speaker}: "${m.view.line}" [${m.view.options.map((o, i) => `${i}:${o.label}`).join(" | ")}]`);
      }
      if (m.line) this.parleyLines.push(m.line);
      if (m.closed) {
        this.parley = undefined;
        this.note(`PARLEY closed${m.line ? `: "${m.line}"` : ""}`);
      }
    });
    // who shoots, and who is hit: the first lines of every exchange of fire go in the log (a player sees the smoke and feels the blow)
    let shotsLogged = 0;
    room.onMessage("shot", (m: { id: string; x: number; z: number }) => {
      if (shotsLogged++ < 12) this.note(`SHOT by ${m.id === room.sessionId ? "ME" : m.id} from ${m.x.toFixed(0)},${m.z.toFixed(0)}`);
    });
    room.onMessage("hit", (m: { id: string; zone: number; down: boolean; power: number }) => {
      if (m.id === room.sessionId) this.note(`HIT ME zone ${m.zone} power ${m.power.toFixed(2)}${m.down ? " DOWN" : ""} (health ${this.me?.health})`);
      else this.note(`HIT ${m.id}${m.down ? " DOWN" : ""}`);
    });
    for (const t of ["sever", "impact", "boom", "hitmark", "station", "saved", "travel", "pong", "wish"]) room.onMessage(t, () => undefined);
    room.onMessage("*", () => undefined);
    this.bot.start();
    await this.until(() => this.me !== undefined, 5000, "spawn");
    this.note(`joined ${room.state.region} code ${room.state.code}`);
  }

  get me(): PlayerStateType | undefined {
    return this.bot.self;
  }

  get pos(): { x: number; y: number; z: number } {
    const p = this.bot.predicted ?? this.me!;
    return { x: p.x, y: p.y, z: p.z };
  }

  get region(): RegionId {
    const r = this.bot.room.state.region;
    return isRegionId(r) ? r : "hollowmere";
  }

  /** The running contract's view (objectives, hint, resolution). */
  get view(): { phase: string; objectives: { id: string; text: string; done: boolean; optional?: boolean }[]; hint: string; resolution?: string; title: string } | undefined {
    const s = this.bot.room.state.scenario;
    if (!s) return undefined;
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  }

  npc(id: string): PlayerStateType | undefined {
    return this.bot.room.state.players.get(`npc:${id}`);
  }

  npcs(prefix: string): [string, PlayerStateType][] {
    const out: [string, PlayerStateType][] = [];
    this.bot.room.state.players.forEach((p, k) => {
      if (k.startsWith(`npc:${prefix}`)) out.push([k, p]);
    });
    return out;
  }

  private step(_tick: number, self: PlayerStateType): BotFrame {
    const f = this.frame;
    const p = this.bot.predicted ?? self;
    // vitals
    if (self.health < this.minHealth) this.minHealth = self.health;
    const down = (self.flags & FLAG.DOWNED) !== 0;
    if (down && !this.wasDown) {
      this.downs++;
      this.note("DOWNED");
    }
    this.wasDown = down;
    const v = this.view;
    if (v) {
      const sig = v.objectives.map((o) => `${o.done ? "x" : "-"}${o.id}`).join(" ") + ` ${v.phase}${v.resolution ? ` => ${v.resolution}` : ""}`;
      if (sig !== this.lastObjectives) {
        this.lastObjectives = sig;
        this.note(`OBJECTIVES ${sig}`);
      }
    }
    // walking
    f.moveF = 0;
    f.moveR = 0;
    if (this.goal) {
      const g = this.goal;
      const d = Math.hypot(g.x - p.x, g.z - p.z);
      if (d <= g.within) this.goal = undefined;
      else {
        if (this.secs - this.pathAt > 1.5 || this.wp >= this.path.n) this.replan(p.x, p.z);
        let tx = g.x, tz = g.z;
        while (this.wp < this.path.n) {
          const wx = this.path.x[this.wp]!, wz = this.path.z[this.wp]!;
          if (Math.hypot(wx - p.x, wz - p.z) < 1.2 && this.wp < this.path.n - 1) this.wp++;
          else {
            tx = wx;
            tz = wz;
            break;
          }
        }
        f.yaw = heading(p.x, p.z, tx, tz);
        f.moveF = 1;
        // stuck detection
        if (this.secs - this.lastPos.t > 2) {
          const moved = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z);
          this.stuckFor = moved < 0.5 ? this.stuckFor + (this.secs - this.lastPos.t) : 0;
          this.lastPos = { x: p.x, z: p.z, t: this.secs };
          if (this.stuckFor > 2) f.buttons |= BUTTON.JUMP;
        }
      }
    }
    // buttons: a held set, a pulse (pressed for a couple of steps, then released so the server sees an edge)
    let b = this.goal?.sprint ? BUTTON.SPRINT : 0;
    if (this.hold) b |= this.hold;
    if (this.pulse) {
      b |= this.pulse;
      this.pulseTicks--;
      if (this.pulseTicks <= 0) this.pulse = 0;
    }
    f.buttons = b;
    if (this.aimAtPoint) {
      const a = aimAt(p, this.aimAtPoint);
      f.aimYaw = a.aimYaw;
      f.aimElev = a.aimElev;
      if (!this.goal) f.yaw = a.aimYaw;
    } else {
      f.aimYaw = undefined;
      f.aimElev = undefined;
    }
    return f;
  }
  private pulseTicks = 0;

  private replan(x: number, z: number): void {
    const g = this.goal!;
    const world = this.bot.world;
    const key = `${this.region}|${this.bot.room.state.seed}|${(world as unknown as { obstacles?: unknown[] }).obstacles?.length ?? 0}`;
    if (!this.nav || key !== this.navKey) {
      this.nav = new NavQuery(buildNavGrid(world, regionNavOptions(this.region, world)));
      this.navKey = key;
    }
    this.nav.path(x, z, g.x, g.z, this.path);
    this.wp = 0;
    this.pathAt = this.secs;
  }

  sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  async until(cond: () => boolean, ms: number, what: string): Promise<boolean> {
    const end = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > end) {
        this.note(`TIMEOUT waiting for ${what}`);
        return false;
      }
      await this.sleep(50);
    }
    return true;
  }

  /** Walk (or run) to a point by the region's nav grid; resolves when within `within` metres, false after `ms`. */
  async goTo(x: number, z: number, o: { within?: number; sprint?: boolean; ms?: number; label?: string } = {}): Promise<boolean> {
    this.goal = { x, z, within: o.within ?? 1.5, sprint: o.sprint ?? true };
    this.pathAt = -99;
    this.stuckFor = 0;
    const t = this.secs;
    const ok = await this.until(() => this.goal === undefined || (this.me !== undefined && (this.me.flags & FLAG.DOWNED) !== 0), o.ms ?? 90_000, `arrive ${o.label ?? `${x.toFixed(0)},${z.toFixed(0)}`}`);
    const down = this.me !== undefined && (this.me.flags & FLAG.DOWNED) !== 0;
    this.goal = undefined;
    const p = this.pos;
    this.note(`${ok && !down ? "ARRIVED" : "FAILED TO ARRIVE"} ${o.label ?? ""} at ${p.x.toFixed(1)},${p.z.toFixed(1)} after ${(this.secs - t).toFixed(1)}s`);
    return ok && !down;
  }

  /** Face a point (the body turns to the camera's yaw while it stands). */
  async face(x: number, z: number): Promise<void> {
    const p = this.pos;
    this.frame.yaw = heading(p.x, p.z, x, z);
    await this.sleep(400);
  }

  /** One press of a button (held a few input steps so it cannot be lost, then released so the next press is an edge). */
  async press(button: number, label = ""): Promise<void> {
    this.pulse = button;
    this.pulseTicks = 3;
    await this.sleep(250);
    if (label) this.note(`PRESS ${label}`);
  }

  async use(label = "use"): Promise<void> {
    await this.press(BUTTON.INTERACT, label);
  }

  holdButtons(b: number): void {
    this.hold = b;
  }

  /** Answer the open parley by the words on a button. Returns the option index picked, or -1. */
  async pick(re: RegExp): Promise<number> {
    const ok = await this.until(() => this.parley !== undefined, 4000, `parley open for ${re}`);
    if (!ok || !this.parley) return -1;
    const i = this.parley.options.findIndex((o) => re.test(o.label));
    if (i < 0) {
      this.note(`NO OPTION ${re} in [${this.parley.options.map((o) => o.label).join(" | ")}]`);
      return -1;
    }
    this.note(`PICK ${this.parley.options[i]!.label}`);
    const before = this.parley;
    this.bot.room.send("parleyPick", { option: i });
    await this.until(() => this.parley !== before, 4000, "parley answer");
    return i;
  }

  debug(cmd: string): void {
    this.bot.room.send("debug", { cmd });
  }

  /** Weapon in hand (-1 = holster). */
  draw(weapon: number): void {
    this.frame.weapon = weapon;
  }

  aim(at: { x: number; y: number; z: number } | undefined): void {
    this.aimAtPoint = at;
  }

  /** Aim at an actor's chest and fire once (AIM held). Returns true if the round was spent. */
  async shootAt(key: string): Promise<boolean> {
    const target = this.bot.room.state.players.get(key);
    if (!target) return false;
    const me = this.me!;
    const shots0 = me.shots;
    this.aim({ x: target.x, y: target.y + 1.25, z: target.z });
    this.hold = BUTTON.AIM;
    await this.sleep(350);
    const t = this.bot.room.state.players.get(key);
    if (t) this.aim({ x: t.x, y: t.y + 1.25, z: t.z });
    await this.press(BUTTON.FIRE | BUTTON.AIM);
    await this.sleep(150);
    const fired = this.me!.shots !== shots0;
    if (!fired) this.note(`NO SHOT at ${key}: weapon ${this.me!.weapon} ammo ${this.me!.ammo} reserve ${this.me!.reserve} flags ${this.me!.flags}`);
    if (this.me!.ammo === 0) {
      this.hold = 0;
      await this.press(BUTTON.RELOAD);
      await this.until(() => (this.me?.ammo ?? 0) > 0 || (this.me?.reserve ?? 0) === 0, 6000, "reload");
    }
    return fired;
  }

  /** Line of sight from the eye to a point, through the region's solid world (what a player's eyes would allow). */
  canSee(x: number, y: number, z: number): boolean {
    const e = this.pos;
    const ey = e.y + COMBAT.eyeHeight;
    const dx = x - e.x, dy = y - ey, dz = z - e.z;
    const l = Math.hypot(dx, dy, dz);
    if (l < 0.5) return true;
    return !rayWorld(this.bot.world, e.x, ey, e.z, dx / l, dy / l, dz / l, l - 0.4, this.hit);
  }
  private readonly hit = newWorldHit();

  holster(): void {
    this.hold = 0;
    this.aim(undefined);
    this.frame.weapon = -1;
  }

  async leave(): Promise<void> {
    await this.bot.stop();
  }

  summary(): string {
    const v = this.view;
    return `${this.name}: ${v?.resolution ?? "unresolved"} in ${this.secs.toFixed(0)}s, min health ${this.minHealth}, downs ${this.downs}`;
  }
}

export { COMBAT };
