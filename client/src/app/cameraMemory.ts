import type { EntityState } from "../sim/matchSnapshot";

/** A camera ground target in cells (spec 08 §3.2). */
export interface ViewPoint {
  x: number;
  y: number;
}

export interface CameraMemory {
  /** Stores `current` as `from`'s last view and returns `to`'s last view,
   *  or null when `to` has none yet. */
  switchPlayer(from: number, to: number, current: ViewPoint): ViewPoint | null;
}

export function createCameraMemory(): CameraMemory {
  return { switchPlayer: () => null };
}

/** The player's main base: their HQ, else their first building in
 *  `entities` order, else null. */
export function homeView(
  _entities: readonly EntityState[],
  _player: number,
  _hqKind: number | null,
  _isBuilding: (kind: number) => boolean,
): ViewPoint | null {
  return null;
}
