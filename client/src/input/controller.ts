import {
  type OrthographicCamera,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
} from "three";
import { setCameraTarget } from "../camera";
import { toRaw } from "../sim/fixed";
import type { UnitState } from "../sim/snapshot";
import { panDelta } from "./cameraPan";
import {
  isDrag,
  pickUnit,
  rectFromDrag,
  type ScreenPoint,
  unitsInRect,
} from "./selection";

export interface ControllerOptions {
  canvas: HTMLCanvasElement;
  /** Receives keydown/keyup; the window, so keys work without focusing the canvas. */
  keyTarget: Pick<Window, "addEventListener">;
  camera: OrthographicCamera;
  mapWidth: number;
  mapHeight: number;
  /** Units as currently displayed. */
  units(): readonly UnitState[];
  move(
    unitIds: readonly number[],
    targetXRaw: number,
    targetYRaw: number,
  ): void;
  onSelectionChange(selected: ReadonlySet<number>): void;
}

export interface Controller {
  readonly selected: ReadonlySet<number>;
  cameraTarget(): { x: number; y: number };
  /** Clamped to [0, mapWidth] x [0, mapHeight]. */
  setTarget(x: number, y: number): void;
  /** Applies keyboard panning for one frame. */
  update(dtSeconds: number): void;
  /** Sim tiles -> page CSS px. */
  worldToScreen(x: number, y: number): ScreenPoint;
}

const LEFT_BUTTON = 0;
const GROUND = new Plane(new Vector3(0, 1, 0), 0);

export function createController(options: ControllerOptions): Controller {
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

  canvas.addEventListener("pointermove", (event) => {
    lastPointer = { x: event.clientX, y: event.clientY };
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
    if (isDrag(start, end)) {
      const rect = rectFromDrag(start, end);
      setSelection(unitsInRect(options.units(), rect, worldToScreen));
      return;
    }
    const ground = groundAt(end);
    const id =
      ground === null ? null : pickUnit(options.units(), ground.x, ground.y);
    setSelection(id === null ? [] : [id]);
  });

  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    if (selected.size === 0) return;
    const point = lastPointer ?? { x: event.clientX, y: event.clientY };
    const ground = groundAt(point);
    if (ground === null) return;
    const ids = [...selected].sort((a, b) => a - b);
    options.move(ids, toRaw(ground.x), toRaw(ground.y));
  });

  options.keyTarget.addEventListener("keydown", (event) => {
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
    update(dtSeconds) {
      const delta = panDelta(pressed, dtSeconds);
      if (delta.x !== 0 || delta.y !== 0) {
        setTarget(target.x + delta.x, target.y + delta.y);
      }
    },
    worldToScreen,
  };
}
