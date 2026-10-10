import { describe, expect, it } from "vitest";
import { LIMB, NPC, REQUESTS, WEAPON, ZONE, billLine, spectacle, type ScenarioTemplateId } from "@cb/shared";
import { GAP, Mayhem, type HitFact } from "./Mayhem.ts";

/** A room with a party of two (Ada, Bram), a hired rifle, two Ward sentries, a Syndicate guard and a carter (a bystander). */
function setup(template: ScenarioTemplateId = "secure_crossing", day = 3) {
  const rows: Record<string, { name: string; npc: number }> = {
    ada: { name: "Ada", npc: 0 }, bram: { name: "Bram", npc: 0 }, "npc:hand": { name: "Rifleman Tobias Fenn", npc: NPC.HIRED_RIFLE },
    "npc:s1": { name: "Picket Corporal Dunstan Aldous", npc: NPC.SENTRY }, "npc:s2": { name: "Picket Mabel Quenby", npc: NPC.SENTRY },
    "npc:g1": { name: "Scout Fitzwilliam Hale-Dunmarrow", npc: NPC.RIVAL_GUARD }, "npc:carter": { name: "Carter Obadiah Plume", npc: NPC.DRIVER },
  };
  const printed: string[] = [];
  let changed = 0;
  const m = new Mayhem({ row: (id) => rows[id], print: (t) => printed.push(t), changed: () => changed++ });
  m.begin(1234, day, template);
  const hit = (over: Partial<HitFact>): void => m.onHit({ victim: "npc:s1", by: "ada", weapon: WEAPON.RIFLE, zone: ZONE.TORSO, down: false, power: 0.5, lift: 0, dirX: 0, dirZ: 1, ...over });
  const run = (seconds: number): void => {
    for (let i = 0; i < seconds * 10; i++) m.tick(0.1);
  };
  return { m, printed, hit, run, changed: () => changed };
}

describe("D-084: the bill as the fight happens", () => {
  it("counts who the party put down and how, and what came off whom", () => {
    const { m, hit } = setup();
    hit({ down: true, zone: ZONE.HEAD }); // a clean shot to the head
    hit({ victim: "npc:s2", weapon: WEAPON.UMBRELLA, down: true }); // an umbrella
    hit({ victim: "npc:g1", weapon: WEAPON.SABRE, zone: ZONE.ARM_L, severed: LIMB.ARM_L }); // a sabre takes an arm, standing
    hit({ victim: "npc:carter", down: true }); // a bystander
    hit({ victim: "bram", by: "ada", down: true }); // a colleague
    hit({ victim: "ada", by: "npc:g1", weapon: WEAPON.PISTOL, severed: LIMB.LEG_R }); // our own loss
    const b = m.bill;
    expect(b.foes).toBe(2);
    expect(b.headshots).toBe(1);
    expect(b.brolly).toBe(1);
    expect(b.limbs).toBe(1);
    expect(b.bladeLimbs).toBe(1);
    expect(b.civilians).toBe(1);
    expect(b.friendly).toBe(1);
    expect(b.partyDowns).toBe(1);
    expect(b.ownLimbs).toBe(1);
  });

  it("the hired hands are the expedition (their shots count for the Hatters and against the Temperance League); a horse and an enemy are nobody's spectacle but cost the party", () => {
    const { m, hit } = setup();
    hit({ victim: "npc:s1", by: "npc:hand", down: true, zone: ZONE.HEAD });
    m.onShot("npc:hand");
    hit({ victim: "ada", by: "mount", weapon: undefined, down: true });
    hit({ victim: "bram", by: "npc:g1", weapon: WEAPON.PISTOL, down: true, zone: ZONE.HEAD });
    expect(m.bill.headshots).toBe(1);
    expect(m.bill.shots).toBe(1);
    expect(m.bill.partyDowns).toBe(2);
    expect(m.bill.foes).toBe(1);
  });

  it("a blast that throws a body far enough is a flight (the longest kept, with whose); a gentle one is not", () => {
    const { m, hit } = setup();
    hit({ victim: "npc:s1", weapon: WEAPON.CANNON, down: true, power: 1, lift: 0.9 });
    hit({ victim: "npc:s2", weapon: WEAPON.CANNON, down: true, power: 0.3, lift: 0.2 });
    m.onToss("npc:g1", "ada", 1, 1, LIMB.LEG_L, 1, 0); // a fallen guard thrown again, and a leg off
    expect(m.bill.flings).toBe(2);
    expect(m.bill.longestWho).toBe("Scout Fitzwilliam Hale-Dunmarrow");
    expect(m.bill.longest).toBeGreaterThanOrEqual(15);
    expect(m.bill.limbs).toBe(1);
    expect(m.bill.bladeLimbs).toBe(0);
  });

  it("kegs going up in quick succession are one chain; a pause starts another", () => {
    const { m, run } = setup();
    m.onKeg("ada");
    run(0.8);
    m.onKeg("ada");
    run(0.8);
    m.onKeg("ada");
    run(6);
    m.onKeg("ada");
    expect(m.bill.kegs).toBe(4);
    expect(m.bill.chain).toBe(3);
  });

  it("powder nobody in the party lit is news, not the party's bill (the wagon's accident, a guard's stray round)", () => {
    const { m, printed, run } = setup("secure_crossing");
    for (let i = 0; i < 5; i++) m.onKeg("npc:accident");
    run(6);
    m.onKeg("npc:g1");
    run(GAP + 6);
    expect(m.bill.kegs).toBe(0);
    expect(m.bill.chain).toBe(0);
    expect(printed.some((t) => /kegs/i.test(t))).toBe(true);
    m.onKeg("npc:hand"); // (a hired hand's is the expedition's)
    expect(m.bill.kegs).toBe(1);
  });

  it("the party's rounds are counted (the Temperance League listens); nobody else's", () => {
    const { m } = setup();
    m.onShot("npc:s1");
    m.onShot("cannon:1");
    expect(m.bill.shots).toBe(0);
    m.onShot("bram");
    expect(m.bill.shots).toBe(1);
  });
});

describe("D-084: the column stays calm", () => {
  it("one line at a time, never closer than GAP seconds, the best of each moment first, and what goes stale is dropped", () => {
    const { printed, hit, run } = setup();
    // a cannonade: four things at once
    hit({ victim: "npc:carter", down: true });
    hit({ victim: "npc:s1", down: true, zone: ZONE.HEAD });
    hit({ victim: "npc:s2", weapon: WEAPON.SABRE, severed: LIMB.ARM_R });
    hit({ victim: "npc:g1", weapon: WEAPON.UMBRELLA, down: true });
    run(0.15);
    expect(printed.length).toBe(1);
    expect(printed[0]).toMatch(/umbrella|Quenby/); // (a limb or an umbrella, the best of the four)
    run(GAP - 0.4);
    expect(printed.length).toBe(1);
    run(0.6);
    expect(printed.length).toBe(2);
    run(10);
    expect(printed.length).toBeLessThanOrEqual(3); // (the bystander and the headshot went stale behind the better news)
  });

  it("a streak of downs by one hand makes the column once at two and once at three", () => {
    const { printed, hit, run } = setup();
    hit({ victim: "npc:s1", down: true });
    run(0.5);
    hit({ victim: "npc:s2", down: true });
    run(3);
    expect(printed.some((l) => l.includes("Ada") && /two/.test(l))).toBe(true);
  });
});

describe("D-084: the commission", () => {
  it("a loud request is met the moment it is: the column says so first, the objective is ticked, the republish is asked for", () => {
    const { m, printed, hit, run, changed } = setup();
    (m as unknown as { request: string }).request = "limbs";
    const before = changed();
    hit({ victim: "npc:s1", weapon: WEAPON.SABRE, severed: LIMB.ARM_L });
    expect(m.objective().done).toBe(false);
    expect(m.objective().text).toContain("1 of 2");
    hit({ victim: "npc:s2", weapon: WEAPON.SABRE, severed: LIMB.LEG_L });
    expect(m.objective().done).toBe(true);
    expect(changed()).toBeGreaterThan(before);
    run(0.2);
    expect(printed[0]).toBe(REQUESTS.limbs.met);
    const s = m.settle({ resolution: "forced", seconds: 200 });
    expect(s.met).toBe(true);
    expect(s.reward).toBe(REQUESTS.limbs.reward);
    expect(s.spectacle).toBe(6);
    expect(s.spectacleLine).toContain("£6");
  });

  it("a quiet request is settled at the end: met by a run that fired nothing, not by one abandoned", () => {
    const run = (): Mayhem => {
      const { m } = setup("mine_rescue", 5);
      expect(REQUESTS[m.request].quiet).toBe(true);
      (m as unknown as { request: string }).request = "temperance";
      return m;
    };
    expect(run().settle({ resolution: "dug_out", seconds: 400 }).met).toBe(true);
    expect(run().settle({ resolution: "abandoned", seconds: 400 }).met).toBe(false);
    const shot = run();
    shot.onShot("ada");
    expect(shot.settle({ resolution: "dug_out", seconds: 400 }).met).toBe(false);
    expect(shot.objective().text).toContain("a shot was fired");
  });

  it("a quiet request met at the end shows as done on the orders (the debrief said it was paid; the orders still said \"so far, so quiet\")", () => {
    const { m, changed } = setup("mine_rescue", 5);
    (m as unknown as { request: string }).request = "temperance";
    const before = changed();
    expect(m.objective().done).toBe(false);
    expect(m.settle({ resolution: "dug_out", seconds: 400 }).met).toBe(true);
    expect(m.objective().done).toBe(true);
    expect(changed()).toBeGreaterThan(before);
  });

  it("the bill is paid once: a second commit without a new contract pays nothing", () => {
    const { m, hit } = setup();
    hit({ victim: "npc:s1", weapon: WEAPON.SABRE, severed: LIMB.ARM_L });
    expect(m.settle({ resolution: "forced", seconds: 100 }).spectacle).toBe(3);
    const again = m.settle({ resolution: "forced", seconds: 100 });
    expect(again.spectacle).toBe(0);
    expect(again.reward).toBe(0);
    expect(again.bill.limbs).toBe(0);
  });

  it("begin clears the last run's bill and deals afresh", () => {
    const { m, hit } = setup();
    hit({ down: true });
    m.begin(1234, 4, "convoy_ambush");
    expect(m.bill.foes).toBe(0);
    expect(m.objective().id).toBe("society");
    expect(m.objective().optional).toBe(true);
  });
});

describe("D-087: the party speaks", () => {
  function talking() {
    const rows: Record<string, { name: string; npc: number }> = {
      ada: { name: "Ada", npc: 0 }, bram: { name: "Bram", npc: 0 }, "npc:s1": { name: "Picket Dunstan", npc: NPC.SENTRY }, "npc:s2": { name: "Picket Mabel", npc: NPC.SENTRY },
      "npc:carter": { name: "Carter Plume", npc: NPC.DRIVER },
    };
    const barks: { id: string; k: string; salt: number }[] = [];
    const m = new Mayhem({ row: (id) => rows[id], print: () => {}, changed: () => {}, bark: (id, k, salt) => barks.push({ id, k, salt }) });
    m.begin(99, 2, "secure_crossing");
    const hit = (over: Partial<HitFact>): void => m.onHit({ victim: "npc:s1", by: "ada", weapon: WEAPON.RIFLE, zone: ZONE.TORSO, down: false, power: 0.5, lift: 0, dirX: 0, dirZ: 1, ...over });
    const run = (s: number): void => { for (let i = 0; i < s * 10; i++) m.tick(0.1); };
    return { m, barks, hit, run };
  }

  it("the one who did it speaks, and says the right kind of thing: a hat off, a foe down, a limb, an umbrella, a colleague shot, their own fall", () => {
    const { barks, hit, run } = talking();
    hit({ down: true, zone: ZONE.HEAD });
    run(6);
    hit({ victim: "npc:s2", weapon: WEAPON.UMBRELLA, down: true });
    run(6);
    hit({ victim: "bram", by: "ada", down: true });
    run(6);
    hit({ victim: "ada", by: "npc:s2", weapon: WEAPON.PISTOL, down: true });
    expect(barks.map((b) => `${b.id}:${b.k}`)).toEqual(["ada:headshot", "ada:brolly", "ada:friendly", "ada:down"]);
  });

  it("a bystander dropped earns no cheer; a wound that does not drop is no occasion; an NPC never barks", () => {
    const { barks, hit, run } = talking();
    hit({ victim: "npc:carter", down: true });
    hit({ down: false });
    hit({ victim: "npc:s2", by: "npc:s1", down: true });
    run(1);
    expect(barks).toEqual([]);
  });

  it("a fight is a few voices, not a choir: a speaker waits five seconds, the party a second and a half", () => {
    const { barks, hit, run } = talking();
    hit({ down: true });
    hit({ victim: "npc:s2", down: true });
    expect(barks.length, "the same speaker, at once").toBe(1);
    hit({ victim: "npc:s2", by: "bram", down: true });
    expect(barks.length, "another, too soon after").toBe(1);
    run(2);
    hit({ victim: "npc:s2", by: "bram", down: true });
    expect(barks.map((b) => b.id)).toEqual(["ada", "bram"]);
    run(4);
    hit({ victim: "npc:s1", by: "ada", down: true });
    expect(barks.map((b) => b.id)).toEqual(["ada", "bram", "ada"]);
  });

  it("a chain of three is the party's cheer; a body thrown far is its owner's yelp", () => {
    const { m, barks, run } = talking();
    m.onKeg("ada");
    m.onKeg("ada");
    m.onKeg("ada");
    run(2);
    m.onToss("bram", "", 1, 1, undefined, 0, 1);
    expect(barks.map((b) => `${b.id}:${b.k}`)).toEqual(["ada:chain", "bram:flung"]);
  });
});

describe("D-105: the coup de grace", () => {
  it("the party finishing an enemy is billed, printed and boasted of; finishing a colleague, a bystander, or by the enemy is not the Society's spectacle", () => {
    const rows: Record<string, { name: string; npc: number }> = {
      ada: { name: "Ada", npc: 0 }, "npc:hand": { name: "Rifleman Tobias Fenn", npc: NPC.HIRED_RIFLE },
      "npc:s1": { name: "Picket Corporal Dunstan Aldous", npc: NPC.SENTRY }, "npc:carter": { name: "Carter Obadiah Plume", npc: NPC.DRIVER },
    };
    const printed: { t: string; k: string }[] = [];
    const barks: { id: string; kind: string }[] = [];
    const m = new Mayhem({ row: (id) => rows[id], print: (t, k) => printed.push({ t, k }), changed: () => undefined, bark: (id, kind) => barks.push({ id, kind }) });
    m.begin(1234, 3, "secure_crossing");
    m.onFinisher("npc:s1", "ada", WEAPON.SABRE);
    expect(m.bill.finishers).toBe(1);
    expect(barks).toEqual([{ id: "ada", kind: "finisher" }]);
    for (let i = 0; i < 40; i++) m.tick(0.1);
    expect(printed.some((p) => p.k === "finisher" && p.t.includes("Picket Corporal Dunstan Aldous") && p.t.includes("Ada"))).toBe(true);
    // a hired hand finishing counts for the expedition too
    m.onFinisher("npc:s1", "npc:hand", WEAPON.FISTS);
    expect(m.bill.finishers).toBe(2);
    // not the Society's: a bystander, one of our own, or the enemy doing it
    m.onFinisher("npc:carter", "ada", WEAPON.SABRE);
    m.onFinisher("npc:hand", "ada", WEAPON.SABRE);
    m.onFinisher("npc:hand", "npc:s1", WEAPON.SABRE);
    m.onFinisher("nobody", "ada", WEAPON.SABRE);
    expect(m.bill.finishers).toBe(2);
  });
});

describe("D-106: the lariat in the bill", () => {
  it("a loop the party lands on an enemy or a bystander is billed, printed and shouted; one on our own, or by the enemy, is not", () => {
    const rows: Record<string, { name: string; npc: number }> = {
      ada: { name: "Ada", npc: 0 }, bram: { name: "Bram", npc: 0 }, "npc:s1": { name: "Picket Corporal Dunstan Aldous", npc: NPC.SENTRY }, "npc:carter": { name: "Carter Obadiah Plume", npc: NPC.DRIVER },
    };
    const printed: { t: string; k: string }[] = [];
    const barks: string[] = [];
    const m = new Mayhem({ row: (id) => rows[id], print: (t, k) => printed.push({ t, k }), changed: () => undefined, bark: (_id, kind) => barks.push(kind) });
    m.begin(99, 2, "secure_crossing");
    m.onRoped("npc:s1", "ada");
    m.onRoped("npc:carter", "ada");
    m.onRoped("bram", "ada");
    m.onRoped("npc:carter", "npc:s1");
    expect(m.bill.ropes).toBe(2);
    expect(barks.filter((k) => k === "rope").length).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < 60; i++) m.tick(0.1);
    expect(printed.some((p) => p.k === "rope" && p.t.includes("Ada"))).toBe(true);
  });
});

describe("D-108: the boot in the bill", () => {
  it("a boot the party lands on a stranger is billed and shouted; a man it throws into the scenery is billed and printed; our own and the enemy's are not", () => {
    const rows: Record<string, { name: string; npc: number }> = {
      ada: { name: "Ada", npc: 0 }, bram: { name: "Bram", npc: 0 }, "npc:s1": { name: "Picket Corporal Dunstan Aldous", npc: NPC.SENTRY },
    };
    const printed: { t: string; k: string }[] = [];
    const barks: string[] = [];
    const m = new Mayhem({ row: (id) => rows[id], print: (t, k) => printed.push({ t, k }), changed: () => undefined, bark: (_id, kind) => barks.push(kind) });
    m.begin(99, 2, "secure_crossing");
    m.onBoot("npc:s1", "ada");
    m.onBoot("bram", "ada");
    m.onBoot("ada", "npc:s1");
    expect(m.bill.boots).toBe(1);
    expect(barks).toContain("boot");
    m.onSplat("npc:s1", "ada");
    m.onSplat("bram", "npc:s1");
    expect(m.bill.splats).toBe(1);
    for (let i = 0; i < 60; i++) m.tick(0.1);
    expect(printed.some((p) => p.k === "splat" && p.t.includes("Ada") && p.t.includes("Dunstan"))).toBe(true);
  });
});

describe("D-111: ridden down, in the bill", () => {
  it("a man the party rides down is billed, shouted and printed; one of our own, or by the enemy, is not; the debrief and the Committee count it", () => {
    const rows: Record<string, { name: string; npc: number }> = {
      ada: { name: "Ada", npc: 0 }, bram: { name: "Bram", npc: 0 }, "npc:s1": { name: "Picket Corporal Dunstan Aldous", npc: NPC.SENTRY },
    };
    const printed: { t: string; k: string }[] = [];
    const barks: string[] = [];
    const m = new Mayhem({ row: (id) => rows[id], print: (t, k) => printed.push({ t, k }), changed: () => undefined, bark: (_id, kind) => barks.push(kind) });
    m.begin(99, 2, "secure_crossing");
    m.onTrample("npc:s1", "ada");
    m.onTrample("bram", "ada");
    m.onTrample("ada", "npc:s1");
    expect(m.bill.trampled).toBe(1);
    expect(barks).toEqual(["trample"]);
    for (let i = 0; i < 60; i++) m.tick(0.1);
    expect(printed.some((p) => p.k === "trample" && p.t.includes("Ada") && p.t.includes("Dunstan"))).toBe(true);
    expect(billLine(m.bill)).toContain("1 man ridden down");
    expect(spectacle(m.bill).pay).toBe(2);
  });
});

describe("D-112: the human shield, in the bill", () => {
  it("a man the party takes up as a shield is billed, shouted and printed; his own side shooting him is billed and printed once a man; none of it for our own", () => {
    const rows: Record<string, { name: string; npc: number }> = {
      ada: { name: "Ada", npc: 0 }, bram: { name: "Bram", npc: 0 }, "npc:s1": { name: "Picket Corporal Dunstan Aldous", npc: NPC.SENTRY },
    };
    const printed: { t: string; k: string }[] = [];
    const barks: string[] = [];
    const m = new Mayhem({ row: (id) => rows[id], print: (t, k) => printed.push({ t, k }), changed: () => undefined, bark: (_id, kind) => barks.push(kind) });
    m.begin(99, 2, "secure_crossing");
    m.onSeize("npc:s1", "ada");
    m.onSeize("bram", "ada");
    expect(m.bill.shields).toBe(1);
    expect(barks).toEqual(["shield"]);
    m.onShieldShot("npc:s1", "ada");
    m.onShieldShot("npc:s1", "ada"); // (the second round of the same volley)
    expect(m.bill.comrades).toBe(1);
    for (let i = 0; i < 80; i++) m.tick(0.1);
    expect(printed.some((p) => p.k === "shield_shot" && p.t.includes("Ada") && p.t.includes("Dunstan"))).toBe(true);
    expect(billLine(m.bill)).toContain("1 man held up as a shield (1 shot by his own side)");
    expect(spectacle(m.bill).pay).toBe(4);
  });
});

describe("D-113: the hold-up, in the bill", () => {
  it("a man held up at gunpoint is billed, shouted and printed; shooting him afterwards is billed and printed once; none of it for our own", () => {
    const rows: Record<string, { name: string; npc: number }> = {
      ada: { name: "Ada", npc: 0 }, bram: { name: "Bram", npc: 0 }, "npc:s1": { name: "Picket Corporal Dunstan Aldous", npc: NPC.SENTRY },
    };
    const printed: { t: string; k: string }[] = [];
    const barks: string[] = [];
    const m = new Mayhem({ row: (id) => rows[id], print: (t, k) => printed.push({ t, k }), changed: () => undefined, bark: (_id, kind) => barks.push(kind) });
    m.begin(99, 2, "secure_crossing");
    m.onHoldUp("npc:s1", "ada");
    m.onHoldUp("bram", "ada");
    expect(m.bill.holdups).toBe(1);
    expect(barks).toEqual(["holdup"]);
    m.onUnsporting("npc:s1", "ada");
    m.onUnsporting("npc:s1", "bram");
    expect(m.bill.unsporting).toBe(1);
    for (let i = 0; i < 80; i++) m.tick(0.1);
    expect(printed.some((p) => p.k === "unsporting" && p.t.includes("Dunstan"))).toBe(true);
    expect(billLine(m.bill)).toContain("1 man held up at gunpoint");
    expect(billLine(m.bill)).toContain("1 man shot with his hands up");
  });
});

