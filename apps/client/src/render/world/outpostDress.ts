import { Group, Mesh, type Object3D } from "three";
import type { CollisionWorld, RegionDress, RegionId } from "@cb/shared";
import { makeSolid, toonMaterial } from "./toon.ts";
import { buildOutpostGeometry, buildRoadRibbon } from "./kessar/outpost.ts";
import { boardLetteringGeometry, boardLetteringMaterial, boardLetteringTexture, outpostBoards } from "./outpostSigns.ts";

/**
 * What the Society (and, at Kessar, the Syndicate) has built in a region, swapped in place under the view's root when the dress changes (D-035; D-056 for every region with a
 * site): the stage's solids and the foundation's stakes as ONE merged solid with its ink hull, the boards' lettering, plus (Kessar only) the wire, the launch, the rival's post and the road ribbon.
 * The collision world is the integrator's business (`worldKey`); this only changes what is drawn.
 */
export class OutpostDress {
  private group?: Group;
  private owned: { dispose(): void }[] = [];
  private key = "";

  constructor(private readonly root: Object3D, private readonly world: CollisionWorld, private readonly outlines: boolean, private readonly region: RegionId) {}

  /** True when something was rebuilt (the caller recounts its stats). */
  apply(d: RegionDress): boolean {
    const key = `${d.outpost}|${d.rivalPost}|${d.road}|${d.telegraph}|${d.launch}|${d.name}|${d.railway === true}|${d.works === true}`;
    if (key === this.key) return false;
    this.key = key;
    this.clear();
    const group = new Group();
    group.name = "outpost";
    const geo = buildOutpostGeometry(this.world, d, this.outlines ? 1 : 0, this.region);
    if (geo) {
      const hull = this.outlines ? buildOutpostGeometry(this.world, d, 0, this.region) : undefined;
      this.owned.push(geo);
      if (hull) this.owned.push(hull);
      const mat = toonMaterial({ wetDark: 0.8 });
      this.owned.push(mat);
      makeSolid(group, geo, mat, { name: "outpost", outline: this.outlines, ink: "medium", hullGeometry: hull, castShadow: true });
    }
    // the boards, lettered: the post's name and what it has become; the Syndicate's own at Kessar
    const boards = outpostBoards(this.world, d, this.region);
    const letters = boardLetteringGeometry(boards);
    if (letters) {
      const tex = boardLetteringTexture(boards);
      const mat = boardLetteringMaterial(tex);
      this.owned.push(letters, mat);
      if (tex) this.owned.push(tex);
      const mesh = new Mesh(letters, mat);
      mesh.name = "outpost-boards";
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    const road = this.region === "kessar" ? buildRoadRibbon(this.world, d.road) : undefined;
    if (road) {
      this.owned.push(road);
      const mat = toonMaterial({ wetDark: 0.8 });
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -2;
      mat.polygonOffsetUnits = -2;
      this.owned.push(mat);
      const mesh = new Mesh(road, mat);
      mesh.name = "road-paint";
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.root.add(group);
    this.group = group;
    return true;
  }

  clear(): void {
    if (this.group) {
      this.root.remove(this.group);
      this.group = undefined;
    }
    for (const d of this.owned) d.dispose();
    this.owned = [];
  }
}
