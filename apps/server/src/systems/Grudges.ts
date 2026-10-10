import {
  FLAG, GRUDGE, epithet, grudgeLook, grudgeName, npcKey, peopleForNpc, pickGrudge, rememberGrudge,
  type CampaignState, type Grudge, type GrudgeCause, type NpcSpec, type PlayersView, type RegionId,
} from "@cb/shared";

/**
 * SURVIVORS WITH GRUDGES, server half (D-109; the rules are `shared/grudges.ts`). During a run it keeps an account of what the party did to each soldier (a limb, the fire, a
 * boot, a rope); at the commit the worst-used man is remembered in the campaign. When a contract starts in a region where a remembered man has had his night, he takes one
 * soldier's place in the garrison as it is spawned (`respec`): his face, his hook or his peg, his name with the paper's nickname in it, a steadier nerve and a better eye.
 * The first time one of the party comes near, he says his piece and the column prints his return; put down again, the column says so and he may be back once more.
 */
export interface GrudgesHost {
  /** Every row (players and NPCs). */
  players: PlayersView;
  /** The spec an NPC row was spawned from (Cast.specOf). */
  specOf(key: string): NpcSpec | undefined;
  /** He is back and has spoken (the room barks for him and prints the column line). */
  returned?(key: string, g: Grudge): void;
  /** He is down again, `by` (a display name, "" for nobody's hand). */
  beaten?(key: string, g: Grudge, by: string): void;
}

interface Account {
  key: string;
  score: number;
  missing: number;
  burnt: boolean;
  cause: GrudgeCause;
  by: string;
}

/** Display name of a party member, or "" (an NPC, nobody, the fire). */
const nameOf = (players: PlayersView, id: string): string => {
  const p = id ? players.get(id) : undefined;
  return p && p.npc === 0 ? p.name : "";
};

export class Grudges {
  private region: RegionId = "hollowmere";
  /** The run's accounts, by NPC key (in the order first wronged). */
  private readonly accounts = new Map<string, Account>();
  /** The man who comes back this run (a copy of his record), where he stands in the campaign's list, and the row he was given. */
  private back: Grudge | undefined;
  private backIndex = -1;
  private backKey = "";
  private spoke = false;
  private down = false;
  private downBy = "";
  readonly stats = { fielded: 0, spoke: 0, beaten: 0 };

  constructor(private readonly host: GrudgesHost) {}

  /** A contract starts in `region` on campaign day `day`: forget the last run's accounts; pick the man who comes back, if any. */
  begin(c: CampaignState, region: RegionId, day: number): void {
    this.reset();
    this.region = region;
    const i = pickGrudge(c.sites.grudges, region, day);
    if (i >= 0) {
      this.back = { ...c.sites.grudges![i]! };
      this.backIndex = i;
    }
  }

  reset(): void {
    this.accounts.clear();
    this.back = undefined;
    this.backIndex = -1;
    this.backKey = "";
    this.spoke = false;
    this.down = false;
    this.downBy = "";
  }

  /** Who came back this run (tests, the debug line). */
  get fielded(): { key: string; grudge: Grudge } | undefined {
    return this.back && this.backKey ? { key: this.backKey, grudge: this.back } : undefined;
  }

  /**
   * The Cast's last look at a batch: the remembered man takes his own place when he is on the roster as he was, else the place of the first soldier of his side (a garrison
   * brain, not an incident's people), his own rank first.
   * Once per run. A new array only when he is placed; otherwise the batch as it came.
   */
  respec(specs: readonly NpcSpec[]): readonly NpcSpec[] {
    const g = this.back;
    if (!g || this.backKey) return specs;
    const fits = (s: NpcSpec): boolean => s.brain === "garrison" && s.faction === g.faction && s.group !== "incident";
    // (he is on the roster himself, as he was: he takes his own place, or he would stand beside his twin; else the first of his rank, else the first of his side)
    let at = specs.findIndex((s) => fits(s) && (s.lookSeed === g.lookSeed || s.name === g.name));
    if (at < 0) at = specs.findIndex((s) => fits(s) && s.role === g.role);
    if (at < 0) at = specs.findIndex(fits);
    if (at < 0) return specs;
    const s = specs[at]!;
    const look = grudgeLook(g);
    const him: NpcSpec = {
      ...s,
      role: g.role,
      name: grudgeName(g.name, epithet(g)),
      lookSeed: g.lookSeed,
      look: { ...(s.look ?? {}), ...look },
      skill: Math.min(100, s.skill + GRUDGE.skill),
      bravery: Math.min(100, s.bravery + GRUDGE.bravery),
      peg: look.woodenLeg !== undefined,
    };
    if (g.by) him.hates = g.by;
    if (g.people) him.people = g.people;
    else delete him.people;
    this.backKey = npcKey(s.id);
    this.stats.fielded++;
    const out = specs.slice();
    out[at] = him;
    return out;
  }

  // ---- what the party did (the room calls these for NPC rows only) -----------------------------------------------------------------------

  /** `key` lost `limbs` to `by`. */
  onMaimed(key: string, limbs: number, by: string): void {
    const a = this.account(key);
    if (!a) return;
    a.missing |= limbs & 15;
    this.raise(a, "limb", by, GRUDGE.weight.limb * popcount(limbs & 15));
  }

  /** `key` caught fire (nobody's hand: the fire spreads itself). */
  onBurnt(key: string): void {
    const a = this.account(key);
    if (!a) return;
    a.burnt = true;
    this.raise(a, "fire", "", GRUDGE.weight.fire);
  }

  /** `key` was booted, roped, ridden down (D-111) or held up as a shield (D-112) by `by`. */
  onInsult(key: string, cause: "boot" | "rope" | "hoof" | "shield", by: string): void {
    const a = this.account(key);
    if (a) this.raise(a, cause, by, GRUDGE.weight[cause]);
  }

  /** A row went down, `by` (the room's casualty hook). The returning man's second defeat is noted for the commit and printed at once. */
  onDown(key: string, by: string): void {
    if (!this.back || key !== this.backKey || this.down) return;
    this.down = true;
    this.downBy = nameOf(this.host.players, by);
    this.stats.beaten++;
    this.host.beaten?.(key, this.back, this.downBy);
  }

  /** Once he is in the field: the first time one of the party is within earshot, he says his piece. Cheap; call it every tick. */
  tick(): void {
    if (this.spoke || !this.backKey || !this.back) return;
    const me = this.host.players.get(this.backKey);
    if (!me || (me.flags & FLAG.DOWNED) !== 0) return;
    let near = false;
    this.host.players.forEach((p) => {
      if (!near && p.npc === 0 && p.connected && (p.flags & FLAG.DOWNED) === 0 && Math.hypot(p.x - me.x, p.z - me.z) <= GRUDGE.speakR) near = true;
    });
    if (!near) return;
    this.spoke = true;
    this.stats.spoke++;
    this.host.returned?.(this.backKey, this.back);
  }

  /**
   * The commit (`c` after the outcome is applied; its day is the run's): the returning man, put down again, has one more return spent (and is forgotten after his last); the
   * run's worst-used man (not the returning one, whose new wounds are folded into his own record) is remembered.
   */
  settle(c: CampaignState): CampaignState {
    let list = c.sites.grudges ? c.sites.grudges.slice() : [];
    if (this.back && this.backKey && this.backIndex >= 0 && this.backIndex < list.length && list[this.backIndex]!.lookSeed === this.back.lookSeed) {
      const was = list[this.backIndex]!;
      const more = this.accounts.get(this.backKey);
      if (this.down) {
        const returns = was.returns + 1;
        if (returns >= GRUDGE.maxReturns) list.splice(this.backIndex, 1);
        else
          list[this.backIndex] = {
            ...was,
            returns,
            day: c.day,
            missing: was.missing | (more?.missing ?? 0),
            burnt: was.burnt || (more?.burnt ?? false),
            by: this.downBy || was.by,
          };
      }
    }
    let best: Account | undefined;
    for (const a of this.accounts.values()) {
      if (a.key === this.backKey) continue;
      if (!best || a.score > best.score) best = a;
    }
    if (best) {
      const s = this.host.specOf(best.key);
      if (s) {
        const people = s.people ?? peopleForNpc(s.role, this.region);
        const g: Grudge = { name: s.name, role: s.role, lookSeed: s.lookSeed, faction: s.faction, region: this.region, missing: best.missing, burnt: best.burnt, cause: best.cause, by: best.by, day: c.day, returns: 0 };
        if (people) g.people = people;
        list = rememberGrudge(list, g);
      }
    }
    if (list.length === 0 && !c.sites.grudges) return c;
    const sites = { ...c.sites };
    if (list.length > 0) sites.grudges = list;
    else delete sites.grudges;
    return { ...c, sites };
  }

  /** The account of an NPC soldier the party has wronged (undefined for anybody else: a player, a hand, a civilian, a beast, an incident's people). */
  private account(key: string): Account | undefined {
    let a = this.accounts.get(key);
    if (a) return a;
    const s = this.host.specOf(key);
    if (!s || s.brain !== "garrison" || s.group === "incident") return undefined;
    a = { key, score: 0, missing: 0, burnt: false, cause: "rope", by: "" };
    this.accounts.set(key, a);
    return a;
  }

  private raise(a: Account, cause: GrudgeCause, by: string, points: number): void {
    a.score += points;
    if (GRUDGE.weight[cause] >= GRUDGE.weight[a.cause] || a.score === points) {
      a.cause = cause;
      const who = nameOf(this.host.players, by);
      if (who || cause === "fire") a.by = who;
    }
  }
}

const popcount = (n: number): number => {
  let c = 0;
  for (let v = n; v; v &= v - 1) c++;
  return c;
};
