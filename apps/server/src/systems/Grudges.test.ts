import { describe, expect, it } from "vitest";
import { FLAG, GRUDGE, LIMB, NPC, WEAPON, newCampaign, type CampaignState, type Grudge, type NpcSpec, type PlayerStateType, type WeaponId } from "@cb/shared";
import { Grudges } from "./Grudges.ts";

/** D-109: survivors with grudges on the server. The run's worst-used soldier is remembered; a remembered man takes a soldier's place, speaks once, and spends a return when beaten. */
const spec = (id: string, over: Partial<NpcSpec> = {}): NpcSpec => ({
  id, role: NPC.SENTRY, faction: "ward", side: "ward", group: "ward", post: { x: 0, z: 0 }, weapon: WEAPON.RIFLE as WeaponId, lookSeed: 100 + id.length, name: `Sentry ${id} Cray`, skill: 50, bravery: 50, brain: "garrison", ...over,
});
const row = (x: number, z: number, npc: number, name = ""): PlayerStateType => ({ x, y: 0, z, flags: FLAG.GROUNDED, npc, connected: true, name, health: 100 }) as PlayerStateType;

function rig() {
  const rows = new Map<string, PlayerStateType>();
  const specs = new Map<string, NpcSpec>();
  const said: string[] = [];
  const beaten: string[] = [];
  const g = new Grudges({
    players: { forEach: (cb) => rows.forEach((p, id) => cb(p, id)), get: (id) => rows.get(id) },
    specOf: (k) => specs.get(k),
    returned: (k, gr) => void said.push(`${k}:${gr.by}`),
    beaten: (k, _gr, by) => void beaten.push(`${k}:${by}`),
  });
  const add = (s: NpcSpec, x = 0, z = 0): string => {
    const k = `npc:${s.id}`;
    specs.set(k, s);
    rows.set(k, row(x, z, s.role, s.name));
    return k;
  };
  rows.set("ada", row(0, 50, 0, "Ada"));
  return { rows, specs, said, beaten, g, add };
}

const remembered = (over: Partial<Grudge> = {}): Grudge => ({
  name: "Sentry Tamsin Cray", role: NPC.SENTRY, lookSeed: 4242, faction: "ward", region: "kessar", missing: LIMB.ARM_R, burnt: false, cause: "limb", by: "Ada", day: 2, returns: 0, people: "kessarine", ...over,
});
const withGrudges = (list: Grudge[], day = 4): CampaignState => {
  const c = newCampaign(3);
  return { ...c, day, sites: { ...c.sites, grudges: list } };
};

describe("D-109: the account of a run", () => {
  it("the worst-used soldier is remembered (a limb outweighs a boot), by the hand that did it; a civilian, a hand or an incident's man never are", () => {
    const { g, add } = rig();
    const c0 = newCampaign(3);
    g.begin(c0, "kessar", 1);
    const a = add(spec("a"));
    const b = add(spec("bb", { lookSeed: 777, people: "kessarine" }));
    const folk = add(spec("folk", { brain: "civil", side: "neutral", group: "folk" }));
    const hand = add(spec("hand", { brain: "follower", side: "party", group: "party" }));
    const coll = add(spec("coll", { group: "incident" }));
    g.onInsult(a, "boot", "ada");
    g.onInsult(a, "rope", "ada");
    g.onMaimed(b, LIMB.LEG_L, "ada");
    for (const k of [folk, hand, coll]) g.onMaimed(k, LIMB.ARM_L, "ada");
    const c = g.settle({ ...c0, day: 2 });
    expect(c.sites.grudges).toHaveLength(1);
    expect(c.sites.grudges![0]).toMatchObject({ name: "Sentry bb Cray", lookSeed: 777, missing: LIMB.LEG_L, cause: "limb", by: "Ada", day: 2, region: "kessar", returns: 0, people: "kessarine" });
  });

  it("the fire is nobody's hand; a quiet run remembers nobody and leaves the ledger as it was", () => {
    const { g, add } = rig();
    const c0 = newCampaign(3);
    g.begin(c0, "kessar", 1);
    g.onBurnt(add(spec("x")));
    expect(g.settle(c0).sites.grudges![0]).toMatchObject({ cause: "fire", burnt: true, by: "" });
    g.begin(c0, "kessar", 1);
    expect(g.settle(c0)).toBe(c0);
  });
});

describe("D-109: the man who comes back", () => {
  it("takes the place of the first soldier of his side and role: his name with the nickname, his face, a hook, a steadier nerve; once a run", () => {
    const { g } = rig();
    g.begin(withGrudges([remembered()]), "kessar", 4);
    const batch = [spec("cap", { role: NPC.WARDEN }), spec("s0"), spec("s1"), spec("rv", { faction: "rival", side: "rival", group: "rival" })];
    const out = g.respec(batch);
    expect(out).not.toBe(batch);
    expect(out[0]).toBe(batch[0]); // (the warden keeps his place: a sentry's is taken)
    const him = out[1]!;
    expect(him.id).toBe("s0");
    expect(him.name).toBe('Sentry Tamsin "Hook" Cray');
    expect(him.lookSeed).toBe(4242);
    expect(him.people).toBe("kessarine");
    expect(him.look).toMatchObject({ hook: 2 });
    expect(him.peg).toBe(false);
    expect(him.skill).toBe(50 + GRUDGE.skill);
    expect(him.bravery).toBe(50 + GRUDGE.bravery);
    expect(g.fielded?.key).toBe("npc:s0");
    expect(g.respec(batch)).toBe(batch); // (once)
    // he is on the roster himself (the same face and name, further down): he takes his own place, never a comrade's (the first live look found a twin standing beside him)
    const r1 = rig();
    r1.g.begin(withGrudges([remembered()]), "kessar", 4);
    const roster = [spec("s0"), spec("s1"), spec("s2", { lookSeed: 4242, name: "Sentry Tamsin Cray" })];
    const placed = r1.g.respec(roster);
    expect(placed[0]).toBe(roster[0]);
    expect(placed[2]!.name).toBe('Sentry Tamsin "Hook" Cray');
    expect(placed.filter((x) => x.lookSeed === 4242)).toHaveLength(1);
    // a leg: back on a peg
    const r2 = rig();
    r2.g.begin(withGrudges([remembered({ missing: LIMB.LEG_R })]), "kessar", 4);
    expect(r2.g.respec([spec("s0")])[0]!.peg).toBe(true);
    // not in another region, nor before his night
    const r3 = rig();
    r3.g.begin(withGrudges([remembered()]), "highmark", 4);
    expect(r3.g.respec([spec("s0")])[0]!.name).toBe("Sentry s0 Cray");
    r3.g.begin(withGrudges([remembered({ day: 4 })]), "kessar", 4);
    expect(r3.g.fielded).toBeUndefined();
  });

  it("speaks once, when one of the party comes within earshot; beaten again he spends a return, and after his last he is forgotten", () => {
    const { rows, said, beaten, g, specs } = rig();
    const c = withGrudges([remembered()]);
    g.begin(c, "kessar", 4);
    g.respec([spec("s0")]);
    specs.set("npc:s0", spec("s0"));
    rows.set("npc:s0", row(0, 0, NPC.SENTRY, 'Sentry Tamsin "Hook" Cray'));
    g.tick();
    expect(said).toEqual([]); // (she is 50 m off)
    rows.get("ada")!.z = GRUDGE.speakR - 1;
    g.tick();
    g.tick();
    expect(said).toEqual(["npc:s0:Ada"]);
    g.onDown("npc:s0", "ada");
    expect(beaten).toEqual(["npc:s0:Ada"]);
    const after = g.settle({ ...c, day: 5 });
    expect(after.sites.grudges).toHaveLength(1);
    expect(after.sites.grudges![0]).toMatchObject({ returns: 1, day: 5, lookSeed: 4242 });
    // his last return: beaten again, forgotten
    g.begin(after, "kessar", 6);
    g.respec([spec("s0")]);
    g.onDown("npc:s0", "ada");
    expect(g.settle({ ...after, day: 6 }).sites.grudges).toBeUndefined();
  });

  it("a man who came back and was not beaten waits for the next time, as he was", () => {
    const { g } = rig();
    const c = withGrudges([remembered()]);
    g.begin(c, "kessar", 4);
    g.respec([spec("s0")]);
    expect(g.settle({ ...c, day: 5 }).sites.grudges).toEqual([remembered()]);
  });
});
