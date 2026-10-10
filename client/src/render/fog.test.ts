import { DataTexture, type MeshBasicMaterial } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("allocates no buffer per frame in update()", () => {
    const overlay = createFogOverlay(64, 64);
    const fog = new Uint8Array(64 * 64).fill(2);
    overlay.update(fog);
    let allocations = 0;
    const Native = Uint8Array;
    vi.stubGlobal(
      "Uint8Array",
      class extends Native {
        constructor(...args: ConstructorParameters<typeof Uint8Array>) {
          super(...args);
          allocations++;
        }
      },
    );
    overlay.update(fog);
    vi.unstubAllGlobals();
    expect(allocations).toBe(0);
    const texture = (overlay.mesh.material as MeshBasicMaterial)
      .map as DataTexture;
    const data = texture.image.data as Uint8Array;
    expect(data[3]).toBe(0);
    fog[0] = 0;
    overlay.update(fog);
    expect(data[3]).toBe(255);
  });
});
