import type { Mesh, MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";
import { createRallyMarker } from "./rallyMarker";

describe("rally point marker (spec 33)", () => {
  it("AC-33-07: follows the selected producer's point and hides on deselection", () => {
    const marker = createRallyMarker();
    expect(marker.activeCount()).toBe(0);
    expect(marker.group.visible).toBe(false);

    marker.show({ x: 12.5, y: 20.5, color: 0x1d5fe0 });
    expect(marker.activeCount()).toBe(1);
    expect(marker.group.visible).toBe(true);
    expect(marker.group.position.x).toBe(12.5);
    expect(marker.group.position.z).toBe(20.5);
    const mesh = marker.group.children[0] as Mesh;
    expect((mesh.material as MeshBasicMaterial).color.getHex()).toBe(0x1d5fe0);

    marker.show({ x: 30, y: 40, color: 0xe01b1b });
    expect(marker.group.position.x).toBe(30);
    expect(marker.group.position.z).toBe(40);
    expect((mesh.material as MeshBasicMaterial).color.getHex()).toBe(0xe01b1b);

    marker.show(null);
    expect(marker.activeCount()).toBe(0);
    expect(marker.group.visible).toBe(false);
    marker.dispose();
  });
});
