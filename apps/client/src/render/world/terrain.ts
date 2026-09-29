import { BufferAttribute, Color, PlaneGeometry, SRGBColorSpace, type BufferGeometry } from "three";
import { ARENA_RADIUS, groundColour, smoothstep, type Rgb, type Terrain } from "@cb/shared";

/** How far past the playable radius the visible ground keeps its shape before it settles flat onto the skirt. */
export const TERRAIN_FADE = 22;

/** Terrain height as drawn: exactly the simulated height inside the arena, easing to a flat plain beyond it (nobody can stand out there). */
export function visualHeight(h: number, x: number, z: number): number {
  return h * (1 - smoothstep(ARENA_RADIUS, ARENA_RADIUS + TERRAIN_FADE, Math.hypot(x, z)));
}

/**
 * The ground mesh: a segment grid over the arena and a margin, displaced by the shared height function and painted per vertex with
 * `groundColour` (patches, hollows and rises, worn clearing, track, hearth, rocky slopes). Smooth normals: the toon ramp turns them
 * into clean bands across the swells.
 */
export function buildTerrain(terrain: Terrain, segments: number): BufferGeometry {
  const size = ARENA_RADIUS * 2 + 60;
  const geo = new PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as BufferAttribute;
  const colours = new Float32Array(pos.count * 3);
  const rgb: Rgb = { r: 0, g: 0, b: 0 };
  const c = new Color();
  const e = 0.6;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = terrain.height(x, z);
    const slope = Math.hypot(terrain.height(x + e, z) - h, terrain.height(x, z + e) - h) / e;
    pos.setY(i, visualHeight(h, x, z));
    groundColour(x, z, h, slope, rgb);
    c.setRGB(rgb.r, rgb.g, rgb.b, SRGBColorSpace);
    colours[i * 3] = c.r;
    colours[i * 3 + 1] = c.g;
    colours[i * 3 + 2] = c.b;
  }
  geo.deleteAttribute("uv");
  geo.setAttribute("color", new BufferAttribute(colours, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}
