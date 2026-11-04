import {
  CanvasTexture,
  Group,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
} from "three";
import { FEATURE_NO_OWNER } from "../sim/featureSnapshot";
import { groundY } from "./elevation";

/** What the marker of one garrisonable building needs (a `GarrisonFeature`
 *  seen from the renderer). */
export interface GarrisonMarkerSource {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly slots: number;
  readonly owner?: number;
  readonly occupants?: number;
  readonly closed?: boolean;
  readonly trench?: boolean;
}

/** Idle opacity: present but quiet. */
export const MARKER_IDLE_OPACITY = 0.5;
/** Opacity while the selection could garrison the building. */
export const MARKER_READY_OPACITY = 1;
/** Pips per row; more slots wrap onto further rows. */
export const PIPS_PER_ROW = 5;
/** Height of the marker above the ground, in tiles. */
export const MARKER_HEIGHT = 2.4;

/** Rows of pips for a building with `slots` places: pips per row. */
export function pipRows(slots: number): number[] {
  const rows: number[] = [];
  for (let left = Math.max(1, slots); left > 0; left -= PIPS_PER_ROW) {
    rows.push(Math.min(left, PIPS_PER_ROW));
  }
  return rows;
}

/** Marker texture key: look changes only with capacity, occupancy and holder. */
export function markerKey(
  slots: number,
  occupants: number,
  owner: number,
): string {
  return `${slots}:${Math.min(occupants, slots)}:${occupants > 0 ? owner : -1}`;
}

/** True when a building shows a marker: standing, open, not a trench piece
 *  (a trench is drawn as an earthwork, not a building). */
export function showsMarker(feature: GarrisonMarkerSource): boolean {
  return feature.trench !== true && feature.closed !== true;
}

/** True when `player`'s infantry could still join: room left and empty or
 *  held by the same player. */
export function acceptsRiders(
  feature: GarrisonMarkerSource,
  player: number,
): boolean {
  const occupants = feature.occupants ?? 0;
  if (occupants >= feature.slots) return false;
  const owner = feature.owner ?? FEATURE_NO_OWNER;
  return owner === FEATURE_NO_OWNER || owner === player;
}

const PIP = 14;
const GAP = 6;
const PAD = 6;

function drawMarker(
  slots: number,
  occupants: number,
  colour: string,
): HTMLCanvasElement {
  const rows = pipRows(slots);
  const widest = Math.max(...rows);
  const canvas = document.createElement("canvas");
  canvas.width = PAD * 2 + widest * PIP + (widest - 1) * GAP;
  canvas.height = PAD * 2 + rows.length * PIP + (rows.length - 1) * GAP;
  const context = canvas.getContext("2d");
  if (context === null) return canvas;
  context.fillStyle = "rgba(10, 12, 16, 0.65)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  let placed = 0;
  rows.forEach((count, row) => {
    const rowWidth = count * PIP + (count - 1) * GAP;
    const left = (canvas.width - rowWidth) / 2;
    for (let column = 0; column < count; column++) {
      const x = left + column * (PIP + GAP);
      const y = PAD + row * (PIP + GAP);
      if (placed < occupants) {
        context.fillStyle = colour;
        context.fillRect(x, y, PIP, PIP);
      } else {
        context.strokeStyle = "#e8edf2";
        context.lineWidth = 2;
        context.strokeRect(x + 1, y + 1, PIP - 2, PIP - 2);
      }
      placed++;
    }
  });
  return canvas;
}

/** Pixels per tile of the sprite: keeps pips a readable, fixed world size. */
const PIXELS_PER_TILE = 40;

export interface GarrisonMarkers {
  readonly group: Group;
  /** Rebuilds the visible markers: `ready` buildings (a selection that could
   *  garrison them) show at full strength, the rest stay subtle. */
  update(
    features: readonly GarrisonMarkerSource[],
    options: {
      ready(feature: GarrisonMarkerSource): boolean;
      colour(owner: number): string;
    },
  ): void;
  activeCount(): number;
  dispose(): void;
}

/** Persistent garrison signage (spec 31 A13): capacity pips above every
 *  garrisonable building, filled with the holder's colour as it fills. */
export function createGarrisonMarkers(): GarrisonMarkers {
  const group = new Group();
  group.name = "garrison-markers";
  const materials = new Map<string, SpriteMaterial>();
  const sprites = new Map<number, Sprite>();
  const sizes = new Map<string, { w: number; h: number }>();

  const materialFor = (
    key: string,
    opacity: number,
    build: () => HTMLCanvasElement,
  ): SpriteMaterial => {
    const id = `${key}@${opacity}`;
    let material = materials.get(id);
    if (material === undefined) {
      const canvas = build();
      sizes.set(key, { w: canvas.width, h: canvas.height });
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      material = new SpriteMaterial({
        map: texture,
        opacity,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      materials.set(id, material);
    }
    return material;
  };

  return {
    group,
    update(features, options) {
      const live = new Set<number>();
      for (const feature of features) {
        if (!showsMarker(feature)) continue;
        live.add(feature.index);
        const occupants = feature.occupants ?? 0;
        const owner = feature.owner ?? FEATURE_NO_OWNER;
        const key = markerKey(feature.slots, occupants, owner);
        const opacity = options.ready(feature)
          ? MARKER_READY_OPACITY
          : MARKER_IDLE_OPACITY;
        const material = materialFor(key, opacity, () =>
          drawMarker(
            feature.slots,
            Math.min(occupants, feature.slots),
            options.colour(owner),
          ),
        );
        let sprite = sprites.get(feature.index);
        if (sprite === undefined) {
          sprite = new Sprite(material);
          sprite.renderOrder = 9;
          sprites.set(feature.index, sprite);
          group.add(sprite);
        }
        sprite.material = material;
        const size = sizes.get(key) ?? { w: 64, h: 32 };
        sprite.scale.set(size.w / PIXELS_PER_TILE, size.h / PIXELS_PER_TILE, 1);
        const cx = feature.x + feature.width / 2;
        const cy = feature.y + feature.height / 2;
        sprite.position.set(cx, groundY(cx, cy) + MARKER_HEIGHT, cy);
        sprite.visible = true;
      }
      for (const [index, sprite] of sprites) {
        if (!live.has(index)) sprite.visible = false;
      }
    },
    activeCount() {
      let count = 0;
      for (const sprite of sprites.values()) if (sprite.visible) count++;
      return count;
    },
    dispose() {
      for (const sprite of sprites.values()) group.remove(sprite);
      sprites.clear();
      for (const material of materials.values()) {
        material.map?.dispose();
        material.dispose();
      }
      materials.clear();
    },
  };
}
