import {
  BoxGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  type Object3D,
  SRGBColorSpace,
  Texture,
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

  it("spec 43: keeps rotors out of the hull with their hub and spin axis", async () => {
    const scene = new Group();
    const root = new Group();
    root.name = "ua-baba-yaga";
    root.position.set(0, 0.25, 0);
    root.add(
      new Mesh(
        new BoxGeometry(1, 0.2, 1),
        new MeshLambertMaterial({ color: 0x5b6b3a, name: "body" }),
      ),
    );
    scene.add(root);
    // A flat horizontal rotor at the corner and a propeller at the tail.
    const rotor = new Group();
    rotor.name = "prop_0";
    rotor.position.set(0.4, 0.08, -0.2);
    rotor.add(
      new Mesh(
        new BoxGeometry(0.28, 0.02, 0.28),
        new MeshLambertMaterial({ color: 0x222222, name: "dark" }),
      ),
    );
    const pusher = new Group();
    pusher.name = "prop";
    pusher.position.set(0, 0.14, -0.5);
    pusher.add(
      new Mesh(
        new BoxGeometry(0.27, 0.07, 0.06),
        new MeshLambertMaterial({ color: 0x222222, name: "dark" }),
      ),
    );
    scene.add(rotor, pusher);

    const registry = await loadModels(
      [typeDef(typeIndex("ua-baba-yaga"))],
      fakeLoader(new Map([["ua-baba-yaga", scene]])),
    );
    const model = registry.get("ua-baba-yaga");
    expect(model?.fallback).toBe(false);
    // The hull holds only its own body: no rotor geometry merged into it.
    expect(model?.parts.size).toBe(1);
    expect(model?.parts.get("dark")).toBeUndefined();
    const props = model?.props ?? [];
    expect(props.map((prop) => prop.name)).toEqual(["prop_0", "prop"]);
    expect(props[0]?.axis).toBe("y");
    expect(props[0]?.hub.x).toBeCloseTo(0.4, 6);
    expect(props[0]?.hub.y).toBeCloseTo(0.08, 6);
    expect(props[1]?.axis).toBe("z");
    // Geometry is relative to the hub: centred on the origin.
    const rotorGeometry = props[0]?.parts.get("dark")?.geometry;
    rotorGeometry?.computeBoundingBox();
    expect(rotorGeometry?.boundingBox?.min.x).toBeCloseTo(-0.14, 6);
  });

  it("extracts embedded Meshy baseColor textures onto ModelPart.map", async () => {
    const tex = new Texture();
    const scene = new Group();
    const root = new Group();
    root.name = "ua-bradley";
    root.add(
      new Mesh(
        new BoxGeometry(1, 1, 1),
        new MeshLambertMaterial({ color: 0xffffff, name: "body", map: tex }),
      ),
    );
    scene.add(root);

    const registry = await loadModels(
      [typeDef(typeIndex("ua-bradley"))],
      fakeLoader(new Map([["ua-bradley", scene]])),
    );
    const bradley = registry.get("ua-bradley");
    expect(bradley?.parts.get("body")?.map).toBe(tex);
    expect(tex.colorSpace).toBe(SRGBColorSpace);
  });
});
