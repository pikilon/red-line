import { BoxGeometry, type MeshLambertMaterial, Texture, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { typeIndex } from "../rules";
import type { EntityState } from "../sim/matchSnapshot";
import { createEntityRenderer } from "./entities";
import {
  GENERATED_TEXTURE_IDS,
  type GeneratedTextures,
  loadGeneratedTextures,
} from "./generatedTextures";
import type { MaterialName, ModelPart, TypeModel } from "./models";

function entity(id: number, type: string): EntityState {
  return {
    id,
    owner: 0,
    kind: typeIndex(type),
    x: 2,
    y: 2,
    hp: 100,
    flags: 0,
    progress: 0,
    target: null,
  };
}

const registry = {
  get: (): TypeModel => ({
    parts: new Map<MaterialName, ModelPart>([
      [
        "body",
        {
          material: "body",
          geometry: new BoxGeometry(1, 1, 2),
          color: 0x112233,
        },
      ],
    ]),
    turret: new Map<MaterialName, ModelPart>(),
    pivot: new Vector3(),
    fallback: false,
  }),
};

function bodyMaterial(
  renderer: ReturnType<typeof createEntityRenderer>,
  typeId: string,
): MeshLambertMaterial {
  const slot = renderer.models.find(
    (model) => model.typeId === typeId && model.material === "body",
  );
  if (slot === undefined) throw new Error(`no slot ${typeId}`);
  return slot.mesh.material as MeshLambertMaterial;
}

const TYPES = ["ua-bradley", "ru-t-72b3", "ua-rifleman", "ru-barracks"];

function renderer() {
  const created = createEntityRenderer(8, registry);
  created.update(
    TYPES.map((type, index) => entity(index, type)),
    new Set(),
  );
  return created;
}

describe("vehicle skins", () => {
  it("AC-15-01: skin and bump textures are loaded", async () => {
    const urls: string[] = [];
    await loadGeneratedTextures({
      loadAsync: (url: string) => {
        urls.push(url);
        return Promise.resolve(new Texture());
      },
    });
    for (const id of ["ua-skin", "ru-skin", "ua-skin-bump", "ru-skin-bump"]) {
      expect(GENERATED_TEXTURE_IDS).toContain(id);
      expect(urls).toContain(`textures/${id}.webp`);
    }
  });

  it("AC-15-02: vehicles get skin and bump, the rest do not", () => {
    const textures = {
      "ua-skin": new Texture(),
      "ru-skin": new Texture(),
      "ua-skin-bump": new Texture(),
      "ru-skin-bump": new Texture(),
      "ua-paint": new Texture(),
      "ru-paint": new Texture(),
      "ru-concrete": new Texture(),
    } satisfies GeneratedTextures;
    const created = renderer();
    created.setGeneratedTextures(textures);
    const ua = bodyMaterial(created, "ua-bradley");
    expect(ua.map).toBe(textures["ua-skin"]);
    expect(ua.bumpMap).toBe(textures["ua-skin-bump"]);
    const ru = bodyMaterial(created, "ru-t-72b3");
    expect(ru.map).toBe(textures["ru-skin"]);
    expect(ru.bumpMap).toBe(textures["ru-skin-bump"]);
    const infantry = bodyMaterial(created, "ua-rifleman");
    expect(infantry.map).toBe(textures["ua-paint"]);
    expect(infantry.bumpMap).toBeNull();
    const building = bodyMaterial(created, "ru-barracks");
    expect(building.map).toBe(textures["ru-concrete"]);
    expect(building.bumpMap).toBeNull();

    created.setGeneratedTextures(null);
    expect(bodyMaterial(created, "ua-bradley").map).toBeNull();
    expect(bodyMaterial(created, "ua-bradley").bumpMap).toBeNull();
  });

  it("AC-15-05: vehicles tile their skin finer than the rest", () => {
    const created = renderer();
    const uvOf = (typeId: string): number => {
      const slot = created.models.find(
        (model) => model.typeId === typeId && model.material === "body",
      );
      if (slot === undefined) throw new Error(`no slot ${typeId}`);
      const position = slot.mesh.geometry.getAttribute("position");
      const uv = slot.mesh.geometry.getAttribute("uv");
      // The first vertex: uv = coordinate / tile, whatever the face.
      const ratio = Math.max(
        Math.abs(uv.getX(0)) / Math.max(Math.abs(position.getX(0)), 1e-6),
        Math.abs(uv.getX(0)) / Math.max(Math.abs(position.getZ(0)), 1e-6),
      );
      return ratio;
    };
    expect(uvOf("ua-bradley")).toBeGreaterThan(uvOf("ua-rifleman") * 2);
  });

  it("AC-13-09: vehicles have no team stripe, the rest keep it", () => {
    const withTeam = {
      get: (): TypeModel => ({
        parts: new Map<MaterialName, ModelPart>([
          [
            "body",
            { material: "body", geometry: new BoxGeometry(1, 1, 2), color: 1 },
          ],
          [
            "team",
            {
              material: "team",
              geometry: new BoxGeometry(1, 0.1, 1),
              color: 1,
            },
          ],
        ]),
        turret: new Map<MaterialName, ModelPart>(),
        pivot: new Vector3(),
        fallback: false,
      }),
    };
    const created = createEntityRenderer(8, withTeam);
    created.update(
      TYPES.map((type, index) => entity(index, type)),
      new Set(),
    );
    const hasTeam = (typeId: string): boolean =>
      created.models.some(
        (model) => model.typeId === typeId && model.material === "team",
      );
    expect(hasTeam("ua-bradley")).toBe(false);
    expect(hasTeam("ru-t-72b3")).toBe(false);
    expect(hasTeam("ua-rifleman")).toBe(true);
    expect(hasTeam("ru-barracks")).toBe(true);
  });

  it("AC-15-03: a missing skin falls back to paint without bump", () => {
    const textures = {
      "ua-paint": new Texture(),
      "ua-skin-bump": new Texture(),
    } satisfies GeneratedTextures;
    const created = renderer();
    created.setGeneratedTextures(textures);
    const ua = bodyMaterial(created, "ua-bradley");
    expect(ua.map).toBe(textures["ua-paint"]);
    expect(ua.bumpMap).toBeNull();
  });
});
