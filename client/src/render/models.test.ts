import {
  BoxGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  type Object3D,
} from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { typeDef, typeIndex } from "../rules";
import { loadModels, type ModelLoader } from "./models";

function partScene(typeId: string, options: { turret: boolean }): Group {
  const scene = new Group();
  const root = new Group();
  root.name = typeId;
  root.add(
    new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshLambertMaterial({ color: 0x5b6b3a, name: "body" }),
    ),
    new Mesh(
      new BoxGeometry(0.2, 0.2, 0.2),
      new MeshLambertMaterial({ color: 0xffffff, name: "team" }),
    ),
  );
  if (options.turret) {
    const turret = new Group();
    turret.name = "turret";
    turret.position.set(0, 0.5, 0);
    turret.add(
      new Mesh(
        new BoxGeometry(0.3, 0.3, 0.3),
        new MeshLambertMaterial({ color: 0x2a2a2a, name: "dark" }),
      ),
    );
    root.add(turret);
  }
  scene.add(root);
  return scene;
}

function fakeLoader(scenes: ReadonlyMap<string, Object3D>): ModelLoader {
  return {
    loadAsync: async (url) => {
      const id = url.slice(url.lastIndexOf("/") + 1).replace(/\.glb$/, "");
      const scene = scenes.get(id);
      if (scene === undefined) throw new Error(`missing ${url}`);
      return { scene };
    },
  };
}

const types = [
  typeDef(typeIndex("ua-rifleman")),
  typeDef(typeIndex("ua-bradley")),
];

describe("model registry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("AC-06-03: model registry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const loader = fakeLoader(
      new Map([["ua-bradley", partScene("ua-bradley", { turret: true })]]),
    );

    const registry = await loadModels(types, loader);

    const rifleman = registry.get("ua-rifleman");
    expect(rifleman?.fallback).toBe(true);
    const fallback = rifleman?.parts.get("team");
    expect(fallback?.geometry).toBeInstanceOf(BoxGeometry);

    const bradley = registry.get("ua-bradley");
    expect(bradley?.fallback).toBe(false);
    expect(bradley?.parts.get("body")?.color).toBe(0x5b6b3a);
    expect(bradley?.parts.get("team")?.color).toBe(0xffffff);
    expect(bradley?.turret.get("dark")?.color).toBe(0x2a2a2a);
    expect(bradley?.turret.has("body")).toBe(false);
    expect(bradley?.pivot.y).toBeCloseTo(0.5, 6);

    expect(warn).toHaveBeenCalledTimes(1);
  });
});
