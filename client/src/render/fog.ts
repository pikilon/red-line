import {
  DataTexture,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  PlaneGeometry,
  RGBAFormat,
} from "three";

export const FOG_ALPHA = [255, 140, 0] as const; // unexplored, explored, visible

const FOG_Y = 0.02;

/** 4 bytes per cell: 0, 0, 0, FOG_ALPHA[value]. */
export function fogRgba(fog: Uint8Array): Uint8Array {
  const rgba = new Uint8Array(fog.length * 4);
  fog.forEach((value, cell) => {
    rgba[cell * 4 + 3] = FOG_ALPHA[value as 0 | 1 | 2] ?? FOG_ALPHA[0];
  });
  return rgba;
}

/** One plane at y = 0.02 covering the map, DataTexture (NearestFilter),
 *  transparent, depthWrite false; update() uploads fogRgba(fog). */
export function createFogOverlay(
  width: number,
  height: number,
): { mesh: Mesh; update(fog: Uint8Array): void } {
  const data = new Uint8Array(width * height * 4);
  const texture = new DataTexture(data, width, height, RGBAFormat);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.needsUpdate = true;

  const geometry = new PlaneGeometry(width, height);
  geometry.rotateX(-Math.PI / 2);
  // After the rotation v = 0 lies at world z = height; flip it so texture
  // row 0 (cell row 0) covers z = 0..1.
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) {
    uv.setY(i, 1 - uv.getY(i));
  }
  const mesh = new Mesh(
    geometry,
    new MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    }),
  );
  mesh.position.set(width / 2, FOG_Y, height / 2);

  return {
    mesh,
    update(fog) {
      data.set(fogRgba(fog).subarray(0, data.length));
      texture.needsUpdate = true;
    },
  };
}
