import {
  DataTexture,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshLambertMaterial,
  RGBAFormat,
  SRGBColorSpace,
  type Texture,
  UnsignedByteType,
} from "three";

const SIZE = 128;
const CELLS = 8;
const BAR = 2;
const FRAME = 3;

/** Anti-drone cage: a thin plate drawn as a wire grid with transparent holes
 *  (the `cage` material of the models), so it costs no 3D bars. */
export function createCageTexture(): DataTexture {
  const data = new Uint8Array(SIZE * SIZE * 4);
  const pitch = SIZE / CELLS;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const edge = Math.min(x, y, SIZE - 1 - x, SIZE - 1 - y) < FRAME;
      const bar = x % pitch < BAR || y % pitch < BAR;
      const offset = (y * SIZE + x) * 4;
      const shade = 28 + ((x * 7 + y * 13) % 11);
      data[offset] = shade;
      data[offset + 1] = shade;
      data[offset + 2] = shade;
      data[offset + 3] = edge || bar ? 255 : 0;
    }
  }
  const texture = new DataTexture(
    data,
    SIZE,
    SIZE,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** The see-through material of the `cage` slot. */
export function createCageMaterial(texture: Texture): MeshLambertMaterial {
  return new MeshLambertMaterial({
    map: texture,
    alphaTest: 0.5,
    side: DoubleSide,
  });
}
