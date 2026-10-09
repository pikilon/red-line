import type { Mesh } from "three";

export const PASSABLE_COLOR = 0x4a6b3a;
export const BLOCKED_COLOR = 0x5a5a5a;

export function createTerrain(
  _width: number,
  _height: number,
  _tiles: Uint8Array,
): Mesh {
  throw new Error("not implemented");
}
