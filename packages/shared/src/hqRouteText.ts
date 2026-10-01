/**
 * The lettering on the HQ route's finger-posts (D-035, R). Authored copy: the Society is helpful in the way a closed door is helpful.
 * `{m}` is the walking distance in metres, filled in by `hqRoute()`. Boards are short (the strip is ~28 letters) and the fictional world has no real places.
 */

export const ROUTE_TEXT = {
  /** The forward board of each dock post, nearest the camp first: where it points, and how far. */
  dockAhead: ["THE DOCK  {m} m", "THE DOCK  {m} m  (by the footbridge)", "THE DOCK  {m} m", "THE BOAT TO KESSAR  {m} m"],
  /** The back board: the way home. */
  dockBack: ["CAMP  {m} m", "CAMP  {m} m  (the kettle is on)", "CAMP  {m} m", "CAMP  {m} m  (it will keep)"],
  /** A third board, angled off to the side: the Society's advice. */
  dockAside: ["PLEASE KEEP TO THE IMPROVED PATH", "FOOTBRIDGE: HOLD THE RAIL", "THE VILLAGE IS NOT A WELCOME PARTY", "SAILINGS ARE OPTIONAL; FORM 7 IS NOT"],
  mapAhead: ["THE MAP ROOM", "THE SURVEY  (consult, do not correct)"],
  mapBack: ["CAMP  {m} m", "THE DOCK  (follow the posts)"],
  mapAside: ["SUPPLIES: THE PYRAMID", "MIND THE LANTERN POST"],
} as const;
