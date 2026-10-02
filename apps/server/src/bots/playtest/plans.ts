import { BUTTON, FLAG, HIGHMARK_ANCHORS as H, KESSAR_OUTPOST as KO, RAID_SITES as RS, HIGHMARK_SITES as HS, KESSAR_ANCHORS as A, KESSAR_SITES as KS, PropKind, SALTMARKET_ANCHORS as SA, SALTMARKET_SITES as SS, SALTMARKET_SPOTS as SP, VESPER_ANCHORS as V, VESPER_SITES as VS, VESPER_STOCK as VK, WEAPON, type JoinOptions, type ResolutionId } from "@cb/shared";
import type { Pilot } from "./pilot.ts";

export interface Plan {
  name: string;
  join: Partial<JoinOptions>;
  player?: string;
  /** The endings a person playing this route would reasonably expect. */
  expect?: ResolutionId[];
  run(p: Pilot): Promise<void>;
}

const SEED = 4242;

/** The nearest prop of a kind to a point (and not carried). */
function nearestProp(p: Pilot, kind: number, x: number, z: number, within = 12): { id: string; x: number; z: number } | undefined {
  let best: { id: string; x: number; z: number } | undefined;
  let bd = within;
  p.bot.room.state.props.forEach((pr, id) => {
    if (pr.kind !== kind || pr.holder) return;
    const d = Math.hypot(pr.x - x, pr.z - z);
    if (d < bd) {
      bd = d;
      best = { id, x: pr.x, z: pr.z };
    }
  });
  return best;
}

/** Walks to a prop and picks it up (Use with empty hands at arm's length, facing it). */
async function pickUp(p: Pilot, kind: number, x: number, z: number): Promise<boolean> {
  const pr = nearestProp(p, kind, x, z);
  if (!pr) {
    p.note(`NO PROP of kind ${kind} near ${x},${z}`);
    return false;
  }
  await p.goTo(pr.x, pr.z, { within: 1.3, label: "prop" });
  await p.face(pr.x, pr.z);
  await p.use("pick up");
  const held = await p.until(() => {
    let h = false;
    p.bot.room.state.props.forEach((q) => (h ||= q.holder === p.bot.room.sessionId));
    return h;
  }, 2000, "holding the prop");
  p.note(held ? "HOLDING prop" : "FAILED to pick up");
  return held;
}

async function sailHome(p: Pilot, landing: { x: number; z: number }): Promise<void> {
  await p.goTo(landing.x, landing.z, { within: 2.5, label: "landing" });
  await p.until(() => p.view?.resolution !== undefined, 15_000, "resolution to commit");
}

/** Fights the group until the contract resolves, the pilot is down, or time runs out. Takes cover by standing still behind nothing: a deliberately plain shooter. */
/** `hold`: a defender behind a wall shoots what comes into sight and never walks out to look for it (the fortified post's gate). */
async function fight(p: Pilot, prefix: string, ms: number, hold = false): Promise<void> {
  p.draw(WEAPON.RIFLE);
  await p.sleep(1200);
  const end = Date.now() + ms;
  while (Date.now() < end && p.view?.resolution === undefined && p.me && (p.me.flags & FLAG.DOWNED) === 0 && p.me.health > 0) {
    const live = p.npcs(prefix).filter(([, n]) => n.health > 0 && (n.flags & FLAG.DOWNED) === 0);
    if (!live.length) break;
    const me = p.pos;
    live.sort((a, b) => Math.hypot(a[1].x - me.x, a[1].z - me.z) - Math.hypot(b[1].x - me.x, b[1].z - me.z));
    // a person shoots at what they can see: with nothing in sight they close in (walking, rifle ready) until somebody is
    const seen = live.find(([, n]) => p.canSee(n.x, n.y + 1.2, n.z));
    if (!seen) {
      if (hold) {
        await p.sleep(300);
        continue;
      }
      const [, t] = live[0]!;
      // (a few metres nearer each time, not "within 14": standing 13.7 m from a man behind a parapet, that arrived at once, forever)
      const d = Math.hypot(t.x - me.x, t.z - me.z);
      await p.goTo(t.x, t.z, { within: Math.max(2.5, d - 6), sprint: false, ms: 6000, label: `close in on ${live[0]![0]}` });
      continue;
    }
    await p.shootAt(seen[0]);
    await p.sleep(300);
  }
  p.holster();
}

/** Walks up to an NPC (where it stands now) and presses Use facing it. */
async function talkTo(p: Pilot, id: string, within = 1.6): Promise<boolean> {
  const n = p.npc(id);
  if (!n) {
    p.note(`NO NPC ${id}`);
    return false;
  }
  await p.goTo(n.x, n.z, { within, label: id });
  const m = p.npc(id)!;
  await p.face(m.x, m.z);
  await p.use(`talk to ${id}`);
  return p.until(() => p.parley !== undefined, 3000, `${id}'s parley`);
}

async function useAt(p: Pilot, x: number, z: number, label: string, within = 1.4): Promise<void> {
  await p.goTo(x, z, { within, sprint: false, label });
  await p.face(x, z);
  await p.use(label);
}

/** Carries a prop of `kind` from near (fx, fz) to (tx, tz) and presses Use there. */
async function carry(p: Pilot, kind: number, fx: number, fz: number, tx: number, tz: number, label: string, within = 1.6): Promise<boolean> {
  if (!(await pickUp(p, kind, fx, fz))) return false;
  await useAt(p, tx, tz, label, within);
  await p.sleep(400);
  return true;
}

export const PLANS: Plan[] = [
  {
    name: "crossing-pay",
    join: { region: "kessar", scenario: "secure_crossing", seed: SEED },
    expect: ["paid", "bargained"],
    async run(p) {
      await p.goTo(A.tollBar.x, A.tollBar.z + 3, { label: "toll bar" });
      if (!(await talkTo(p, "warden", 1.4))) return;
      (await p.pick(/^Pay|Agree|Pay the toll/i)) >= 0 || (await p.pick(/Haggle|bargain/i));
      await p.until(() => p.view?.resolution !== undefined, 8000, "settled");
      await sailHome(p, A.landing);
    },
  },
  {
    name: "crossing-run-the-bar",
    join: { region: "kessar", scenario: "secure_crossing", seed: SEED },
    expect: ["forced", "abandoned"],
    async run(p) {
      await p.goTo(A.tollBar.x, A.tollBar.z + 3, { label: "toll bar" });
      // a person who ignores the bar and walks up the fort road
      await p.goTo(0, -14, { label: "fort road", ms: 30_000 });
      await p.sleep(7000);
      p.note(`hostile? phase=${p.view?.phase}`);
      await fight(p, "sentry", 60_000);
    },
  },
  {
    name: "crossing-force",
    join: { region: "kessar", scenario: "secure_crossing", seed: SEED },
    expect: ["forced", "abandoned"],
    async run(p) {
      p.debug("give:all");
      await p.goTo(0, 34, { label: "south end of the bridge" });
      await fight(p, "sentry", 120_000);
    },
  },
  {
    name: "crossing-sabotage",
    join: { region: "kessar", scenario: "secure_crossing", seed: SEED },
    expect: ["sabotaged"],
    async run(p) {
      if (!(await pickUp(p, PropKind.BARREL, A.powder.x, A.powder.z))) return;
      await p.goTo(A.pier.x + 0.8, A.pier.z, { within: 1.2, sprint: false, label: "the pier" });
      await p.face(A.pier.x, A.pier.z);
      await p.use("set the charge");
      await p.sleep(300);
      // clear the deck
      await p.goTo(0, 40, { label: "clear of the bridge" });
      await p.until(() => p.view?.resolution !== undefined, 20_000, "the bridge to go");
    },
  },
  {
    name: "hostage-ransom",
    join: { region: "kessar", scenario: "hostage_rescue", seed: SEED },
    expect: ["ransomed"],
    async run(p) {
      if (!(await talkTo(p, "deserter-0", 1.8))) return;
      await p.pick(/^Pay/);
      await p.until(() => p.view?.resolution !== undefined || p.parley === undefined, 6000, "ransom answer");
      if (p.parley) await p.pick(/^Pay/);
      await p.until(() => p.view?.resolution !== undefined, 120_000, "Mr. Quim walked home");
      if (p.view?.resolution === undefined) await p.goTo(A.landing.x, A.landing.z, { within: 4, label: "landing with Quim" });
      await p.until(() => p.view?.resolution !== undefined, 120_000, "resolution");
    },
  },
  {
    name: "hostage-slip",
    join: { region: "kessar", scenario: "hostage_rescue", seed: SEED },
    expect: ["slipped_away", "rescued"],
    async run(p) {
      // from the ford, wide round the east side of the orchard (away from the lookout), then crouched in from the north, between the two northern carousers
      const C = KS.hostage.cage;
      await p.goTo(A.ford.x, A.ford.z - 6, { label: "the ford" });
      await p.goTo(88, 0, { label: "east of the orchard" });
      await p.goTo(C.x, C.z + 14, { label: "north of the orchard", sprint: false });
      p.holdButtons(BUTTON.CROUCH);
      await p.goTo(C.x, C.z + 1.6, { within: 0.6, sprint: false, label: "the cage", ms: 120_000 });
      await p.face(C.x, C.z);
      await p.use("open the cage");
      await p.sleep(1000);
      // and out the way it came, still crouched until clear, Quim behind
      const q = (): string => { const n = p.npc("hostage"); return n ? `${n.x.toFixed(1)},${n.z.toFixed(1)}` : "gone"; };
      await p.goTo(C.x, C.z + 14, { sprint: false, label: "north of the orchard with Quim", ms: 60_000 });
      p.note(`Quim at ${q()}`);
      p.holdButtons(0);
      await p.goTo(88, 0, { sprint: false, label: "east of the orchard with Quim" });
      p.note(`Quim at ${q()}`);
      await p.goTo(A.landing.x, A.landing.z - 4, { within: 3, sprint: false, label: "the landing with Quim", ms: 150_000 });
      const quim = (): string => { const q = p.npc("hostage"); return q ? `${q.x.toFixed(1)},${q.z.toFixed(1)} hp ${q.health}` : "gone"; };
      p.note(`Quim at ${quim()}`);
      await p.until(() => p.view?.resolution !== undefined, 60_000, "resolution");
      p.note(`Quim at ${quim()}`);
    },
  },
  {
    name: "convoy-ambush",
    join: { region: "kessar", scenario: "convoy_ambush", seed: SEED },
    expect: ["seized", "burned"],
    async run(p) {
      p.debug("give:all");
      await p.goTo(KS.convoy.cut.x, KS.convoy.cut.z + 6, { label: "the Dry Cut" });
      await p.until(() => p.npcs("guard").some(([, n]) => Math.hypot(n.x - KS.convoy.cut.x, n.z - KS.convoy.cut.z) < 30), 120_000, "the wagon at the Cut");
      await fight(p, "guard", 90_000);
      // take the wagon: Use beside it
      const w = [...p.bot.room.state.mounts.values()].find((m) => (m as { kind?: number }).kind !== undefined) as { x: number; z: number } | undefined;
      if (w) await useAt(p, w.x, w.z, "take the wagon", 2.6);
      await p.until(() => p.view?.resolution !== undefined, 20_000, "resolution");
    },
  },
  {
    name: "border-mediate",
    join: { region: "kessar", scenario: "border_incident", seed: SEED },
    expect: ["mediated"],
    async run(p) {
      await p.goTo(KS.border.rival[1]!.x, KS.border.rival[1]!.z + 3, { label: "the Syndicate bank" });
      if (await talkTo(p, "rival-0")) await p.pick(/joint survey/i);
      await p.sleep(800);
      if (p.parley) await p.pick(/Walk away/);
      await p.goTo(A.ford.x, A.ford.z - 12, { label: "the Ward bank" });
      if (await talkTo(p, "ward-0")) await p.pick(/joint survey/i);
      // the neutral party stands at the Stone while both chains go out
      await p.goTo(KS.border.marker.x, KS.border.marker.z, { within: 2, sprint: false, label: "Marker Stone No. 4" });
      await p.until(() => p.view?.resolution !== undefined, 45_000, "resolution");
    },
  },
  {
    name: "succession-back-elder",
    join: { region: "highmark", seed: SEED },
    expect: ["backed_elder"],
    async run(p) {
      // two barrels of grain from the quay to the Grange's delegates on the granary terrace, then the court
      for (const i of [0, 1]) {
        const g = p.npc(`grange-${i}`);
        if (!g) break;
        await carry(p, PropKind.BARREL, H.landing.x - 6, H.landing.z - 6, g.x, g.z, `grain to delegate ${i}`, 1.8);
      }
      await p.goTo(H.capital.court.x, H.capital.court.z + 6, { label: "the court" });
      if (await talkTo(p, "chamberlain")) await p.pick(/File Form 11/);
      if (await talkTo(p, "claimant-elder")) await p.pick(/^Pledge/);
      await p.until(() => p.view?.resolution !== undefined, 240_000, "the harvest bell");
    },
  },
  {
    name: "strike-honest-measure",
    join: { region: "highmark", scenario: "reapers_strike", seed: SEED },
    expect: ["honest_measure"],
    async run(p) {
      // D-042: hear the Compact out, fetch the royal bushel from the granary scale up the hill, weigh it in front of the Steward, then both signatures
      if (await talkTo(p, "foreperson")) {
        await p.pick(/Ask why/);
        await p.pick(/Walk away/);
      }
      const st = p.npc("steward");
      if (!st || !(await carry(p, PropKind.BARREL, HS.strike.scale.x, HS.strike.scale.z, st.x, st.z, "the royal bushel to the Steward", 1.8))) return;
      if (await talkTo(p, "steward")) await p.pick(/honest measure/);
      if (await talkTo(p, "foreperson")) await p.pick(/honest measure/);
      await p.until(() => p.view?.resolution !== undefined, 8000, "resolution");
      await sailHome(p, H.landing);
    },
  },
  {
    name: "strike-let-through",
    join: { region: "highmark", scenario: "reapers_strike", seed: SEED },
    expect: ["strike_broken"],
    async run(p) {
      // D-042: stand at the picket line and do nothing; the barge lands, its men march up the road into the barley
      await p.goTo(HS.strike.foreperson.x + 3, HS.strike.foreperson.z + 2, { label: "the picket line" });
      await p.until(() => p.view?.resolution !== undefined, 300_000, "the strike-breakers");
    },
  },
  {
    name: "strike-turn-breakers",
    join: { region: "highmark", scenario: "reapers_strike", seed: SEED },
    expect: ["barley_lost", "abandoned"],
    async run(p) {
      // D-042: meet the barge's men on the road and fight them; a turned crew breaks nothing, so the rain settles it
      await p.goTo(-4, 84, { label: "the road below the barley" });
      await p.until(() => p.npcs("breaker-").length > 0, 240_000, "the barge");
      await fight(p, "breaker-", 120_000);
      await p.until(() => p.view?.resolution !== undefined, 480_000, "the rain");
    },
  },
  {
    name: "strike-bonus",
    join: { region: "highmark", scenario: "reapers_strike", seed: SEED },
    expect: ["bought_back"],
    async run(p) {
      if (await talkTo(p, "foreperson")) await p.pick(/harvest bonus/);
      await p.until(() => p.view?.resolution !== undefined, 8000, "resolution");
    },
  },
  {
    name: "mine-dig-out",
    join: { region: "vesper", scenario: "mine_rescue", seed: SEED },
    expect: ["dug_out"],
    async run(p) {
      for (let i = 0; i < 3; i++) await carry(p, PropKind.CRATE, VK.timber[0]!.x, VK.timber[0]!.z, VK.dig.x, VK.dig.z + 1.2, `timber ${i + 1}`, 1.6);
      // dig: Use with empty hands at the fall, over and over
      const end = Date.now() + 180_000;
      while (Date.now() < end && p.view?.resolution === undefined) {
        await p.use();
        await p.sleep(150);
      }
    },
  },
  {
    name: "claim-stake",
    join: { region: "vesper", scenario: "claim_race", seed: SEED },
    expect: ["staked"],
    async run(p) {
      for (const [i, pg] of VS.claimPegs.entries()) await useAt(p, pg.x, pg.z, `peg ${i}`, 1.2);
      if (await talkTo(p, "assayer")) await p.pick(/^File the claim/);
      await p.until(() => p.view?.resolution !== undefined, 30_000, "resolution");
    },
  },
  {
    name: "engine-foul",
    join: { region: "vesper", scenario: "winding_engine", seed: SEED },
    expect: ["engine_fouled"],
    async run(p) {
      // D-044: a crate of tailings from the heap on the ore road, up the terrace's east ramp (a laden walker cannot jump the side bank the nav grid would cut up), to the boiler's feed
      if (!(await pickUp(p, PropKind.CRATE, VS.engine.grit[0]!.x, VS.engine.grit[0]!.z))) return;
      await p.goTo(24, -38, { within: 2, label: "the foot of the terrace ramp" });
      await useAt(p, VS.engine.boiler.x, VS.engine.boiler.z, "grit into the feed", 1.8);
      await p.until(() => p.view?.resolution !== undefined, 8000, "resolution");
    },
  },
  {
    name: "raid-pay",
    join: { region: "kessar", scenario: "outpost_raid", seed: SEED },
    expect: ["protection_paid"],
    async run(p) {
      // wait in the yard for the landing, then walk out to the captain at the muster and buy the season
      await p.goTo(KO.site.x, KO.site.z, { within: 3, label: "the post's yard" });
      await p.until(() => p.npc("captain") !== undefined, 140_000, "the landing");
      await p.until(() => { const c = p.npc("captain"); return c !== undefined && Math.hypot(c.x - RS.muster.x, c.z - RS.muster.z) < 2; }, 40_000, "the captain halted at the muster");
      if (await talkTo(p, "captain", 2)) await p.pick(/protection/);
      await p.until(() => p.view?.resolution !== undefined, 8000, "resolution");
    },
  },
  {
    name: "raid-hold",
    // (seed 4243: no complication, five raiders; SEED's campaign deals the reinforcements, seven, which a lone rifle is not meant to hold)
    join: { region: "kessar", scenario: "outpost_raid", seed: 4243 },
    expect: ["post_held", "post_burned", "abandoned"],
    async run(p) {
      // hold the yard: let them land and muster, and fire when they come across the open ground (not at the landing, 30 m off, which only starts it sooner)
      await p.goTo(KO.site.x, KO.site.z - 3, { within: 2, label: "the post's yard" });
      await p.until(() => p.npcs("raider-").length > 0, 160_000, "the landing");
      await p.until(() => p.view?.phase === "fighting", 80_000, "the captain's watch");
      await fight(p, "raider-", 240_000);
      await p.until(() => p.view?.resolution !== undefined, 60_000, "resolution");
    },
  },
  {
    name: "raid-let-burn",
    join: { region: "kessar", scenario: "outpost_raid", seed: SEED },
    expect: ["post_burned"],
    async run(p) {
      // stand well off by the toll bar and watch the smoke
      await p.goTo(2, 10, { within: 3, label: "the toll bar" });
      await p.until(() => p.view?.resolution !== undefined, 400_000, "the smoke");
    },
  },
  // D-045 at a real post (the dev-forced contract founds none; `outpost:<stage>` does, and rebuilds the collision world): the raiders walk in through the stockade's north gate
  {
    name: "raid-burn-fortified",
    join: { region: "kessar", scenario: "outpost_raid", seed: 4243 },
    expect: ["post_burned"],
    async run(p) {
      p.debug("outpost:fortified_outpost");
      await p.goTo(2, 10, { within: 3, label: "the toll bar" });
      await p.until(() => p.view?.resolution !== undefined, 400_000, "the smoke");
    },
  },
  {
    name: "raid-burn-town",
    join: { region: "kessar", scenario: "outpost_raid", seed: 4243 },
    expect: ["post_burned"],
    async run(p) {
      p.debug("outpost:town");
      await p.goTo(2, 10, { within: 3, label: "the toll bar" });
      await p.until(() => p.view?.resolution !== undefined, 400_000, "the smoke");
    },
  },
  {
    name: "raid-hold-fortified",
    join: { region: "kessar", scenario: "outpost_raid", seed: 4243 },
    expect: ["post_held", "post_burned", "abandoned"],
    async run(p) {
      p.debug("outpost:fortified_outpost");
      await p.sleep(1500);
      // the back of the yard, the gate in front: the raiders must come through it and across the yard (a man at the gate itself met five at sabre range: tried, D-047)
      await p.goTo(KO.site.x, KO.site.z + 5, { within: 1.5, label: "the back of the yard" });
      await p.until(() => p.npcs("raider-").length > 0, 160_000, "the landing");
      await p.until(() => p.view?.phase === "fighting", 80_000, "the captain's watch");
      await fight(p, "raider-", 240_000, true);
      await p.until(() => p.view?.resolution !== undefined, 60_000, "resolution");
    },
  },
  {
    name: "engine-buy",
    join: { region: "vesper", scenario: "winding_engine", seed: SEED },
    expect: ["engine_bought"],
    async run(p) {
      if (await talkTo(p, "engineer")) await p.pick(/inspection/);
      await p.until(() => p.view?.resolution !== undefined, 8000, "resolution");
    },
  },
  {
    name: "engine-blow",
    join: { region: "vesper", scenario: "winding_engine", seed: SEED },
    expect: ["engine_blown", "abandoned"],
    async run(p) {
      // the Company's keg from its magazine by the fall, up to the boiler, lit, and then away
      if (!(await pickUp(p, PropKind.BARREL, VK.keg.x, VK.keg.z))) return;
      await p.goTo(24, -38, { within: 2, label: "the foot of the terrace ramp" });
      await useAt(p, VS.engine.boiler.x, VS.engine.boiler.z, "the keg under the boiler", 1.8);
      await p.goTo(VS.engine.yard.x - 22, VS.engine.yard.z + 20, { label: "away from the fuse", sprint: true });
      await p.until(() => p.view?.resolution !== undefined, 20_000, "the blast");
    },
  },
  {
    name: "engine-let-run",
    join: { region: "vesper", scenario: "winding_engine", seed: SEED },
    expect: ["vein_struck"],
    async run(p) {
      await p.goTo(V.headframe.x - 14, V.headframe.z + 30, { label: "below the terrace" });
      await p.until(() => p.view?.resolution !== undefined, 480_000, "the cross-cut");
    },
  },
  {
    name: "smuggle-courtesy-land",
    join: { region: "saltmarket", scenario: "smuggling_run", seed: SEED },
    expect: ["landed"],
    async run(p) {
      if (await talkTo(p, "reeve")) await p.pick(/courtesy/i);
      for (let i = 0; i < 3 && p.view?.resolution === undefined; i++) await carry(p, PropKind.CRATE, SA.cove.x, SA.cove.z, SP.dropDoor.x + 0.9, SP.dropDoor.z, `crate ${i + 1}`, 0.7);
      await p.until(() => p.view?.resolution !== undefined, 20_000, "resolution");
    },
  },
  {
    name: "market-consortium",
    join: { region: "saltmarket", scenario: "flooded_market", seed: SEED },
    expect: ["consortium", "lot_won"],
    async run(p) {
      // in the bidding first (the Houses pool with bidders, not spectators): a bid at the Auctioneer's price
      if (await talkTo(p, "auctioneer")) await p.pick(/^Bid £/);
      await p.sleep(500);
      if (p.parley) await p.pick(/Walk away/);
      for (const i of [0, 1]) {
        if (await talkTo(p, `head-${i}`)) await p.pick(/consortium/i);
        await p.sleep(500);
        if (p.parley) await p.pick(/Walk away/);
        if (p.view?.resolution) break;
      }
      await p.until(() => p.view?.resolution !== undefined, 30_000, "resolution");
    },
  },
];
