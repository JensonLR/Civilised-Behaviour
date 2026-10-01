import { describe, expect, it } from "vitest";
import {
  AUDIT,
  auditRegion,
  checkDoor,
  checkRoute,
  floodFill,
  footprintOverlaps,
  overAllowance,
  penetration,
  roomAt,
  walkTo,
  type AuditDoor,
  type AuditFootprint,
  type FindingKind,
  type RegionAuditInput,
} from "./levelAudit.ts";
import { CollisionWorld, type Obstacle } from "./collision.ts";

/**
 * The audit's own proof: a tiny synthetic region in which every kind of fault is planted on purpose (and a clean twin of each), so the checks are known to FIRE
 * and known to stay quiet. The real regions are audited over seeds by `levelAuditRegions.test.ts` (package L).
 */

const flat = { height: (): number => 0 };
const T = 0.3;

/** A hut centred on (cx, cz) facing +x, half-sizes (hx, hz), a doorway `door` wide (0 = sealed): four wall boxes in one group. */
function hut(group: string, cx: number, cz: number, hx: number, hz: number, door: number): Obstacle[] {
  const box = (x: number, z: number, ex: number, ez: number): Obstacle => ({ kind: "box", tag: "house", x: cx + x, z: cz + z, hx: ex, hz: ez, yaw: 0, y0: -1, y1: 2.6 });
  const out = [box(-hx + T / 2, 0, T / 2, hz), box(0, -hz + T / 2, hx, T / 2), box(0, hz - T / 2, hx, T / 2)];
  if (door <= 0) out.push(box(hx - T / 2, 0, T / 2, hz));
  else {
    const side = (hz - door / 2) / 2;
    out.push(box(hx - T / 2, -(door / 2 + side), T / 2, side), box(hx - T / 2, door / 2 + side, T / 2, side));
  }
  return out;
}

const fps = (group: string, obs: Obstacle[]): AuditFootprint[] => obs.map((shape, i) => ({ id: `${group}.${i}`, group, kind: "building", shape }));

function region(opts: { points?: boolean; door?: number; sealedLeads?: boolean; props?: { x: number; z: number }[]; extra?: Obstacle[]; spawn?: { x: number; z: number } }): RegionAuditInput {
  const door = opts.door ?? 1.5;
  const a = hut("hutA", 0, 0, 3, 3, door);
  const obstacles = [...a, ...(opts.extra ?? [])];
  const world = new CollisionWorld(flat, obstacles, 60);
  const d: AuditDoor = {
    id: "hutA.door",
    building: "hutA",
    x: 3,
    z: 0,
    yaw: 0,
    width: door > 0 ? door : 1.5,
    height: 2.3,
    leads: opts.sealedLeads ? "sealed" : "interior",
    room: { x: 0, z: 0, hx: 2.6, hz: 2.6, yaw: 0, lit: true },
  };
  return {
    region: "hollowmere",
    seed: 1,
    world,
    footprints: [...fps("hutA", a), ...(opts.extra ?? []).map((shape, i): AuditFootprint => ({ id: `extra.${i}`, group: `extra${i}`, kind: "prop", shape }))],
    doors: [d],
    points: [...(opts.points === false ? [] : [{ id: "hut-floor", x: 0, z: 0, mustReach: true }]), { id: "far", x: 20, z: 20, mustReach: true }],
    routes: [],
    props: (opts.props ?? []).map((p, i) => ({ id: `p${i}`, x: p.x, z: p.z, r: 0.4 })),
    spawns: [opts.spawn ?? { x: 10, z: 0 }],
  };
}

const kinds = (r: ReturnType<typeof auditRegion>): FindingKind[] => r.findings.filter((f) => f.severity === "error").map((f) => f.kind);

describe("geometry", () => {
  it("penetration is exact for circles and boxes, zero for touching", () => {
    const c = (x: number, z: number, r: number): Obstacle => ({ kind: "circle", x, z, r, y0: 0, y1: 1 });
    const b = (x: number, z: number, hx: number, hz: number, yaw = 0): Obstacle => ({ kind: "box", x, z, hx, hz, yaw, y0: 0, y1: 1 });
    expect(penetration(c(0, 0, 1), c(1.5, 0, 1))).toBeCloseTo(0.5, 6);
    expect(penetration(c(0, 0, 1), c(2, 0, 1))).toBe(0);
    expect(penetration(c(0, 0, 1), b(1.5, 0, 1, 1))).toBeCloseTo(0.5, 6);
    expect(penetration(b(0, 0, 1, 1), b(1.5, 0, 1, 1))).toBeCloseTo(0.5, 6);
    expect(penetration(b(0, 0, 1, 1), b(2, 0, 1, 1))).toBe(0);
    expect(penetration(b(0, 0, 1, 1), b(0, 0, 0.2, 0.2, 0.7))).toBeGreaterThan(1);
    // a rotated box that only its corner pokes into
    expect(penetration(b(0, 0, 1, 1), b(2.2, 0, 1, 1, Math.PI / 4))).toBeGreaterThan(0);
    expect(penetration(b(0, 0, 1, 1), b(2.6, 0, 1, 1, Math.PI / 4))).toBe(0);
  });
});

describe("the real step", () => {
  it("walks open ground and stops at a wall", () => {
    const w = new CollisionWorld(flat, [{ kind: "box", x: 5, z: 0, hx: 0.2, hz: 4, yaw: 0, y0: -1, y1: 3 }], 60);
    expect(walkTo(w, 0, undefined, 0, 3, 0).ok).toBe(true);
    const blocked = walkTo(w, 0, undefined, 0, 8, 0);
    expect(blocked.ok).toBe(false);
    expect(blocked.closest).toBeGreaterThan(2);
  });
  it("a long gentle descent is a walk, a lip is a fall (D-038: height lost while airborne, not the net descent)", () => {
    const hill = { height: (_x: number, z: number): number => Math.max(-1.6, 0.5 - z * 0.1) };   // 2.1 m lower over 21 m: a slope, not a drop
    expect(walkTo(new CollisionWorld(hill, [], 80), 0, undefined, 0, 0, 20).ok).toBe(true);
    const lip = { height: (_x: number, z: number): number => (z < 10 ? 0.5 : -1.8) };
    const w = walkTo(new CollisionWorld(lip, [], 80), 0, undefined, 0, 0, 20);
    expect(w.fell).toBe(true);
    expect(w.ok).toBe(false);
  });
  it("route width over a deck is the deck's (a bridge over a cut is measured on the planks, not on the bed beneath)", () => {
    const cut = { height: (x: number, _z: number): number => (Math.abs(x) < 6 ? -2.3 : 0.4) };
    const deck: Obstacle = { kind: "box", tag: "bridge", x: 0, z: 0, hx: 2.4, hz: 10, yaw: 0, y0: -0.4, y1: 0.4 };
    const rails: Obstacle[] = [-1, 1].map((s) => ({ kind: "box", tag: "wall", x: s * 2.7, z: 0, hx: 0.3, hz: 10, yaw: 0, y0: -0.4, y1: 1.5 }));
    const w = new CollisionWorld(cut, [deck, ...rails], 60);
    expect(checkRoute("hollowmere", w, { id: "b", class: "street", points: [{ x: 0, z: -9 }, { x: 0, z: 9 }] }).filter((f) => f.severity === "error")).toEqual([]);
  });
  it("flood fill goes through a body-wide gap and not through a thinner one", () => {
    const wall = (gap: number): Obstacle[] => [
      { kind: "box", x: 0, z: -(gap / 2 + 45), hx: 0.3, hz: 45, yaw: 0, y0: -1, y1: 3 },
      { kind: "box", x: 0, z: gap / 2 + 45, hx: 0.3, hz: 45, yaw: 0, y0: -1, y1: 3 },
    ];
    for (const [gap, through] of [[1.4, true], [1.0, true], [0.7, false]] as const) {
      const w = new CollisionWorld(flat, wall(gap), 40);
      const f = floodFill(w, [{ x: -10, z: 0 }], { cell: 0.5 });
      expect(f.reached(10, 0, 0.5), `gap ${gap}`).toBe(through);
    }
  });
});

describe("a door at the top of a stair is reached (D-038)", () => {
  it("a deck 1.2 m up on 0.5 m treads is not 'unreachable' just because the 1 m flood grid skips a tread", () => {
    // a deck at 1.2 m with a door facing +x and a stair of two treads (0.8 and 0.4 high, 0.5 m deep each) going down to the ground at x = 5.2
    const walls = hut("deckhut", 0, 0, 3, 3, 1.5).map((o) => ({ ...o, y0: 1.0, y1: 3.8 }) as Obstacle);
    const deck: Obstacle = { kind: "box", tag: "house", x: 0, z: 0, hx: 4.2, hz: 3.2, yaw: 0, y0: -1, y1: 1.2 };
    const stair: Obstacle[] = [{ kind: "box", tag: "house", x: 4.45, z: 0, hx: 0.25, hz: 0.8, yaw: 0, y0: -1, y1: 0.8 }, { kind: "box", tag: "house", x: 4.95, z: 0, hx: 0.25, hz: 0.8, yaw: 0, y0: -1, y1: 0.4 }];
    const world = new CollisionWorld(flat, [deck, ...walls, ...stair], 40);
    const door: AuditDoor = { id: "d", building: "deckhut", x: 3, z: 0, yaw: 0, width: 1.5, height: 2.4, leads: "interior", room: { x: 0, z: 0, hx: 2.6, hz: 2.6, yaw: 0, lit: true }, floorY: 1.2 };
    const fp: AuditFootprint[] = [deck, ...walls, ...stair].map((shape, i) => ({ id: `p${i}`, group: "deckhut", kind: "building", shape }));
    const reach = floodFill(world, [{ x: 10, z: 0 }], { cell: 1 });
    const found = checkDoor(door, { region: "hollowmere", world, footprints: fp, reach });
    expect(found.filter((f) => f.kind === "door-unreachable")).toEqual([]);
  });
});

describe("planted faults are found, clean twins are not", () => {
  it("a clean hut with a proper door passes", () => {
    const r = auditRegion(region({}));
    expect(kinds(r)).toEqual([]);
    expect(r.stats.pointsReached).toBe(2);
  });
  it("a door cut too narrow, a door into a solid wall, and a sealed door that is declared", () => {
    expect(kinds(auditRegion(region({ door: 1.0 })))).toContain("door-too-narrow");
    // declared interior but the wall is whole: the walk from the door fails
    const solid = auditRegion(region({ door: 0 }));
    expect(kinds(solid)).toContain("door-into-wall");
    // declared sealed AND really sealed: fine (a visibly sealed facade is allowed)
    expect(kinds(auditRegion(region({ door: 0, sealedLeads: true, points: false })))).toEqual([]);
    // declared sealed but open: the audit says the door lies
    expect(kinds(auditRegion(region({ door: 1.5, sealedLeads: true })))).toContain("sealed-door-passable");
  });
  it("a door is floating when its building is somewhere else", () => {
    const r = region({});
    const moved: AuditDoor = { ...r.doors[0]!, x: 30, z: 30 };
    const f = checkDoor(moved, { region: "hollowmere", world: r.world, footprints: r.footprints });
    expect(f.map((x) => x.kind)).toContain("door-floating");
  });
  it("a crate in the doorway blocks the apron; a prop in a wall is inside the wall", () => {
    const crate: Obstacle = { kind: "box", tag: "crate", x: 4.2, z: 0, hx: 0.4, hz: 0.4, yaw: 0, y0: 0, y1: 0.8 };
    expect(kinds(auditRegion(region({ extra: [crate] })))).toContain("door-apron-blocked");
    const r = auditRegion(region({ props: [{ x: 3, z: 2 }, { x: 8, z: 8 }, { x: 4.4, z: 0 }] }));
    expect(r.findings.filter((f) => f.kind === "prop-in-wall").map((f) => f.subject)).toEqual(["p0"]);
    expect(r.findings.filter((f) => f.kind === "prop-on-door-apron").map((f) => f.subject)).toEqual(["p2"]);
  });
  it("footprints that intersect are reported, groups and contact are not", () => {
    const a = hut("hutA", 0, 0, 3, 3, 1.5);
    const into: Obstacle = { kind: "box", tag: "house", x: 3, z: 3, hx: 2, hz: 2, yaw: 0, y0: -1, y1: 3 };
    const all = [...fps("hutA", a), { id: "shed", group: "shed", kind: "building", shape: into } as AuditFootprint];
    const f = footprintOverlaps("hollowmere", all);
    expect(f.length).toBeGreaterThan(0);
    expect(f.every((x) => x.other === "shed" || x.subject === "shed")).toBe(true);
    // contact only
    const touch: Obstacle = { kind: "box", tag: "house", x: 3 + 0.3 + 2, z: 0, hx: 2, hz: 2, yaw: 0, y0: -1, y1: 3 };
    expect(footprintOverlaps("hollowmere", [...fps("hutA", a), { id: "touch", group: "touch", kind: "building", shape: touch }])).toEqual([]);
    // allowed pair
    expect(footprintOverlaps("hollowmere", all, [["hutA", "shed"]])).toEqual([]);
  });
  it("a spawn inside a wall and a spawn in a sealed pocket are stuck", () => {
    expect(kinds(auditRegion(region({ spawn: { x: 3, z: 2 } })))).toContain("stuck-spawn");
    // the hut's floor is a pocket when sealed: spawning inside a sealed hut cannot walk out
    const sealed = auditRegion(region({ door: 0, sealedLeads: true, spawn: { x: 0, z: 0 } }));
    expect(kinds(sealed)).toContain("stuck-spawn");
  });
  it("a story point behind a wall is unreachable", () => {
    const ring: Obstacle[] = [
      { kind: "box", x: 20, z: 17, hx: 4, hz: 0.3, yaw: 0, y0: -1, y1: 3 },
      { kind: "box", x: 20, z: 23, hx: 4, hz: 0.3, yaw: 0, y0: -1, y1: 3 },
      { kind: "box", x: 16, z: 20, hx: 0.3, hz: 3, yaw: 0, y0: -1, y1: 3 },
      { kind: "box", x: 24, z: 20, hx: 0.3, hz: 3, yaw: 0, y0: -1, y1: 3 },
    ];
    const r = auditRegion(region({ extra: ring }));
    expect(r.findings.some((f) => f.kind === "unreachable-point" && f.subject === "far" && f.severity === "error")).toBe(true);
  });
  it("a path pinched by a boulder is too narrow, an open one is not", () => {
    const w = new CollisionWorld(flat, [{ kind: "circle", x: 0, z: 1.7, r: 1, y0: -1, y1: 3 }, { kind: "circle", x: 0, z: -1.7, r: 1, y0: -1, y1: 3 }], 60);
    const pts = [{ x: -8, z: 0 }, { x: 8, z: 0 }];
    expect(checkRoute("hollowmere", w, { id: "lane", class: "street", points: pts }).map((f) => f.kind)).toEqual(["path-too-narrow"]);
    expect(checkRoute("hollowmere", w, { id: "stair", class: "street", minWidth: 1.2, points: pts })).toEqual([]);
    expect(checkRoute("hollowmere", new CollisionWorld(flat, [], 60), { id: "road", class: "road", points: pts })).toEqual([]);
  });
  it("the ratchet allows only what it is told to", () => {
    const r = auditRegion(region({ door: 1.0 }));
    expect(overAllowance(r, {}).length).toBeGreaterThan(0);
    expect(overAllowance(r, { "door-too-narrow": 1 })).toEqual([]);
  });
  it("is deterministic", () => {
    const a = JSON.stringify(auditRegion(region({ props: [{ x: 3, z: 2 }] })).findings);
    const b = JSON.stringify(auditRegion(region({ props: [{ x: 3, z: 2 }] })).findings);
    expect(a).toBe(b);
  });
  it("the standard's numbers are consistent", () => {
    expect(AUDIT.doorMinWidth).toBeGreaterThanOrEqual(0.8 + 0.4);
    expect(AUDIT.gateMinWidth).toBeGreaterThan(AUDIT.doorMinWidth);
    expect(AUDIT.doorMinHeight).toBeGreaterThan(1.8);
  });
});

describe("rooms", () => {
  it("roomAt finds the room a point is in, rotated and with a margin", () => {
    const rooms = [{ id: "a", x: 10, z: 0, hx: 2, hz: 1, yaw: 0 }, { id: "b", x: 0, z: 10, hx: 3, hz: 1, yaw: Math.PI / 2 }];
    expect(roomAt(rooms, 11, 0.5)?.id).toBe("a");
    expect(roomAt(rooms, 13, 0)).toBeUndefined();
    expect(roomAt(rooms, 13, 0, 1.5)?.id).toBe("a");
    expect(roomAt(rooms, 0.5, 12)?.id).toBe("b"); // b is rotated: its long axis runs along z
    expect(roomAt(rooms, 3, 10)).toBeUndefined();
  });
});
