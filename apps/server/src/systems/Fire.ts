import {
  FIRE, FLAG, FireGrid, PropKind, createWeather, hash3, weatherAt, windAt,
  type CollisionWorld, type FireWeather, type PlayerStateType, type PropStateType, type RegionId,
} from "@cb/shared";

/**
 * FIRE (D-103): the server half of fire that spreads. shared/fire.ts owns the grid (fuel, spread, wind, rain, the wire codec); this class steps it with the world's weather,
 * lights it (blasts, a raider's dropped torch, anybody running about alight), sets people alight who stand in it, cooks off the powder it reaches, scares the people near it,
 * and writes the two strings the clients draw it from. Nothing here is decided by the clients.
 *
 * People: standing in burning ground catches (FIRE.catchChance a step); alight, they lose FIRE.personDps a second for FIRE.personS after they leave the flames, light the ground
 * they run over (so a burning man running through the grass spreads it), and an NPC on fire panics. Crouching ("stop, drop and roll") burns the time down faster, water puts it out
 * at once, rain helps. The downed neither catch nor take fire damage (the downed are past harm in this game: revive or rout decides them), but a body already alight stays alight.
 */
export interface FireHost {
  players: { forEach(cb: (p: PlayerStateType, id: string) => void): void };
  props: { forEach(cb: (ps: PropStateType, id: string) => void): void };
  seed: number;
  worldMs(): number;
  world(): CollisionWorld;
  region(): RegionId;
  /** Fire damage to a standing person (Casualties.damage, unaimed). */
  damage(id: string, amount: number): void;
  /** A keg in the flames: light its fuse (the room keeps the shorter of a burning fuse and this one). */
  cookOff(propId: string): void;
  /** An NPC is alight: it panics (Cast: civilians run and cry out, soldiers' nerve goes). */
  panic(id: string, x: number, z: number): void;
  /** Flames are here: people within `radius` take fright (Cast.noise). */
  scare(x: number, z: number, radius: number): void;
  /** Replicate the cells burning now, and the scorched ground. */
  writeBurning(s: string): void;
  writeScorch(s: string): void;
}

/** How often the flames frighten the people near them (seconds). */
const SCARE_S = 1;
/** Fire damage is dealt in bites of at least this many points (about twice a second at FIRE.personDps). */
const BURN_BITE = 3;
/** A keg cooks off when the ground under it burns, or a burning person carries it. */
const KEG_IN_FIRE_Y = 1.2;

export class Fire {
  private grid: FireGrid | undefined;
  private key = "";
  private acc = 0;
  private stepNo = 0;
  private syncBurning = 0;
  private syncScorch = 0;
  private scareT = 0;
  private readonly wx = createWeather();
  private readonly wind = { x: 0, z: 1 };
  private readonly env: FireWeather = { windX: 0, windZ: 1, wind: 0, rain: 0, wet: 0 };
  /** Fractional fire damage owed per person (damage is applied in whole points). */
  private readonly owed = new Map<string, number>();
  /** Seconds left alight per person (PlayerState.burn mirrors it in tenths). */
  private readonly alight = new Map<string, number>();

  constructor(private readonly host: FireHost) {}

  /** The grid for the current region (made on first use: a region where nothing burns costs nothing). */
  private gridNow(): FireGrid {
    const key = `${this.host.region()}:${this.host.seed}`;
    if (!this.grid || this.key !== key) {
      this.grid = new FireGrid(this.host.world(), this.host.region(), this.host.seed);
      this.key = key;
    }
    return this.grid;
  }

  /** A new region (or a landfall): everything that burnt there is forgotten and nobody is alight. */
  reset(): void {
    this.grid = undefined;
    this.key = "";
    this.alight.clear();
    this.owed.clear();
    this.host.players.forEach((p) => {
      if (p.burn !== 0) p.burn = 0;
    });
    this.host.writeBurning("");
    this.host.writeScorch("");
  }

  /** The world was rebuilt in place (a bridge fell, an outpost grew): the grid keeps its fire and reads the new obstacles from now on. */
  setWorld(world: CollisionWorld): void {
    if (this.grid) this.grid.world = world;
  }

  /** A blast of `radius` metres at (x, z) lights the grass within FIRE.blastIgnite of it. */
  blast(x: number, z: number, radius: number): number {
    return this.gridNow().ignite(x, z, radius * FIRE.blastIgnite);
  }

  /** Lights the ground within `radius` of (x, z) (a dropped torch, a debug command). */
  ignite(x: number, z: number, radius: number): number {
    return this.gridNow().ignite(x, z, radius);
  }

  /** QA: lights the fuelled, unburnt cell nearest (x, z) within `reach` metres (and the cells round it). Returns where, or undefined when nothing near can burn. */
  igniteNear(x: number, z: number, reach: number): { x: number; z: number } | undefined {
    const g = this.gridNow();
    let best = -1;
    let bestD = Infinity;
    for (let dz = -reach; dz <= reach; dz += 2) {
      for (let dx = -reach; dx <= reach; dx += 2) {
        const c = g.cellAt(x + dx, z + dz);
        if (c < 0 || g.isBurning(c) || g.isBurnt(c) || g.fuelOf(c) < 0.4) continue;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    if (best < 0) return undefined;
    g.ignite(g.centreX(best), g.centreZ(best), 2.5);
    return { x: g.centreX(best), z: g.centreZ(best) };
  }

  /** Whether the ground at (x, z) is burning now. */
  burningAt(x: number, z: number): boolean {
    return this.grid?.burningAt(x, z) ?? false;
  }

  get burning(): number {
    return this.grid?.burning ?? 0;
  }

  /** Whether `id` is alight. */
  isAlight(id: string): boolean {
    return (this.alight.get(id) ?? 0) > 0;
  }

  /** A row left the room: forget its fire. */
  onLeave(id: string): void {
    this.alight.delete(id);
    this.owed.delete(id);
  }

  tick(dt: number): void {
    const g = this.grid;
    if (!g || (g.burning === 0 && this.alight.size === 0 && !g.burningChanged && !g.burntChanged)) return;
    this.acc += dt;
    while (this.acc >= FIRE.tickS) {
      this.acc -= FIRE.tickS;
      this.step(g);
    }
    this.syncBurning -= dt;
    this.syncScorch -= dt;
    if (g.burningChanged && this.syncBurning <= 0) {
      g.burningChanged = false;
      this.syncBurning = FIRE.syncBurningS;
      this.host.writeBurning(g.encodeBurning());
    }
    if (g.burntChanged && this.syncScorch <= 0) {
      g.burntChanged = false;
      this.syncScorch = FIRE.syncScorchS;
      this.host.writeScorch(g.encodeBurnt());
    }
  }

  private step(g: FireGrid): void {
    const ms = this.host.worldMs();
    weatherAt(this.host.seed, ms, this.wx);
    windAt(this.host.seed, ms, this.wind);
    this.env.windX = this.wind.x;
    this.env.windZ = this.wind.z;
    this.env.wind = this.wx.wind;
    this.env.rain = this.wx.rain;
    this.env.wet = this.wx.wet;
    g.step(this.stepNo, this.env);
    this.people(g);
    this.powder(g);
    this.scareT -= FIRE.tickS;
    if (this.scareT <= 0 && g.burning > 0) {
      this.scareT = SCARE_S;
      this.frighten(g);
    }
    this.stepNo++;
  }

  private people(g: FireGrid): void {
    const world = this.host.world();
    const water = (world.terrain as { waterDepth?: (x: number, z: number) => number }).waterDepth;
    const seed = this.host.seed >>> 0;
    this.host.players.forEach((p, id) => {
      const down = (p.flags & FLAG.DOWNED) !== 0;
      const wet = (water?.(p.x, p.z) ?? 0) > FIRE.waterDouse;
      const onGround = p.y - world.terrainHeight(p.x, p.z) < 0.8;
      const c = g.cellAt(p.x, p.z);
      let left = this.alight.get(id) ?? 0;
      if (wet) left = 0;
      else if (!down && onGround && g.isBurning(c) && hash3(seed ^ 0xb02, this.stepNo, p.slot, p.npc) / 4294967296 < FIRE.catchChance) left = FIRE.personS;
      if (left > 0) {
        const crouch = (p.flags & FLAG.CROUCHING) !== 0 && !down ? FIRE.crouchDouse : 1;
        left -= FIRE.tickS * crouch * (1 + this.env.rain);
        if (!down) {
          // (in bites of BURN_BITE points: a hit event four times a second would be noise on the wire and on the screen)
          const owed = (this.owed.get(id) ?? 0) + FIRE.personDps * FIRE.tickS;
          const bite = owed >= BURN_BITE ? Math.floor(owed) : 0;
          this.owed.set(id, owed - bite);
          if (bite > 0) this.host.damage(id, bite);
          if (p.npc) this.host.panic(id, p.x, p.z);
        }
        if (onGround && hash3(seed ^ 0xb03, this.stepNo, p.slot, p.npc) / 4294967296 < FIRE.personSpread) g.igniteCell(c);
      }
      if (left > 0) this.alight.set(id, left);
      else if (this.alight.delete(id)) this.owed.delete(id);
      const tenths = left > 0 ? Math.min(255, Math.ceil(left * 10)) : 0;
      if (p.burn !== tenths) p.burn = tenths;
    });
  }

  /** Kegs on burning ground, or in the arms of somebody alight, cook off. */
  private powder(g: FireGrid): void {
    if (g.burning === 0 && this.alight.size === 0) return;
    const world = this.host.world();
    this.host.props.forEach((ps, id) => {
      if (ps.kind !== PropKind.BARREL || ps.fuse > 0) return;
      const held = ps.holder !== "" && this.isAlight(ps.holder);
      const grounded = ps.y - world.terrainHeight(ps.x, ps.z) < KEG_IN_FIRE_Y && g.burningAt(ps.x, ps.z);
      if (held || grounded) this.host.cookOff(id);
    });
  }

  /** People near the flames take fright: one scare at the middle of the fire, reaching past its edge. */
  private frighten(g: FireGrid): void {
    let sx = 0;
    let sz = 0;
    let n = 0;
    g.forEachBurning((c) => {
      sx += g.centreX(c);
      sz += g.centreZ(c);
      n++;
    });
    if (n === 0) return;
    const cx = sx / n;
    const cz = sz / n;
    let r2 = 0;
    g.forEachBurning((c) => {
      const d2 = (g.centreX(c) - cx) ** 2 + (g.centreZ(c) - cz) ** 2;
      if (d2 > r2) r2 = d2;
    });
    this.host.scare(cx, cz, Math.sqrt(r2) + 10);
  }
}
