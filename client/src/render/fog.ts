import {
  DataTexture,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  RGBAFormat,
} from "three";
import { drapedGrid, type Elevation, flatElevation } from "./elevation";

export const FOG_ALPHA = [255, 140, 0] as const; // unexplored, explored, visible

const FOG_Y = 0.02;

/** 4 bytes per cell: 0, 0, 0, FOG_ALPHA[value]. */
export function fogRgba(fog: Uint8Array): Uint8Array {
  const rgba = new Uint8Array(fog.length * 4);
  writeFogAlpha(fog, rgba);
  return rgba;
}

/** Writes the alpha byte of every cell that fits in `rgba`, in place. */
function writeFogAlpha(fog: Uint8Array, rgba: Uint8Array): void {
  const cells = Math.min(fog.length, rgba.length / 4);
  for (let cell = 0; cell < cells; cell++) {
    rgba[cell * 4 + 3] = FOG_ALPHA[fog[cell] as 0 | 1 | 2] ?? FOG_ALPHA[0];
  }
}

/** One plane at y = 0.02 covering the map, DataTexture (NearestFilter),
 *  transparent, depthWrite false; update() rewrites the texture's own buffer
 *  with the fogRgba(fog) alphas and allocates nothing. */
export function createFogOverlay(
  width: number,
  height: number,
  elevation: Elevation = flatElevation(width, height),
): { mesh: Mesh; update(fog: Uint8Array): void } {
  const data = new Uint8Array(width * height * 4);
  const texture = new DataTexture(data, width, height, RGBAFormat);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.needsUpdate = true;

  // Drapes over the hills (spec 30); texture row 0 (cell row 0) covers
  // z = 0..1.
  const geometry = drapedGrid(elevation, FOG_Y);
  const mesh = new Mesh(
    geometry,
    new MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    }),
  );

  return {
    mesh,
    update(fog) {
      writeFogAlpha(fog, data);
      texture.needsUpdate = true;
    },
  };
}
