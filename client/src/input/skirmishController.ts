import {
  type OrthographicCamera,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
} from "three";
import { setCameraTarget } from "../camera";
import { typeDef } from "../rules";
import type { EntityState } from "../sim/matchSnapshot";
import type { SimCommand } from "../sim/protocol";
import { panDelta } from "./cameraPan";
import { boxSelect, clickSelect, selectAllOwnUnits } from "./entitySelection";
import { resolveRightClick } from "./intent";
import { canPlace, footprintOrigin } from "./placement";
import {
  isDrag,
  isSelectAllShortcut,
  rectFromDrag,
  type ScreenPoint,
  type ScreenRect,
} from "./selection";

export interface SkirmishControllerOptions {
  canvas: HTMLCanvasElement;
  /** Drag feedback; shown while the pointer is dragged, hidden on release. */
  selectionBox: { show(rect: ScreenRect | null): void };
  /** Receives keydown/keyup; the window, so keys work without focusing the canvas. */
  keyTarget: Pick<Window, "addEventListener">;
  camera: OrthographicCamera;
  mapWidth: number;
  mapHeight: number;
  /** Latest snapshot entities (not interpolated). */
  entities(): readonly EntityState[];
  /** Map cells, tile-major; 0 is passable (spec §5.15). */
  tiles(): Uint8Array;
  /** Latest fog: 0 unexplored, 1 explored, 2 visible (spec §5.15). */
  fog(): Uint8Array;
  /** Type index being placed, or null when not in placement mode. */
  placementKind(): number | null;
  /** Leaves placement mode. */
  exitPlacement(): void;
  /** The player whose units receive the orders. */
  player(): number;
  command(command: SimCommand): void;
  onSelectionChange(selected: ReadonlySet<number>): void;
  /** Enables the debug-only F2/F3 keys (spec §6.5). */
  debug: boolean;
  setControlledPlayer(player: number): void;
  toggleReveal(): void;
}

export interface PlacementPreview {
  kind: number;
  origin: { x: number; y: number };
  valid: boolean;
}

export interface SkirmishController {
  readonly selected: ReadonlySet<number>;
  cameraTarget(): { x: number; y: number };
  /** Clamped to [0, mapWidth] x [0, mapHeight]. */
  setTarget(x: number, y: number): void;
  /** Drops the selection, e.g. when the controlled player changes. */
  clearSelection(): void;
  /** Applies keyboard panning for one frame. */
  update(dtSeconds: number): void;
  /** Sim tiles -> page CSS px. */
  worldToScreen(x: number, y: number): ScreenPoint;
  /** Footprint ghost under the cursor while placing (spec §6.5). */
  placementPreview(): PlacementPreview | null;
}

const LEFT_BUTTON = 0;
const GROUND = new Plane(new Vector3(0, 1, 0), 0);

/** Mouse, keyboard and placement wiring of the skirmish (spec §6.5). */
export function createSkirmishController(
  options: SkirmishControllerOptions,
): SkirmishController {
  const { canvas, camera } = options;
  const selected = new Set<number>();
  const pressed = new Set<string>();
  const target = { x: 0, y: 0 };
  const raycaster = new Raycaster();
  let dragStart: ScreenPoint | null = null;
  // Pointer events carry sub-pixel coordinates; contextmenu may not.
  let lastPointer: ScreenPoint | null = null;

  function setSelection(ids: Iterable<number>): void {
    selected.clear();
    for (const id of ids) selected.add(id);
    options.onSelectionChange(selected);
  }

  function setTarget(x: number, y: number): void {
    target.x = Math.min(options.mapWidth, Math.max(0, x));
    target.y = Math.min(options.mapHeight, Math.max(0, y));
    setCameraTarget(camera, target.x, target.y);
    camera.updateMatrixWorld();
  }

  function worldToScreen(x: number, y: number): ScreenPoint {
    const ndc = new Vector3(x, 0, y).project(camera);
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + ((ndc.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - ndc.y) / 2) * rect.height,
    };
  }

  function groundAt(point: ScreenPoint): { x: number; y: number } | null {
    const rect = canvas.getBoundingClientRect();
    const ndc = new Vector2(
      ((point.x - rect.left) / rect.width) * 2 - 1,
      1 - ((point.y - rect.top) / rect.height) * 2,
    );
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.ray.intersectPlane(GROUND, new Vector3());
    return hit === null ? null : { x: hit.x, y: hit.z };
  }

  /** Lowest-id selected own unit whose type builds `kind`. */
  function placementDozer(kind: number): number | null {
    let dozer: number | null = null;
    for (const entity of options.entities()) {
      if (entity.owner !== options.player()) continue;
      if (!selected.has(entity.id)) continue;
      if (typeDef(entity.kind).category !== "unit") continue;
      if (!typeDef(entity.kind).builds.includes(kind)) continue;
      if (dozer === null || entity.id < dozer) dozer = entity.id;
    }
    return dozer;
  }

  function placeable(kind: number, origin: { x: number; y: number }): boolean {
    return canPlace({
      kind,
      origin,
      width: options.mapWidth,
      height: options.mapHeight,
      tiles: options.tiles(),
      fog: options.fog(),
      entities: options.entities(),
    });
  }

  /**
   * Handles a left click in placement mode: a legal site with a selected own
   * dozer sends `construct` and leaves placement; an illegal site, or one with
   * no dozer to build it, keeps placement mode (spec §6.5). Returns false when
   * not placing.
   */
  function tryPlace(x: number, y: number): boolean {
    const kind = options.placementKind();
    if (kind === null) return false;
    const origin = footprintOrigin(kind, x, y);
    if (!placeable(kind, origin)) return true;
    const dozer = placementDozer(kind);
    if (dozer === null) return true;
    options.command({
      kind: "construct",
      player: options.player(),
      dozer,
      typeIndex: kind,
      originX: origin.x,
      originY: origin.y,
    });
    options.exitPlacement();
    return true;
  }

  canvas.addEventListener("pointermove", (event) => {
    lastPointer = { x: event.clientX, y: event.clientY };
    if (dragStart !== null && isDrag(dragStart, lastPointer)) {
      options.selectionBox.show(rectFromDrag(dragStart, lastPointer));
    }
  });
  canvas.addEventListener("pointercancel", () => {
    dragStart = null;
    options.selectionBox.show(null);
  });
  canvas.addEventListener("pointerdown", (event) => {
    lastPointer = { x: event.clientX, y: event.clientY };
    if (event.button !== LEFT_BUTTON) return;
    dragStart = { x: event.clientX, y: event.clientY };
  });

  canvas.addEventListener("pointerup", (event) => {
    if (event.button !== LEFT_BUTTON || dragStart === null) return;
    const end = { x: event.clientX, y: event.clientY };
    const start = dragStart;
    dragStart = null;
    options.selectionBox.show(null);
    if (isDrag(start, end)) {
      setSelection(
        boxSelect(
          options.entities(),
          rectFromDrag(start, end),
          worldToScreen,
          options.player(),
        ),
      );
      return;
    }
    const ground = groundAt(end);
    if (ground !== null && tryPlace(ground.x, ground.y)) return;
    setSelection(
      ground === null
        ? []
        : clickSelect(options.entities(), ground.x, ground.y, options.player()),
    );
  });

  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    if (options.placementKind() !== null) {
      options.exitPlacement();
      return;
    }
    if (selected.size === 0) return;
    const point = lastPointer ?? { x: event.clientX, y: event.clientY };
    const ground = groundAt(point);
    if (ground === null) return;
    const commands = resolveRightClick({
      player: options.player(),
      selected: [...selected],
      entities: options.entities(),
      x: ground.x,
      y: ground.y,
    });
    for (const command of commands) options.command(command);
  });

  options.keyTarget.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && options.placementKind() !== null) {
      event.preventDefault();
      options.exitPlacement();
      return;
    }
    if (isSelectAllShortcut(event)) {
      event.preventDefault();
      setSelection(selectAllOwnUnits(options.entities(), options.player()));
      return;
    }
    if (options.debug && event.key === "F2") {
      event.preventDefault();
      setSelection([]);
      options.setControlledPlayer(options.player() === 0 ? 1 : 0);
      return;
    }
    if (options.debug && event.key === "F3") {
      event.preventDefault();
      options.toggleReveal();
      return;
    }
    pressed.add(event.code);
  });
  options.keyTarget.addEventListener("keyup", (event) => {
    pressed.delete(event.code);
  });
  options.keyTarget.addEventListener("blur", () => pressed.clear());

  return {
    selected,
    cameraTarget: () => ({ ...target }),
    setTarget,
    clearSelection() {
      setSelection([]);
    },
    update(dtSeconds) {
      const delta = panDelta(pressed, dtSeconds);
      if (delta.x !== 0 || delta.y !== 0) {
        setTarget(target.x + delta.x, target.y + delta.y);
      }
    },
    worldToScreen,
    placementPreview() {
      const kind = options.placementKind();
      if (kind === null || lastPointer === null) return null;
      const ground = groundAt(lastPointer);
      if (ground === null) return null;
      const origin = footprintOrigin(kind, ground.x, ground.y);
      return { kind, origin, valid: placeable(kind, origin) };
    },
  };
}
