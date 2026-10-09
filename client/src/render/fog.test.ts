import { DataTexture, type MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";
import { createFogOverlay, fogRgba } from "./fog";

describe("fog overlay", () => {
  it("AC-03-53: builds the fog texture", () => {
    expect(Array.from(fogRgba(new Uint8Array([0, 1, 2])))).toEqual([
      0, 0, 0, 255, 0, 0, 0, 140, 0, 0, 0, 0,
    ]);
    const overlay = createFogOverlay(4, 2);
    const texture = (overlay.mesh.material as MeshBasicMaterial).map;
    expect(texture).toBeInstanceOf(DataTexture);
    const { image } = texture as DataTexture;
    expect(image.width).toBe(4);
    expect(image.height).toBe(2);
  });
});
