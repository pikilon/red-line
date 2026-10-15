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
  /** Stored views by player id, for saves (spec 19 §5.1). */
  views(): Record<string, ViewPoint>;
}

/** `initial`: views restored from a save (spec 19 §5.3). */
export function createCameraMemory(
  initial: Readonly<Record<string, ViewPoint>> = {},
): CameraMemory {
  const views = new Map<number, ViewPoint>(
    Object.entries(initial).map(([player, view]) => [
      Number(player),
      { x: view.x, y: view.y },
    ]),
  );
  return {
    views() {
      return Object.fromEntries(
        [...views].map(([player, view]) => [String(player), { ...view }]),
      );
    },
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
