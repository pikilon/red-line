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
  const views = new Map<number, ViewPoint>();
  return {
    switchPlayer(from, to, current) {
      views.set(from, { x: current.x, y: current.y });
      const view = views.get(to);
      return view === undefined ? null : { x: view.x, y: view.y };
    },
  };
}

/** The player's main base: their HQ, else their first building in
 *  `entities` order, else null. */
export function homeView(
  entities: readonly EntityState[],
  player: number,
  hqKind: number | null,
  isBuilding: (kind: number) => boolean,
): ViewPoint | null {
  const own = entities.filter((entity) => entity.owner === player);
  const home =
    own.find((entity) => entity.kind === hqKind) ??
    own.find((entity) => isBuilding(entity.kind));
  return home === undefined ? null : { x: home.x, y: home.y };
}
