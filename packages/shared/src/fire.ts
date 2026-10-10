import type { RegionId } from "./campaignTypes.ts";
import { insideFootprint, type CollisionWorld } from "./collision.ts";
import { regionCover } from "./groundCover.ts";
import { hash3 } from "./rng.ts";

/**
 * `hash3` in its top 30 bits: the same mixing, the low two bits dropped, so the roll is a small integer and is never boxed. `hash3` returns a uint32, and half of those do not
 * fit the engine's small integers: from a call the engine did not inline, each came back as a 16-byte heap number. Whether the step inlined it depended on what had been
 * compiled when the step was (load, timing), so on a loaded machine the step allocated ~400 B (the allocation test failed 1 run in ~5). `fireRoll(...) < p * ROLL` is
 * `hash3(...) / 2^32 < p` to within 2^-30: the fires burn as they did.
 */
export function fireRoll(seed: number, x: number, y: number, z: number): number {
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (x | 0), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13) ^ (y | 0), 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16) ^ (z | 0), 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 2;
}
/** 2^30: a `fireRoll` divided by this is a fraction in [0, 1). */
const ROLL = 1073741824;
import { smoothstep } from "./math.ts";
import { valueNoise } from "./terrain.ts";

/**
 * D-103, fire that spreads (after Far Cry 2's grass fires and Breath of the Wild's chemistry: the idea, not anybody's code). The ground is cut into 2 m cells; a cell's FUEL is
 * the region's plant cover there (groundCover.ts, the same numbers the grass is strewn by) times the region's dryness, so the flames run where grass is drawn and stop at roads,
 * sand, water, rock, walls and bare patches. A burning cell burns for a few seconds and may light each unburnt neighbour; the wind (weather.ts `windAt`) drives it downwind and
 * starves it upwind, a strong wind throws embers over a firebreak, and rain and wet ground choke it. A cell burns once.
 *
 * The server owns it (systems/Fire.ts): it lights cells (blasts, burning people, dropped torches), steps the grid four times a second and replicates two short strings (the
 * cells burning now, and the scorched ground for anyone who joins late). Pure and deterministic: every roll is a hash of (seed, cell, tick) and nothing reads a clock. Fuel is
 * worked out on first use, so a region where nothing burns costs nothing; once a cell's neighbours are known, stepping it allocates nothing.
 */

export const FIRE = {
  /** Cell edge, metres. */
  cell: 2,
  /** One step of the grid, seconds. */
  tickS: 0.25,
  /** At most this many cells burn at once (a wildfire waits at the cap: the server's step and the wire stay bounded). */
  maxBurning: 320,
  /** A cell of fuel 1 burns this long; leaner cells burn for less (down to 45%). */
  burnS: 7,
  /** Chance per step that a burning cell lights an unburnt neighbour of fuel 1, in still air. */
  spread: 0.07,
  /** Downwind the chance grows by up to (1 + windGain * wind); upwind it falls towards windFloor. */
  windGain: 2.5,
  windFloor: 0.15,
  /** The four diagonal neighbours are further away. */
  diagonal: 0.7,
  /** Cells leaner than this do not burn (bare patches are firebreaks). */
  minFuel: 0.18,
  /** Rain and wet ground choke the spread; rain also burns a cell out sooner. */
  rainDamp: 0.95,
  wetDamp: 0.6,
  /** In a wind above emberWind, a burning cell throws an ember 2-4 cells downwind with this chance per step (times the wind). */
  emberWind: 0.5,
  ember: 0.006,
  /** A blast lights the grass within this share of its radius. */
  blastIgnite: 0.6,
  /** How dry each region's plants are (a multiplier on the cover). Highmark's golden grass goes up fastest; the delta's sedge is wet. */
  dryness: { hollowmere: 0.8, kessar: 1, highmark: 1.3, vesper: 0.95, saltmarket: 0.5 } as Record<RegionId, number>,
  /**
   * Green, damp patches that will not take (a noise of about 10 m blobs over the cover): the share of the ground too green to burn, per region. They bound a fire the way a
   * real meadow does, so one keg is a scorched field and not the whole map; a strong wind's embers can still jump them.
   */
  green: { hollowmere: 0.58, kessar: 0.4, highmark: 0.5, vesper: 0.45, saltmarket: 0.6 } as Record<RegionId, number>,
  /** Obstacles rising more than this above the ground stop the fire (walls, rock, buildings, trunks). */
  solidAbove: 0.3,
  // ---- people (systems/Fire.ts) ----
  /** Standing in flames, the chance per step of catching. */
  catchChance: 0.5,
  /** Alight for this long after leaving the flames (refreshed while standing in them). */
  personS: 5,
  /** Health lost per second while alight. */
  personDps: 7,
  /** Crouching ("stop, drop and roll") burns the time down this many times faster. */
  crouchDouse: 3,
  /** Standing in water this deep puts a person out at once (and they cannot catch). */
  waterDouse: 0.3,
  /** A burning person lights the ground they run over with this chance per step: they spread it. */
  personSpread: 0.6,
  /** Replication cadence: the burning cells, the scorched ground. */
  syncBurningS: 0.5,
  syncScorchS: 2,
} as const;

/** Fuel byte meaning "not worked out yet". */
const UNKNOWN = 255;
/** Cell states. */
const UNBURNT = 0;
const BURNING = 1;
const BURNT = 2;
const PENDING = 3;

const NX = [1, -1, 0, 0, 1, 1, -1, -1];
const NZ = [0, 0, 1, -1, 1, -1, 1, -1];
const NLEN = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

/** What the grid needs from the weather for one step. */
export interface FireWeather {
  /** Unit vector the wind blows towards. */
  windX: number;
  windZ: number;
  /** 0..1 */
  wind: number;
  rain: number;
  wet: number;
}

export class FireGrid {
  /** Cells along each side (square, centred on the origin). */
  readonly w: number;
  /** World x (and z) of the grid's corner. */
  readonly origin: number;
  readonly cells: number;
  private readonly fuel: Uint8Array;
  private readonly state: Uint8Array;
  private readonly left: Uint16Array;
  /** The burning cells (unordered), and each cell's slot in it (-1 when not burning). */
  private readonly list: Int32Array;
  private readonly slot: Int32Array;
  private n = 0;
  private readonly pending: Int32Array;
  private np = 0;
  private readonly sortScratch: Int32Array;
  /** Changes since the caller last looked (the server syncs on them). */
  burningChanged = false;
  burntChanged = false;
  /** Cells burnt out since the grid was made. */
  burntCount = 0;

  constructor(
    /** The world the fuel is measured on (the server swaps in a rebuilt one: a fallen bridge, a grown outpost; cells already measured keep their fuel). */
    public world: CollisionWorld,
    private readonly region: RegionId,
    private readonly seed: number,
    bounds: number = world.boundsRadius,
  ) {
    this.w = Math.ceil((bounds * 2) / FIRE.cell);
    this.origin = -(this.w * FIRE.cell) / 2;
    this.cells = this.w * this.w;
    this.fuel = new Uint8Array(this.cells).fill(UNKNOWN);
    this.state = new Uint8Array(this.cells);
    this.left = new Uint16Array(this.cells);
    this.list = new Int32Array(FIRE.maxBurning);
    this.slot = new Int32Array(this.cells).fill(-1);
    this.pending = new Int32Array(FIRE.maxBurning * 2);
    this.sortScratch = new Int32Array(FIRE.maxBurning);
  }

  /** The cell under (x, z), or -1 off the grid. */
  cellAt(x: number, z: number): number {
    const i = Math.floor((x - this.origin) / FIRE.cell);
    const j = Math.floor((z - this.origin) / FIRE.cell);
    return i < 0 || j < 0 || i >= this.w || j >= this.w ? -1 : j * this.w + i;
  }

  /** Centre of a cell (x, z). */
  centreX(c: number): number {
    return this.origin + ((c % this.w) + 0.5) * FIRE.cell;
  }
  centreZ(c: number): number {
    return this.origin + (Math.floor(c / this.w) + 0.5) * FIRE.cell;
  }

  get burning(): number {
    return this.n;
  }

  isBurning(c: number): boolean {
    return c >= 0 && c < this.cells && this.state[c] === BURNING;
  }
  isBurnt(c: number): boolean {
    return c >= 0 && c < this.cells && this.state[c] === BURNT;
  }

  /** Whether the ground at (x, z) is burning. */
  burningAt(x: number, z: number): boolean {
    return this.isBurning(this.cellAt(x, z));
  }

  /** 0..1: what a cell has to burn (worked out once, on first use). */
  fuelOf(c: number): number {
    return this.fuelByte(c) / 254;
  }

  /** The fuel as a byte 0..254 (the step works in whole numbers: a fraction handed between calls can cost the engine an allocation). */
  private fuelByte(c: number): number {
    if (c < 0 || c >= this.cells) return 0;
    let f = this.fuel[c]!;
    if (f === UNKNOWN) {
      f = Math.round(this.measure(this.centreX(c), this.centreZ(c)) * 254);
      this.fuel[c] = f;
    }
    return f;
  }

  private measure(x: number, z: number): number {
    const b = this.world.boundsRadius - 1;
    if (x * x + z * z > b * b) return 0;
    const t = this.world.terrain as { height(x: number, z: number): number; waterDepth?: (x: number, z: number) => number };
    if ((t.waterDepth?.(x, z) ?? 0) > 0) return 0;
    const ground = t.height(x, z);
    let solid = false;
    this.world.forEachNear(x, z, (o) => {
      if (!solid && o.y1 > ground + FIRE.solidAbove && insideFootprint(o, x, z, 0)) solid = true;
    });
    if (solid) return 0;
    const cut = FIRE.green[this.region] ?? 0.5;
    const dry = smoothstep(cut, cut + 0.08, valueNoise((this.seed ^ 0x6e3e) >>> 0, x / 9, z / 9));
    if (dry <= 0) return 0;
    const f = regionCover(this.region, this.world, x, z) * (FIRE.dryness[this.region] ?? 1) * (0.6 + 0.4 * dry);
    return f < FIRE.minFuel ? 0 : f > 1 ? 1 : f;
  }

  /** Lights one cell now (when it has fuel, has not burnt and the cap allows). Returns whether it caught. */
  igniteCell(c: number): boolean {
    if (c < 0 || c >= this.cells || this.state[c] !== UNBURNT || this.n >= FIRE.maxBurning) return false;
    const fb = this.fuelByte(c);
    if (fb <= 0) return false;
    this.light(c, fb);
    return true;
  }

  /** Lights a cell of fuel byte `fb`: it burns FIRE.burnS at full fuel, down to 45% of that when lean. */
  private light(c: number, fb: number): void {
    this.state[c] = BURNING;
    this.left[c] = Math.max(4, Math.round((FIRE.burnS * (0.45 + (0.55 * fb) / 254)) / FIRE.tickS));
    this.list[this.n] = c;
    this.slot[c] = this.n;
    this.n++;
    this.burningChanged = true;
  }

  /** Lights every cell with fuel whose centre lies within `radius` of (x, z) (a blast, a spilt lamp). Returns how many caught. */
  ignite(x: number, z: number, radius: number): number {
    const r = Math.max(radius, FIRE.cell * 0.5);
    const i0 = Math.floor((x - r - this.origin) / FIRE.cell);
    const i1 = Math.floor((x + r - this.origin) / FIRE.cell);
    const j0 = Math.floor((z - r - this.origin) / FIRE.cell);
    const j1 = Math.floor((z + r - this.origin) / FIRE.cell);
    const at = this.cellAt(x, z);
    let lit = 0;
    for (let j = Math.max(0, j0); j <= Math.min(this.w - 1, j1); j++) {
      for (let i = Math.max(0, i0); i <= Math.min(this.w - 1, i1); i++) {
        const c = j * this.w + i;
        const dx = this.centreX(c) - x;
        const dz = this.centreZ(c) - z;
        if (dx * dx + dz * dz > r * r && c !== at) continue; // (the cell it lands in always counts)
        if (this.igniteCell(c)) lit++;
      }
    }
    return lit;
  }

  /** Puts a cell out (water thrown on it, a hole dug): it counts as burnt, so it does not catch again. */
  douse(c: number): void {
    if (c < 0 || c >= this.cells) return;
    if (this.state[c] === BURNING) this.unlist(c);
    if (this.state[c] !== BURNT) {
      this.state[c] = BURNT;
      this.burntCount++;
      this.burntChanged = true;
    }
  }

  private unlist(c: number): void {
    const s = this.slot[c]!;
    const last = this.list[this.n - 1]!;
    this.list[s] = last;
    this.slot[last] = s;
    this.slot[c] = -1;
    this.n--;
    this.burningChanged = true;
  }

  private queue(c: number): void {
    if (this.np >= this.pending.length) return;
    this.state[c] = PENDING;
    this.pending[this.np++] = c;
  }

  /** One step (FIRE.tickS) of the fire at step number `tick` (the rolls are keyed to it, so a replay gives the same fire). */
  step(tick: number, wx: FireWeather): void {
    if (this.n === 0) return;
    const wind = wx.wind < 0 ? 0 : wx.wind > 1 ? 1 : wx.wind;
    const rain = wx.rain < 0 ? 0 : wx.rain > 1 ? 1 : wx.rain;
    const wet = wx.wet < 0 ? 0 : wx.wet > 1 ? 1 : wx.wet;
    const choke = (1 - rain * FIRE.rainDamp) * (1 - wet * FIRE.wetDamp);
    const windX = wx.windX;
    const windZ = wx.windZ;
    const seed = this.seed >>> 0;
    this.np = 0;
    // (downwards, so a cell swapped in from the end by a removal has already had its turn)
    for (let k = this.n - 1; k >= 0; k--) {
      const c = this.list[k]!;
      let lft = this.left[c]! - 1;
      if (rain > 0 && fireRoll(seed ^ 0x5a1, c, tick, 9) < rain * 0.5 * ROLL) lft--;
      if (lft <= 0) {
        this.left[c] = 0;
        this.unlist(c);
        this.state[c] = BURNT;
        this.burntCount++;
        this.burntChanged = true;
        continue;
      }
      this.left[c] = lft;
      const ci = c % this.w;
      const cj = (c - ci) / this.w;
      for (let d = 0; d < 8; d++) {
        const ni = ci + NX[d]!;
        const nj = cj + NZ[d]!;
        if (ni < 0 || nj < 0 || ni >= this.w || nj >= this.w) continue;
        const nc = nj * this.w + ni;
        if (this.state[nc] !== UNBURNT) continue;
        const fb = this.fuelByte(nc);
        if (fb <= 0) continue;
        const align = (NX[d]! * windX + NZ[d]! * windZ) / NLEN[d]!;
        let wm = 1 + align * wind * (align > 0 ? FIRE.windGain : 1);
        if (wm < FIRE.windFloor) wm = FIRE.windFloor;
        const p = ((FIRE.spread * fb) / 254) * wm * (d >= 4 ? FIRE.diagonal : 1) * choke;
        if (fireRoll(seed ^ 0xf17e, c, tick, d) < p * ROLL) this.queue(nc);
      }
      if (wind > FIRE.emberWind && fireRoll(seed ^ 0xe3b, c, tick, 11) < FIRE.ember * wind * choke * ROLL) {
        const dist = 2 + (hash3(seed ^ 0xe3c, c, tick, 12) % 3);
        const ei = ci + Math.round(windX * dist);
        const ej = cj + Math.round(windZ * dist);
        if (ei >= 0 && ej >= 0 && ei < this.w && ej < this.w) {
          const ec = ej * this.w + ei;
          if (this.state[ec] === UNBURNT && this.fuelByte(ec) > 0) this.queue(ec);
        }
      }
    }
    for (let q = 0; q < this.np; q++) {
      const c = this.pending[q]!;
      if (this.n < FIRE.maxBurning) this.light(c, this.fuelByte(c));
      else this.state[c] = UNBURNT;
    }
    this.np = 0;
  }

  /** Calls `cb` for each burning cell. */
  forEachBurning(cb: (c: number) => void): void {
    for (let k = 0; k < this.n; k++) cb(this.list[k]!);
  }

  /** The burning cells for the wire: sorted, delta-coded, base64url (a few hundred characters at most). */
  encodeBurning(): string {
    const a = this.sortScratch.subarray(0, this.n);
    a.set(this.list.subarray(0, this.n));
    a.sort();
    let prev = -1;
    const w = writer();
    for (let k = 0; k < a.length; k++) {
      w.varint(a[k]! - prev - 1);
      prev = a[k]!;
    }
    return w.done();
  }

  /** The scorched ground for the wire: run lengths over the cells in order (burnt or not, alternating, starting with "not"), base64url. */
  encodeBurnt(): string {
    const w = writer();
    let run = 0;
    let isB = false;
    for (let c = 0; c < this.cells; c++) {
      const b = this.state[c] === BURNT;
      if (b === isB) run++;
      else {
        w.varint(run);
        run = 1;
        isB = b;
      }
    }
    if (isB) w.varint(run);
    return w.done();
  }
}

// ---- the wire's small codec: varints in base64url ------------------------------------------------------------------------------------------

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64_INDEX = (() => {
  const t = new Int8Array(128).fill(-1);
  for (let i = 0; i < 64; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

function writer(): { varint(v: number): void; done(): string } {
  const bytes: number[] = [];
  return {
    varint(v: number): void {
      let x = v >>> 0;
      while (x >= 0x80) {
        bytes.push((x & 0x7f) | 0x80);
        x >>>= 7;
      }
      bytes.push(x);
    },
    done(): string {
      let s = "";
      for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i]!;
        const b1 = bytes[i + 1] ?? 0;
        const b2 = bytes[i + 2] ?? 0;
        const v = (b0 << 16) | (b1 << 8) | b2;
        s += B64[(v >> 18) & 63]! + B64[(v >> 12) & 63]!;
        if (i + 1 < bytes.length) s += B64[(v >> 6) & 63]!;
        if (i + 2 < bytes.length) s += B64[v & 63]!;
      }
      return s;
    },
  };
}

/** Reads the varints back from a base64url string; a malformed string yields what parsed before it went wrong. */
function readVarints(s: string, cb: (v: number) => void): void {
  let acc = 0;
  let bits = 0;
  let v = 0;
  let shift = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const d = code < 128 ? B64_INDEX[code]! : -1;
    if (d < 0) return;
    acc = (acc << 6) | d;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      const byte = (acc >> bits) & 0xff;
      acc &= (1 << bits) - 1;
      v |= (byte & 0x7f) << shift;
      if (byte & 0x80) {
        shift += 7;
        if (shift > 28) return;
      } else {
        cb(v >>> 0);
        v = 0;
        shift = 0;
      }
    }
  }
}

/** The burning cells from `encodeBurning` (each index once, ascending; anything past `cells` is ignored). */
export function decodeBurning(s: string, cells: number, cb: (c: number) => void): void {
  if (typeof s !== "string" || s.length === 0) return;
  let prev = -1;
  readVarints(s, (gap) => {
    prev = prev + gap + 1;
    if (prev < cells) cb(prev);
  });
}

/** The scorched cells from `encodeBurnt`. */
export function decodeBurnt(s: string, cells: number, cb: (c: number) => void): void {
  if (typeof s !== "string" || s.length === 0) return;
  let at = 0;
  let isB = false;
  readVarints(s, (run) => {
    if (isB) for (let c = at; c < Math.min(cells, at + run); c++) cb(c);
    at += run;
    isB = !isB;
  });
}
