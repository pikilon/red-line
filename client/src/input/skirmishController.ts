import { type OrthographicCamera, Raycaster, Vector2, Vector3 } from "three";
import { setCameraTarget, zoomAfterWheel } from "../camera";
import { groundY, pickGround } from "../render/elevation";
import { typeDef } from "../rules";
import { ENTITY_FLAGS, type EntityState, hasFlag } from "../sim/matchSnapshot";
import type { SimCommand } from "../sim/protocol";
import { panDelta } from "./cameraPan";
import { boxSelect, clickSelect, selectAllOwnUnits } from "./entitySelection";
import {
  blockSelection,
  type GarrisonFeature,
  resolveGarrisonClick,
  selectOccupantsAt,
} from "./garrison";
import { resolveClickOrder, resolveForceFire, resolveRally } from "./intent";
import { createPinchGesture } from "./pinch";
import { canPlace, footprintOrigin } from "./placement";
import {
  joinedTrenchLine,
  type RepairJob,
  resolveBuildingRepairClick,
  resolveDigClick,
  resolveDigLine,
  resolveInfirmaryClick,
  resolveRepairClick,
  resolveVehicleRepairClick,
  type TrenchSegment,
} from "./repair";
import {
  narrowToKind,
  sameTypeEverywhere,
  sameTypeOnScreen,
  selectedUnitKinds,
} from "./sameType";
import {
  isDrag,
  isSelectAllShortcut,
  rectFromDrag,
  type ScreenPoint,
  type ScreenRect,
} from "./selection";
import { resolveBoardClick } from "./transport";

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
  /** Spec 35 §5b: cells too hard to dig (hard ground, roads), 1 per cell. */
  hardCells?(): Uint8Array | undefined;
  /** Spec 35 §5b.3: cells covered by dug trenches (`y * mapWidth + x`). */
  trenchCells?(): ReadonlySet<number>;
  /** Latest fog: 0 unexplored, 1 explored, 2 visible (spec §5.15). */
  fog(): Uint8Array;
  /** Type index being placed, or null when not in placement mode. */
  placementKind(): number | null;
  /** Leaves placement mode. */
  exitPlacement(): void;
  /** The player whose units receive the orders. */
  player(): number;
  command(command: SimCommand): void;
  /** Garrisonable features of the map (spec 31 block 2); none when absent. */
  garrisonFeatures?(): readonly GarrisonFeature[];
  /** Spec 35: the map's bridges with their live damage; none when absent. */
  repairJobs?(): readonly RepairJob[];
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
  /** Spec 35: the next left click on the ground digs a trench there (Shift
   *  turns it); dragging draws a line of trenches (Shift keeps Dig armed); a
   *  second press of the button cancels. */
  armDig(): void;
  /** Spec 35 §5b.1: the trench segments of the line being drawn, with whether
   *  the client sees their cells open; null when no line is being drawn. */
  digPreview(): (TrenchSegment & { valid: boolean })[] | null;
  /** Spec 41: the Force fire button; the next left tap/click force-fires, a
   *  second press disarms. */
  toggleForceFire(): void;
  /** Spec 41: the Rally point button; the next left tap sets the rally of the
   *  selected producer. */
  toggleRally(): void;
  /** The armed map-tap mode of the command panel, if any. */
  armedMode(): "force" | "rally" | null;
  /** Spec 41: selects the selected unit types on the screen or the map. */
  selectSameType(scope: "screen" | "map"): void;
  /** Spec 41: narrows the selection to the entities of `kind`. */
  narrowTo(kind: number): void;
  cameraTarget(): { x: number; y: number };
  /** Clamped to [0, mapWidth] x [0, mapHeight]. */
  setTarget(x: number, y: number): void;
  /** Drops the selection, e.g. when the controlled player changes. */
  clearSelection(): void;
  /** Replaces the selection, e.g. when a save is restored (spec 19 §5.3). */
  setSelection(ids: Iterable<number>): void;
  /** Wheel zoom of the camera, 1 by default (spec 08 §3.4). */
  zoom(): number;
  /** Applies keyboard panning for one frame. */
  update(dtSeconds: number): void;
  /** Sim tiles -> page CSS px. */
  worldToScreen(x: number, y: number): ScreenPoint;
  /** Footprint ghost under the cursor while placing (spec §6.5). */
  placementPreview(): PlacementPreview | null;
}

const LEFT_BUTTON = 0;
/** Two clicks on the same unit within this window select its type (spec 41). */
const DOUBLE_CLICK_MS = 400;

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
  // Pointer events carry sub-pixel coordinates; the previews use them.
  let lastPointer: ScreenPoint | null = null;
  // Zero Hour's held force-attack mode (spec 20 §3): while Ctrl is down the
  // next click force-fires. On macOS the same gesture also raises contextmenu,
  // which the canvas only prevents; the pointerup does the ordering.
  let forceFireArmed = false;
  /** Spec 35: the Dig button was pressed; the next left click digs there. */
  let digArmed = false;
  /** Spec 41: the panel's Force fire / Rally point buttons armed the next tap. */
  let armedMode: "force" | "rally" | null = null;
  /** Spec 41 A3: the last plain click, for the same-type double click. */
  let lastClick: { id: number; time: number } | null = null;

  function setSelection(ids: Iterable<number>): void {
    armedMode = null;
    selected.clear();
    // Spec 35 §5c: soldiers in a trench are picked as the whole trench.
    for (const id of blockSelection(
      ids,
      options.entities(),
      options.garrisonFeatures?.() ?? [],
      options.player(),
    )) {
      selected.add(id);
    }
    options.onSelectionChange(selected);
  }

  function setTarget(x: number, y: number): void {
    target.x = Math.min(options.mapWidth, Math.max(0, x));
    target.y = Math.min(options.mapHeight, Math.max(0, y));
    setCameraTarget(camera, target.x, target.y);
    camera.updateMatrixWorld();
  }

  function worldToScreen(x: number, y: number): ScreenPoint {
    const ndc = new Vector3(x, groundY(x, y), y).project(camera);
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
    // The first hill or plateau the ray meets (spec 30 §4).
    return pickGround(raycaster.ray);
  }

  /**
   * Spec 20 §1: force fire under `point` with the armed selected units — an
   * enemy under the cursor is attacked, any other point gets a ground shot.
   */
  function forceFireAt(point: ScreenPoint): void {
    if (options.placementKind() !== null) return;
    if (selected.size === 0) return;
    const ground = groundAt(point);
    if (ground === null) return;
    const commands = resolveForceFire({
      player: options.player(),
      selected: [...selected],
      entities: options.entities(),
      x: ground.x,
      y: ground.y,
    });
    for (const command of commands) options.command(command);
  }

  /**
   * Spec 20 §1 / spec 08 §3.9: a plain left click on an enemy with own units
   * selected attacks it, so clicking the target is enough (owner request
   * 2026-10-24). It never ground-fires; anything else falls through to the
   * contextual orders or selection.
   */
  function attackUnderCursor(ground: { x: number; y: number }): boolean {
    if (selected.size === 0) return false;
    const attacks = resolveForceFire({
      player: options.player(),
      selected: [...selected],
      entities: options.entities(),
      x: ground.x,
      y: ground.y,
    }).filter((command) => command.kind === "attack");
    if (attacks.length === 0) return false;
    for (const command of attacks) options.command(command);
    return true;
  }

  /** True when the selection holds an own unit that can build (spec 35/38). */
  function selectionHasBuilder(): boolean {
    return options.entities().some((entity) => {
      if (!selected.has(entity.id) || entity.owner !== options.player()) {
        return false;
      }
      const def = typeDef(entity.kind);
      return def.category === "unit" && def.builds.length > 0;
    });
  }

  /**
   * Spec 08 §3.9: the contextual own/neutral object orders of a left click, in
   * the order the old right-click path used. The first non-empty result wins.
   */
  function applyContextOrders(ground: { x: number; y: number }): boolean {
    const args = {
      player: options.player(),
      selected: [...selected],
      entities: options.entities(),
      x: ground.x,
      y: ground.y,
    };
    const actions = [
      resolveGarrisonClick({
        ...args,
        features: options.garrisonFeatures?.() ?? [],
      }),
      resolveBoardClick(args),
      resolveRepairClick({ ...args, jobs: options.repairJobs?.() ?? [] }),
      resolveVehicleRepairClick(args),
      resolveBuildingRepairClick(args),
      resolveInfirmaryClick(args),
    ];
    for (const commands of actions) {
      if (commands.length === 0) continue;
      for (const command of commands) options.command(command);
      return true;
    }
    return false;
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

  // Pinch zoom (spec 08 §3.8): scales the orthographic camera around the fixed
  // target with the wheel's limits, never the page. The first two fingers
  // cancel a drag selection so a pinch cannot select or order.
  function sameOnScreen(kinds: readonly number[]): number[] {
    const rect = canvas.getBoundingClientRect();
    return sameTypeOnScreen(
      options.entities(),
      kinds,
      options.player(),
      {
        minX: rect.left,
        minY: rect.top,
        maxX: rect.right,
        maxY: rect.bottom,
      },
      worldToScreen,
    );
  }

  const pinch = createPinchGesture({
    zoom: () => camera.zoom,
    setZoom(zoom) {
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
    },
    begin() {
      dragStart = null;
      forceFireArmed = false;
      options.selectionBox.show(null);
    },
    pan(from, to) {
      // Grab the ground: the point under the old midpoint ends under the new.
      const before = groundAt(from);
      const after = groundAt(to);
      if (before === null || after === null) return;
      setTarget(target.x + before.x - after.x, target.y + before.y - after.y);
    },
  });

  canvas.addEventListener("pointermove", (event) => {
    if (pinch.move(event)) return;
    lastPointer = { x: event.clientX, y: event.clientY };
    if (digArmed && dragStart !== null) return;
    if (dragStart !== null && isDrag(dragStart, lastPointer)) {
      options.selectionBox.show(rectFromDrag(dragStart, lastPointer));
    }
  });
  canvas.addEventListener("pointercancel", () => {
    pinch.cancel();
    dragStart = null;
    forceFireArmed = false;
    options.selectionBox.show(null);
  });
  // A release outside the canvas, or a focus change, must not leave force fire
  // armed and turn the next click into a ground shot.
  window.addEventListener("blur", () => {
    pinch.cancel();
    dragStart = null;
    forceFireArmed = false;
  });
  window.addEventListener("pointerup", () => {
    forceFireArmed = false;
  });
  canvas.addEventListener("pointerdown", (event) => {
    lastPointer = { x: event.clientX, y: event.clientY };
    if (pinch.down(event)) {
      dragStart = null;
      options.selectionBox.show(null);
      return;
    }
    // Ctrl + click is Zero Hour's force-attack mode (spec 20 §3): it fires,
    // never starts a selection box.
    forceFireArmed =
      event.button === LEFT_BUTTON &&
      (event.ctrlKey || armedMode === "force") &&
      options.placementKind() === null;
    if (event.button !== LEFT_BUTTON || forceFireArmed) return;
    dragStart = { x: event.clientX, y: event.clientY };
  });

  canvas.addEventListener("pointerup", (event) => {
    if (pinch.up(event)) return;
    if (event.button !== LEFT_BUTTON) return;
    if (forceFireArmed) {
      forceFireArmed = false;
      armedMode = null;
      dragStart = null;
      options.selectionBox.show(null);
      forceFireAt({ x: event.clientX, y: event.clientY });
      return;
    }
    if (dragStart === null) return;
    const end = { x: event.clientX, y: event.clientY };
    const start = dragStart;
    dragStart = null;
    options.selectionBox.show(null);
    if (digArmed && isDrag(start, end)) {
      const from = groundAt(start);
      const to = groundAt(end);
      digArmed = event.shiftKey;
      if (from === null || to === null) return;
      for (const command of resolveDigLine({
        player: options.player(),
        selected: [...selected],
        entities: options.entities(),
        from,
        to,
        isTrench,
        isFree,
      })) {
        options.command(command);
      }
      return;
    }
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
    if (ground === null) {
      lastClick = null;
      return;
    }
    if (armedMode === "rally") {
      armedMode = null;
      for (const command of resolveRally({
        player: options.player(),
        selected: [...selected],
        entities: options.entities(),
        x: ground.x,
        y: ground.y,
      })) {
        options.command(command);
      }
      lastClick = null;
      return;
    }
    if (digArmed) {
      digArmed = false;
      for (const command of resolveDigClick({
        player: options.player(),
        selected: [...selected],
        entities: options.entities(),
        x: ground.x,
        y: ground.y,
        turned: event.shiftKey,
      })) {
        options.command(command);
      }
      lastClick = null;
      return;
    }
    if (tryPlace(ground.x, ground.y)) {
      lastClick = null;
      return;
    }
    if (applyContextOrders(ground)) {
      lastClick = null;
      return;
    }
    if (attackUnderCursor(ground)) {
      lastClick = null;
      return;
    }
    const picked = clickSelect(
      options.entities(),
      ground.x,
      ground.y,
      options.player(),
    );
    const [only] = picked;
    if (picked.length === 1 && only !== undefined) {
      const entity = options.entities().find((e) => e.id === only);
      if (
        entity !== undefined &&
        hasFlag(entity, ENTITY_FLAGS.underConstruction) &&
        selectionHasBuilder()
      ) {
        const commands = resolveClickOrder({
          player: options.player(),
          selected: [...selected],
          entities: options.entities(),
          x: ground.x,
          y: ground.y,
        });
        if (commands.length > 0) {
          for (const command of commands) options.command(command);
          lastClick = null;
          return;
        }
      }
      const again =
        lastClick !== null &&
        lastClick.id === only &&
        event.timeStamp - lastClick.time <= DOUBLE_CLICK_MS;
      lastClick = again ? null : { id: only, time: event.timeStamp };
      if (
        again &&
        entity !== undefined &&
        typeDef(entity.kind).category === "unit"
      ) {
        setSelection(sameOnScreen([entity.kind]));
        return;
      }
      if (!again && selected.size === 1 && selected.has(only)) {
        setSelection([]);
        return;
      }
      setSelection(picked);
      return;
    }
    lastClick = null;
    const commands = resolveClickOrder({
      player: options.player(),
      selected: [...selected],
      entities: options.entities(),
      x: ground.x,
      y: ground.y,
    });
    if (commands.length > 0) {
      for (const command of commands) options.command(command);
      return;
    }
    // A click on an own garrisoned building selects the units inside it.
    const occupants = selectOccupantsAt({
      player: options.player(),
      entities: options.entities(),
      features: options.garrisonFeatures?.() ?? [],
      x: ground.x,
      y: ground.y,
    });
    if (occupants.length > 0) setSelection(occupants);
  });

  // Non-passive so preventDefault keeps the page from scrolling (§3.4).
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      camera.zoom = zoomAfterWheel(camera.zoom, event.deltaY, event.deltaMode);
      camera.updateProjectionMatrix();
    },
    { passive: false },
  );

  canvas.addEventListener("contextmenu", (event) => {
    // The right button is inert (spec 08 §3.9): only keep the browser menu out.
    event.preventDefault();
  });

  options.keyTarget.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && options.placementKind() !== null) {
      event.preventDefault();
      options.exitPlacement();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (armedMode !== null || digArmed) {
        armedMode = null;
        digArmed = false;
      } else {
        setSelection([]);
      }
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

  /** Spec 35 §5b.3: a dug trench covers cell (x, y). */
  const isTrench = (x: number, y: number): boolean =>
    options.trenchCells?.().has(y * options.mapWidth + x) ?? false;
  /** The client's view of a diggable cell: on the map, open to infantry
   *  and not hard ground (buildings and features are the sim's call). */
  const isFree = (x: number, y: number): boolean =>
    x >= 0 &&
    y >= 0 &&
    x < options.mapWidth &&
    y < options.mapHeight &&
    options.tiles()[y * options.mapWidth + x] === 0 &&
    options.hardCells?.()?.[y * options.mapWidth + x] !== 1;

  return {
    selected,
    armDig() {
      digArmed = !digArmed;
    },
    digPreview() {
      if (!digArmed || dragStart === null || lastPointer === null) return null;
      if (!isDrag(dragStart, lastPointer)) return null;
      const from = groundAt(dragStart);
      const to = groundAt(lastPointer);
      if (from === null || to === null) return null;
      return joinedTrenchLine(from, to, isTrench, isFree).map((segment) => {
        const [w, h] = segment.rot === 0 ? [2, 1] : [1, 2];
        let valid = true;
        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) {
            const x = segment.x + dx;
            const y = segment.y + dy;
            if (!isFree(x, y) || isTrench(x, y)) valid = false;
          }
        }
        return { ...segment, valid };
      });
    },
    toggleForceFire() {
      armedMode = armedMode === "force" ? null : "force";
    },
    toggleRally() {
      armedMode = armedMode === "rally" ? null : "rally";
    },
    armedMode: () => armedMode,
    selectSameType(scope) {
      const kinds = selectedUnitKinds(options.entities(), selected);
      if (kinds.length === 0) return;
      setSelection(
        scope === "map"
          ? sameTypeEverywhere(options.entities(), kinds, options.player())
          : sameOnScreen(kinds),
      );
    },
    narrowTo(kind) {
      setSelection(narrowToKind(options.entities(), selected, kind));
    },
    cameraTarget: () => ({ ...target }),
    setTarget,
    zoom: () => camera.zoom,
    setSelection,
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
