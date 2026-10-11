import ruleset from "@data/ruleset.json";
import { Group, Mesh } from "three";
import { describe, expect, it } from "vitest";
import { createTerrain, rockCellsOf } from "./terrain";

function meshNamed(group: Group, name: string): Mesh {
  const found = group.getObjectByName(name);
  if (!(found instanceof Mesh)) throw new Error(`missing ${name} mesh`);
  return found;
}

describe("terrain renderer", () => {
  it("AC-02-36: builds the ground as a group", () => {
    const group = createTerrain(3, 2, new Uint8Array([0, 0, 0, 0, 0, 0]), 1);
    expect(group).toBeInstanceOf(Group);
    const grass = meshNamed(group, "grass");
    expect(grass.geometry.getAttribute("position").count).toBe(24);
    expect(grass.geometry.getIndex()?.count).toBe(36);
    expect(grass.receiveShadow).toBe(true);
  });

  it("AC-10-02: terrain meshes", () => {
    // `rockCellsOf` marks exactly the map's `blocked` rectangles.
    const firstLine = ruleset.maps.find((map) => map.id === "first-line");
    if (firstLine === undefined) throw new Error("missing first-line map");
    const cells = rockCellsOf(firstLine);
    expect(cells.length).toBe(firstLine.width * firstLine.height);
    // The river is rock.
    expect(cells[10 * firstLine.width + 62]).toBe(1);
    // The woods are rock.
    expect(cells[40 * firstLine.width + 28]).toBe(1);
    expect(cells[47 * firstLine.width + 33]).toBe(1);
    // Nothing under the start HQs or the depots.
    expect(cells[60 * firstLine.width + 12]).toBe(0);
    expect(cells[64 * firstLine.width + 112]).toBe(0);
    expect(cells[54 * firstLine.width + 12]).toBe(0);

    const rockCells = new Uint8Array(16);
    rockCells[1 * 4 + 1] = 1;
    rockCells[2 * 4 + 3] = 1;
    const group = createTerrain(4, 4, rockCells, 1);

    const grass = meshNamed(group, "grass");
    expect(grass.geometry.getAttribute("position").count).toBe(14 * 4);
    expect(grass.geometry.getIndex()?.count).toBe(14 * 6);
    expect(grass.receiveShadow).toBe(true);

    const dirt = meshNamed(group, "dirt");
    expect(dirt.geometry.getAttribute("position").count).toBe(14 * 4);
    const alpha = dirt.geometry.getAttribute("color");
    expect(alpha.itemSize).toBe(4);
    for (let vertex = 0; vertex < alpha.count; vertex++) {
      expect(alpha.getW(vertex)).toBeGreaterThanOrEqual(0);
      expect(alpha.getW(vertex)).toBeLessThanOrEqual(1);
    }
    expect(dirt.receiveShadow).toBe(true);
    expect(dirt.material).toMatchObject({ transparent: true });

    const rock = meshNamed(group, "rock");
    expect(rock.geometry.getAttribute("position").count).toBe(2 * 8);
    expect(rock.castShadow).toBe(true);
    const positions = rock.geometry.getAttribute("position");
    for (let box = 0; box < 2; box++) {
      let height = 0;
      for (let vertex = 0; vertex < 8; vertex++) {
        height = Math.max(height, positions.getY(box * 8 + vertex) ?? 0);
      }
      expect(height).toBeGreaterThanOrEqual(0.27);
      expect(height).toBeLessThanOrEqual(0.83);
    }
    expect(rock.material).toMatchObject({ flatShading: true });
  });
});
