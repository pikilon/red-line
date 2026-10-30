import { t } from "../i18n";

/** The minimap of the HUD bar (spec 42 §3.7): Zero Hour's radar, with a drag
 *  that moves the camera instead of ordering anything. */

/** Terrain colours, packed [r, g, b]. */
const LAND: readonly [number, number, number] = [74, 98, 58];
const SHALLOW: readonly [number, number, number] = [46, 98, 128];
const DEEP: readonly [number, number, number] = [24, 56, 92];
const ROCK: readonly [number, number, number] = [112, 108, 100];
const VIEW_COLOR = "#facc15";
/** Redraw period, about 5 Hz like Zero Hour's every sixth frame. */
export const MINIMAP_PERIOD_MS = 200;
/** Fog alpha per cell state: unexplored, explored, visible (render/fog.ts). */
const FOG_ALPHA = [255, 140, 0] as const;

/** What the terrain layer needs; rebuilt only when the object changes. */
export interface MinimapTerrain {
  readonly width: number;
  readonly height: number;
  /** One byte per cell, non-zero for a rock tile. */
  readonly rock: Uint8Array;
  /** One byte per cell, the map's water byte: depth in the low two bits. */
  readonly water: Uint8Array;
  /** Ground height per cell in tiles, or null on a flat map. */
  readonly relief: Float32Array | null;
}

export interface MinimapDot {
  readonly x: number;
  readonly y: number;
  readonly owner: number;
}

export interface MinimapDeps {
  /** The terrain of the running map, or null before it is known. */
  terrain(): MinimapTerrain | null;
  /** Fog per cell (0 unexplored, 1 explored, 2 visible), `y * width + x`. */
  fog(): Uint8Array;
  entities(): readonly MinimapDot[];
  /** The player whose units always show. */
  player(): number;
  /** CSS colour of an owner's dots. */
  color(owner: number): string;
  /** The ground points (tiles) at the four corners of the screen. */
  view(): readonly { x: number; y: number }[];
  /** Moves the camera to a tile point; the minimap never gives orders. */
  moveCamera(x: number, y: number): void;
}

export interface Minimap {
  readonly canvas: HTMLCanvasElement;
  /** Called every frame; redraws at most every MINIMAP_PERIOD_MS. */
  update(now: number): void;
}

/** The rectangle of the canvas (px) the map fills, centred, aspect kept. */
export function fitMap(
  canvasWidth: number,
  canvasHeight: number,
  mapWidth: number,
  mapHeight: number,
): { x: number; y: number; width: number; height: number } {
  if (mapWidth <= 0 || mapHeight <= 0)
    return { x: 0, y: 0, width: 0, height: 0 };
  const scale = Math.min(canvasWidth / mapWidth, canvasHeight / mapHeight);
  const width = mapWidth * scale;
  const height = mapHeight * scale;
  return {
    x: (canvasWidth - width) / 2,
    y: (canvasHeight - height) / 2,
    width,
    height,
  };
}

/** Canvas pixel to tile point, clamped to the map (the letterbox maps to the
 *  nearest edge). */
export function minimapToWorld(
  px: number,
  py: number,
  canvasWidth: number,
  canvasHeight: number,
  mapWidth: number,
  mapHeight: number,
): { x: number; y: number } {
  const fit = fitMap(canvasWidth, canvasHeight, mapWidth, mapHeight);
  if (fit.width <= 0 || fit.height <= 0) return { x: 0, y: 0 };
  const x = ((px - fit.x) / fit.width) * mapWidth;
  const y = ((py - fit.y) / fit.height) * mapHeight;
  return {
    x: Math.min(mapWidth, Math.max(0, x)),
    y: Math.min(mapHeight, Math.max(0, y)),
  };
}

/** Tile point to canvas pixel; the inverse of `minimapToWorld` inside the map. */
export function worldToMinimap(
  x: number,
  y: number,
  canvasWidth: number,
  canvasHeight: number,
  mapWidth: number,
  mapHeight: number,
): { x: number; y: number } {
  const fit = fitMap(canvasWidth, canvasHeight, mapWidth, mapHeight);
  if (mapWidth <= 0 || mapHeight <= 0) return { x: 0, y: 0 };
  return {
    x: fit.x + (x / mapWidth) * fit.width,
    y: fit.y + (y / mapHeight) * fit.height,
  };
}

/** RGBA of the terrain layer, one pixel per cell: land shaded by height, water
 *  by depth, rock tiles grey. */
export function terrainPixels(
  terrain: MinimapTerrain,
): Uint8ClampedArray<ArrayBuffer> {
  const cells = terrain.width * terrain.height;
  const out = new Uint8ClampedArray(new ArrayBuffer(cells * 4));
  let top = 0;
  if (terrain.relief !== null)
    for (const h of terrain.relief) top = Math.max(top, h);
  for (let cell = 0; cell < cells; cell++) {
    const depth = (terrain.water[cell] ?? 0) & 3;
    let color = LAND;
    let shade = 1;
    if (terrain.rock[cell]) color = ROCK;
    else if (depth > 0) color = depth >= 2 ? DEEP : SHALLOW;
    else if (terrain.relief !== null && top > 0) {
      shade = 0.8 + 0.4 * ((terrain.relief[cell] ?? 0) / top);
    }
    out[cell * 4] = color[0] * shade;
    out[cell * 4 + 1] = color[1] * shade;
    out[cell * 4 + 2] = color[2] * shade;
    out[cell * 4 + 3] = 255;
  }
  return out;
}

/** Writes the black fog overlay (alpha per cell) into `out`, RGBA per cell. */
export function fogPixels(fog: Uint8Array, out: Uint8ClampedArray): void {
  const cells = Math.min(fog.length, out.length / 4);
  for (let cell = 0; cell < cells; cell++) {
    out[cell * 4 + 3] = FOG_ALPHA[fog[cell] as 0 | 1 | 2] ?? FOG_ALPHA[0];
  }
}

/** True when a dot shows: the player's own, or on a visible cell. */
export function dotVisible(
  dot: MinimapDot,
  player: number,
  fog: Uint8Array,
  mapWidth: number,
): boolean {
  if (dot.owner === player) return true;
  return fog[Math.floor(dot.y) * mapWidth + Math.floor(dot.x)] === 2;
}

/** Events the radar keeps away from the map (spec 41 AC-41-10). */
const ISOLATED = [
  "pointerdown",
  "pointerup",
  "pointermove",
  "pointercancel",
  "mousedown",
  "mouseup",
  "click",
  "dblclick",
  "touchstart",
  "touchend",
  "wheel",
  "contextmenu",
];

/** Builds the minimap canvas inside `radar` (`#hud-radar`). */
export function createMinimap(radar: HTMLElement, deps: MinimapDeps): Minimap {
  const canvas = document.createElement("canvas");
  canvas.id = "minimap";
  canvas.setAttribute("aria-label", t("hud.minimap"));
  radar.appendChild(canvas);
  const context = canvas.getContext("2d");

  for (const type of ISOLATED) {
    canvas.addEventListener(type, (event) => event.stopPropagation());
  }
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  let activePointer: number | null = null;
  const follow = (event: PointerEvent): void => {
    const terrain = deps.terrain();
    if (terrain === null) return;
    const rect = canvas.getBoundingClientRect();
    const world = minimapToWorld(
      event.clientX - rect.left,
      event.clientY - rect.top,
      rect.width,
      rect.height,
      terrain.width,
      terrain.height,
    );
    deps.moveCamera(world.x, world.y);
    dirty = true;
  };
  canvas.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0 || activePointer !== null)
      return;
    activePointer = event.pointerId;
    canvas.setPointerCapture?.(event.pointerId);
    follow(event);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerId === activePointer) follow(event);
  });
  const release = (event: PointerEvent): void => {
    if (event.pointerId !== activePointer) return;
    activePointer = null;
    canvas.releasePointerCapture?.(event.pointerId);
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  let dirty = true;
  let lastDraw = Number.NEGATIVE_INFINITY;
  let builtFor: MinimapTerrain | null = null;
  const terrainLayer = document.createElement("canvas");
  const fogLayer = document.createElement("canvas");
  let fogImage: ImageData | null = null;

  new ResizeObserver(() => {
    dirty = true;
  }).observe(canvas);

  function buildTerrain(terrain: MinimapTerrain): void {
    builtFor = terrain;
    terrainLayer.width = fogLayer.width = terrain.width;
    terrainLayer.height = fogLayer.height = terrain.height;
    const pixels = terrainPixels(terrain);
    terrainLayer
      .getContext("2d")
      ?.putImageData(
        new ImageData(pixels, terrain.width, terrain.height),
        0,
        0,
      );
    fogImage = new ImageData(terrain.width, terrain.height);
  }

  function draw(terrain: MinimapTerrain): void {
    if (context === null) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const fit = fitMap(width, height, terrain.width, terrain.height);
    context.imageSmoothingEnabled = false;
    context.drawImage(terrainLayer, fit.x, fit.y, fit.width, fit.height);

    const fog = deps.fog();
    if (fogImage !== null && fog.length >= terrain.width * terrain.height) {
      fogPixels(fog, fogImage.data);
      fogLayer.getContext("2d")?.putImageData(fogImage, 0, 0);
      context.drawImage(fogLayer, fit.x, fit.y, fit.width, fit.height);
    }

    // 2 px dots, 3 px on a phone where the map is smaller on screen.
    const size = window.matchMedia?.("(max-height: 500px)").matches ? 3 : 2;
    const player = deps.player();
    for (const dot of deps.entities()) {
      if (!dotVisible(dot, player, fog, terrain.width)) continue;
      const at = worldToMinimap(
        dot.x,
        dot.y,
        width,
        height,
        terrain.width,
        terrain.height,
      );
      context.fillStyle = deps.color(dot.owner);
      context.fillRect(
        Math.round(at.x - size / 2),
        Math.round(at.y - size / 2),
        size,
        size,
      );
    }

    // The view: the screen's ground footprint, clipped to the map.
    const corners = deps.view();
    if (corners.length >= 3) {
      context.save();
      context.beginPath();
      context.rect(fit.x, fit.y, fit.width, fit.height);
      context.clip();
      context.beginPath();
      corners.forEach((corner, index) => {
        const at = worldToMinimap(
          corner.x,
          corner.y,
          width,
          height,
          terrain.width,
          terrain.height,
        );
        if (index === 0) context.moveTo(at.x, at.y);
        else context.lineTo(at.x, at.y);
      });
      context.closePath();
      context.lineWidth = 1;
      context.strokeStyle = VIEW_COLOR;
      context.stroke();
      context.restore();
    }
  }

  return {
    canvas,
    update(now) {
      if (!dirty && now - lastDraw < MINIMAP_PERIOD_MS) return;
      if (canvas.clientWidth === 0) return;
      const terrain = deps.terrain();
      if (terrain === null) return;
      if (terrain !== builtFor) buildTerrain(terrain);
      lastDraw = now;
      dirty = false;
      draw(terrain);
    },
  };
}
