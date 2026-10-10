import {
  BUTTON,
  FLAG,
  STEP_DT,
  axisToWire,
  createCharState,
  stepCharacter,
  yawToWire,
  type CharState,
  type CollisionWorld,
  type MoveCommand,
  type PlayerStateType,
} from "@cb/shared";
import { MOUNT_FLAG } from "@cb/shared";
import { Mounts, type MountRow, type MountRowMap, type MountsHost } from "../systems/Mounts.ts";
import type { BotFrame, Behaviour } from "./Bot.ts";

/**
 * Scripted riders and an in-process room for the mount system. Two things live here:
 *  - `mountRider`: a `Behaviour` for the real `Bot` (mount at the stable, gallop, jump, dismount), for the day the room is wired and a real-room test exists;
 *  - `MountRoom`: the same room loop in miniature (players stepped through the SAME shared steps through the real dispatch, rising-edge INTERACT, the `Mounts` system
 *    ticked after the players), with plain objects for rows and props, so the rules and the netcode of mounting can be tested without the room that is not yet wired.
 *    `NetSim` adds a latency model and a client that predicts and replays exactly as the reconciler does.
 */

// ---- a Behaviour for the real Bot ---------------------------------------------------------------------------------------------------------------------------------

export interface RiderScript {
  /** Tick at which INTERACT is pressed to mount (the bot starts beside the horse). */
  mountAt: number;
  /** Camera yaw to ride along (radians); riding is straight ahead of it. */
  yaw: number;
  /** [from, to) ticks of the gallop (SPRINT held). */
  gallop: [number, number];
  /** Ticks at which JUMP is pressed. */
  jumps: number[];
  /** Tick at which INTERACT is pressed to dismount. */
  dismountAt: number;
}

export const mountRider = (s: RiderScript): Behaviour => (tick): BotFrame => {
  const riding = tick > s.mountAt && tick < s.dismountAt;
  let buttons = 0;
  if (tick === s.mountAt || tick === s.dismountAt) buttons |= BUTTON.INTERACT;
  if (tick >= s.gallop[0] && tick < s.gallop[1]) buttons |= BUTTON.SPRINT;
  if (s.jumps.includes(tick)) buttons |= BUTTON.JUMP;
  return { moveF: riding || tick > s.dismountAt ? 1 : 0, moveR: 0, yaw: s.yaw, buttons };
};

// ---- a miniature room ----------------------------------------------------------------------------------------------------------------------------------------------------

/** A player row as the room keeps it: every field the mount system and the shared steps touch. */
export type FakePlayer = PlayerStateType;

export const makePlayer = (slot: number, x: number, z: number, world: CollisionWorld, name = `p${slot}`): FakePlayer => {
  const s = createCharState(x, z, world);
  return {
    name,
    ...s,
    look: "",
    title: "",
    health: 100,
    wounds: 0,
    missing: 0,
    reviveProgress: 0,
    reviver: "",
    dragger: "",
    slot,
    connected: true,
    weapon: 0,
    weapons: 0,
    ammo: 0,
    reserve: 0,
    reload: 0,
    shots: 0,
    aim: 0,
    npc: 0,
  } as FakePlayer;
};

export interface FakeProp {
  id: string;
  holder: string;
  x: number;
  y: number;
  z: number;
  kind: number;
}

export const emptyRow = (): MountRow => ({ kind: 0, x: 0, y: 0, z: 0, facing: 0, speed: 0, rider: "", hitch: "", coat: 0, phase: 0, hp: 0, cargo: 0 });

/** The movement step the room and the client share: a MOUNTED, standing, undragged body steps as a horse (the dispatch lives in `stepCharacter`, shared/movement.ts). */
export const stepPlayer = (s: CharState, cmd: MoveCommand, dt: number, world: CollisionWorld): void => stepCharacter(s, cmd, dt, world);

export class MountRoom {
  readonly players = new Map<string, FakePlayer>();
  readonly rows = new Map<string, MountRow>() as unknown as MountRowMap & Map<string, MountRow>;
  readonly props = new Map<string, FakeProp>();
  readonly held = new Map<string, string>();
  readonly notices: { sid: string; text: string }[] = [];
  readonly damages: { sid: string; amount: number }[] = [];
  readonly routes = new Map<string, { x: number; z: number }[]>();
  /** Burning ground (D-110: horses shy from it): points, nearest wins. */
  readonly fires: { x: number; z: number }[] = [];
  /** D-111: every man a horse rode down (rider, row, speed, heading), and the rows a horse steps round instead. */
  readonly trampled: { rider: string; key: string; speed: number; fx: number; fz: number }[] = [];
  readonly spared = new Set<string>();
  readonly mounts: Mounts;
  private readonly prevButtons = new Map<string, number>();
  private nextProp = 1;
  tickNo = 0;

  constructor(readonly world: CollisionWorld, readonly seed = 1) {
    const room = this;
    const host: MountsHost = {
      players: { forEach: (cb) => this.players.forEach((p, id) => cb(p, id)), get: (id) => this.players.get(id) },
      rows: this.rows,
      newRow: emptyRow,
      world: () => this.world,
      physics: {
        hold: (id, holder) => {
          const p = this.props.get(id);
          if (!p || p.holder !== "") return false;
          p.holder = holder;
          return true;
        },
        moveHeld: (id, x, y, z) => {
          const p = this.props.get(id);
          if (p && p.holder !== "") Object.assign(p, { x, y, z });
        },
        release: (id) => {
          const p = this.props.get(id);
          if (p) p.holder = "";
        },
      },
      damage: (sid, amount) => {
        this.damages.push({ sid, amount });
        const p = this.players.get(sid);
        if (p) p.health = Math.max(0, p.health - Math.round(amount));
      },
      notice: (sid, text) => this.notices.push({ sid, text }),
      seed,
      rowOf: (key) => this.players.get(key),
      takeHeld: (sid) => {
        const id = this.held.get(sid);
        if (!id) return undefined;
        this.held.delete(sid);
        const p = this.players.get(sid);
        if (p) p.flags &= ~FLAG.CARRYING;
        const prop = this.props.get(id);
        if (prop) prop.holder = "";
        return id;
      },
      setPropHolder: (id, holder) => {
        const p = this.props.get(id);
        if (p) p.holder = holder;
      },
      propExists: (id) => this.props.has(id),
      releaseDrag: (sid) => {
        const d = this.players.get(sid);
        if (d) d.flags &= ~FLAG.DRAGGING;
        for (const b of this.players.values()) if (b.dragger === sid) (b.flags &= ~FLAG.DRAGGED), (b.dragger = "");
      },
      routePoints: (name) => this.routes.get(name),
      trample: (rider, key, speed, fx, fz) => {
        if (this.spared.has(key)) return false;
        this.trampled.push({ rider, key, speed, fx, fz });
        return true;
      },
      fireNear: (x, z, r, out) => {
        let best = r * r;
        let found = false;
        for (const f of this.fires) {
          const d = (f.x - x) ** 2 + (f.z - z) ** 2;
          if (d <= best) {
            best = d;
            out.x = f.x;
            out.z = f.z;
            found = true;
          }
        }
        return found;
      },
    };
    void room;
    this.mounts = new Mounts(host);
  }

  addPlayer(id: string, x: number, z: number): FakePlayer {
    const p = makePlayer(this.players.size, x, z, this.world, id);
    this.players.set(id, p);
    return p;
  }

  addProp(x: number, z: number, kind = 0): FakeProp {
    const id = String(this.nextProp++);
    const prop: FakeProp = { id, holder: "", x, y: this.world.groundHeight(x, z, 1e6) + 0.3, z, kind };
    this.props.set(id, prop);
    return prop;
  }

  /** Puts a prop into a player's hands (the room's pickup path, minus its range rules). */
  give(sid: string, prop: FakeProp): void {
    prop.holder = sid;
    this.held.set(sid, prop.id);
    this.players.get(sid)!.flags |= FLAG.CARRYING;
  }

  /** Puts a downed body under a player's drag (Casualties' startDrag). */
  drag(draggerId: string, bodyId: string): void {
    const d = this.players.get(draggerId)!;
    const b = this.players.get(bodyId)!;
    b.flags |= FLAG.DOWNED | FLAG.DRAGGED;
    b.dragger = draggerId;
    d.flags |= FLAG.DRAGGING;
  }

  /** One server tick: each given player takes their frame (the shared step, then INTERACT on a rising edge), then the mount system runs. */
  tick(frames: Record<string, MoveCommand> = {}, dt = STEP_DT): void {
    this.tickNo++;
    this.players.forEach((p, sid) => {
      const cmd = frames[sid] ?? IDLE;
      stepPlayer(p, cmd, dt, this.world);
      this.interact(sid, p, cmd);
    });
    this.mounts.tick(dt);
  }

  private interact(sid: string, p: FakePlayer, cmd: MoveCommand): void {
    const prev = this.prevButtons.get(sid) ?? 0;
    this.prevButtons.set(sid, cmd.buttons);
    const pressed = cmd.buttons & ~prev;
    if ((pressed & BUTTON.INTERACT) === 0) return;
    this.mounts.onInteract(sid, p, this.held.get(sid));
  }
}

const IDLE: MoveCommand = { moveF: 0, moveR: 0, yaw: 0, buttons: 0 };

/** A command frame: stick forward/right in -1..1, camera yaw in radians. */
export const frame = (f: number, r: number, yaw: number, buttons = 0): MoveCommand => ({ moveF: axisToWire(f), moveR: axisToWire(r), yaw: yawToWire(yaw), buttons });

// ---- latency and prediction ----------------------------------------------------------------------------------------------------------------------------------------------

export interface NetStats {
  /** Largest position correction at any reconcile, metres (position only: flag flips are not corrections). */
  worst: number;
  /** Largest correction at a reconcile whose replay window held no server-side change of flags (steady riding). */
  worstSteady: number;
  /** Largest correction outside the window after a dismount: the server PLACES a dismounting rider 1 m to the left (clear of the horse), a deliberate teleport the client cannot predict. */
  worstRiding: number;
  reconciles: number;
  steadyReconciles: number;
  /** Server-side MOUNTED/HITCHED changes seen (mounts, dismounts, throws, hitching). */
  flagFlips: number;
}

/**
 * One client against the miniature room under a latency model: inputs reach the server `rtt/2` after they are sent, snapshots reach the client `rtt/2` after the server
 * stepped them. The client predicts with the shared dispatch step on its own state, and on every snapshot resets to the server's state (as float32: the schema's width) and replays
 * the inputs the server has not yet acknowledged, exactly as the reconciler does. The correction is how far that moves the rendered position.
 */
export class NetSim {
  readonly stats: NetStats = { worst: 0, worstSteady: 0, worstRiding: 0, reconciles: 0, steadyReconciles: 0, flagFlips: 0 };
  private client: CharState;
  private readonly sent: { seq: number; cmd: MoveCommand }[] = [];
  private readonly toServer: { at: number; seq: number; cmd: MoveCommand }[] = [];
  private readonly toClient: { at: number; seq: number; snap: CharState }[] = [];
  private seq = 0;
  private serverSeq = 0;
  private lastServerFlags: number;
  private t = 0;
  private lastFlipT = -1e9;
  private lastDismountT = -1e9;

  constructor(readonly room: MountRoom, readonly sid: string, readonly rttMs: number) {
    this.client = { ...room.players.get(sid)! } as CharState;
    this.lastServerFlags = this.client.flags & (MOUNT_FLAG.MOUNTED | MOUNT_FLAG.HITCHED);
  }

  /** One input tick (1/30 s) of wall-clock time. `frameCmd` is what the player does this tick. */
  step(frameCmd: MoveCommand): void {
    this.t += STEP_DT * 1000;
    const half = this.rttMs / 2;
    // the client predicts first, then sends
    this.seq++;
    stepPlayer(this.client, frameCmd, STEP_DT, this.room.world);
    this.sent.push({ seq: this.seq, cmd: frameCmd });
    this.toServer.push({ at: this.t + half, seq: this.seq, cmd: frameCmd });
    // the server takes whatever has arrived
    const frames: Record<string, MoveCommand> = {};
    if (this.toServer.length > 0 && this.toServer[0]!.at <= this.t + 1e-9) {
      // (one frame per server tick, as the room takes them)
      const m = this.toServer.shift()!;
      frames[this.sid] = m.cmd;
      this.serverSeq = m.seq;
    }
    this.room.tick(frames);
    const p = this.room.players.get(this.sid)!;
    const mountBits = p.flags & (MOUNT_FLAG.MOUNTED | MOUNT_FLAG.HITCHED);
    if (mountBits !== this.lastServerFlags) {
      this.stats.flagFlips++;
      if ((this.lastServerFlags & MOUNT_FLAG.MOUNTED) !== 0 && (mountBits & MOUNT_FLAG.MOUNTED) === 0) this.lastDismountT = this.t;
      this.lastServerFlags = mountBits;
      this.lastFlipT = this.t;
    }
    this.toClient.push({ at: this.t + half, seq: this.serverSeq, snap: snapshot(p) });
    // the client takes whatever snapshots have arrived (the newest wins)
    let snap: { seq: number; snap: CharState } | undefined;
    while (this.toClient.length > 0 && this.toClient[0]!.at <= this.t + 1e-9) snap = this.toClient.shift()!;
    if (snap) this.reconcile(snap);
  }

  private reconcile(m: { seq: number; snap: CharState }): void {
    const before = { x: this.client.x, y: this.client.y, z: this.client.z };
    // reset to the server's state, replay what it has not acknowledged
    const s: CharState = { ...m.snap };
    for (const f of this.sent) if (f.seq > m.seq) stepPlayer(s, f.cmd, STEP_DT, this.room.world);
    while (this.sent.length > 0 && this.sent[0]!.seq <= m.seq) this.sent.shift();
    const corr = Math.hypot(s.x - before.x, s.y - before.y, s.z - before.z);
    this.client = s;
    this.stats.reconciles++;
    if (this.stats.reconciles > 12) {
      // (the first dozen settle the spawn)
      this.stats.worst = Math.max(this.stats.worst, corr);
      if (this.t - this.lastDismountT > this.rttMs + 4 * STEP_DT * 1000) this.stats.worstRiding = Math.max(this.stats.worstRiding, corr);
      // steady = no server-side flag change within the last RTT window (everything the replay used was predicted with the right flags)
      if (this.t - this.lastFlipT > this.rttMs + 2 * STEP_DT * 1000) {
        this.stats.worstSteady = Math.max(this.stats.worstSteady, corr);
        this.stats.steadyReconciles++;
      }
    }
  }

  get predicted(): CharState {
    return this.client;
  }
}

/** A server row as it goes over the wire: the schema's width for every number (float32), which is what the client replays from. */
function snapshot(p: FakePlayer): CharState {
  const f = Math.fround;
  return {
    x: f(p.x),
    y: f(p.y),
    z: f(p.z),
    vx: f(p.vx),
    vy: f(p.vy),
    vz: f(p.vz),
    facing: f(p.facing),
    flags: p.flags,
    stumble: f(p.stumble),
    wounds: p.wounds,
    missing: p.missing,
  };
}
