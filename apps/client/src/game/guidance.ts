import { CAMP, objectiveMark, regionMarks, type RegionId, type ScenarioView } from "@cb/shared";
import { currentObjective } from "../ui/ObjectiveTracker.ts";

/**
 * Direction (D-063): the ONE thing to do next, and where. A fresh player said they had "zero direction of what I'm supposed to be doing": the HUD showed a checklist, a card of
 * orders, six place-pins and telegrams, and nowhere said "go there next". This picks a single line and a single place from what the game already knows, so the HUD can show one
 * line under the heading strip and one marker in the world. Pure: no DOM, no three.js (game/Game.ts feeds it, ui/Guide.ts draws it).
 */

export interface Guidance {
  /** One short line, imperative ("Walk to the map room and choose your first voyage"). */
  text: string;
  /** Where (world metres), when the line has a place. */
  x?: number;
  z?: number;
  /** What the marker over the place says ("Map room", "Toll bar"). */
  label?: string;
}

export interface GuideInput {
  region: RegionId;
  /** Travel.ts's phase: 0 ashore, 1 a sailing proposed (waiting on the party), 2+ under way. */
  travelPhase: number;
  downed: boolean;
  /** Expeditions the campaign has finished (0: this is the first time out). */
  expeditions: number;
  /** The contract in this region, if any. */
  view: ScenarioView | undefined;
}

export function guidance(s: GuideInput): Guidance | undefined {
  if (s.downed || s.travelPhase >= 2) return undefined; // (the down card and the sailing card speak for themselves)
  if (s.region === "hollowmere") {
    const at = { x: CAMP.mapTable.x, z: CAMP.mapTable.z, label: "Map room" };
    if (s.travelPhase === 1) return { text: "A sailing is proposed: confirm it at the map room", ...at };
    return s.expeditions === 0 ? { text: "Walk to the map room and choose your first voyage", ...at } : { text: "Choose your next voyage at the map room", ...at };
  }
  if (s.travelPhase === 1) {
    const home = regionMarks(s.region)[0];
    return { text: "A sailing is proposed: confirm it at the boat", ...(home ? { x: home.x, z: home.z, label: "Boat" } : {}) };
  }
  const view = s.view;
  const goal = objectiveMark(s.region, view);
  if (view && view.phase !== "resolved") {
    const cur = currentObjective(view);
    if (cur) return { text: cur.text, ...(goal ? { x: goal.x, z: goal.z, label: goal.label } : {}) };
  }
  // settled, or no contract here: the way home (objectiveMark points at the boat once settled; with no contract, the landing is the first region mark)
  const home = goal ?? regionMarks(s.region)[0];
  return { text: view?.phase === "resolved" ? "Contract settled: take the boat home" : "Take the boat home", ...(home ? { x: home.x, z: home.z, label: "Boat home" } : {}) };
}
