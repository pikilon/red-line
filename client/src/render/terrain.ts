import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
} from "three";

export const PASSABLE_COLOR = 0x4a6b3a;
export const BLOCKED_COLOR = 0x5a5a5a;

const VERTICES_PER_TILE = 4;
const INDICES_PER_TILE = 6;

/** One Mesh, one indexed BufferGeometry: 4 vertices per tile at y = 0
 *  (tile (x, y) spans world x..x+1, z y..y+1), "position" and "color"
 *  attributes, MeshBasicMaterial({ vertexColors: true }). */
export function createTerrain(
  width: number,
  height: number,
  tiles: Uint8Array,
): Mesh {
  const tileCount = width * height;
  const positions = new Float32Array(tileCount * VERTICES_PER_TILE * 3);
  const colors = new Float32Array(tileCount * VERTICES_PER_TILE * 3);
  const indices = new Uint32Array(tileCount * INDICES_PER_TILE);
  const passable = new Color(PASSABLE_COLOR);
  const blocked = new Color(BLOCKED_COLOR);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = y * width + x;
      const color = (tiles[tile] ?? 0) === 0 ? passable : blocked;
      const corners = [
        [x, y],
        [x + 1, y],
        [x + 1, y + 1],
        [x, y + 1],
      ] as const;
      corners.forEach(([cx, cz], corner) => {
        const offset = (tile * VERTICES_PER_TILE + corner) * 3;
        positions.set([cx, 0, cz], offset);
        colors.set([color.r, color.g, color.b], offset);
      });
      const base = tile * VERTICES_PER_TILE;
      // Counter-clockwise seen from above (+y), so the faces point up.
      indices.set(
        [base, base + 2, base + 1, base, base + 3, base + 2],
        tile * INDICES_PER_TILE,
      );
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setIndex(Array.from(indices));
  return new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true }));
}
