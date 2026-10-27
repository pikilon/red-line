import {
  CanvasTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Object3D,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from "three";
import { boxProjectUvs } from "../../generatedTextures";
import type { FeatureContext, FeatureInstance } from "../layers";
import { geometryOf, MeshBag } from "./bag";
import { Build, hashOf, rngOf, STATE_KINDS } from "./build";
import type { BuilderFn } from "./buildings";

/** Spec 26 section 5.1: draws every instance of one family into one merged
 *  mesh (plus one for the bright parts), so a town is two draw calls. */

let grain: Texture | null | undefined;

/** A faint plaster / brick grain multiplied over the vertex colours; null when
 *  there is no canvas (tests). */
function grainTexture(): Texture | null {
  if (grain !== undefined) return grain;
  grain = null;
  if (typeof document === "undefined") return grain;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  if (g === null) return grain;
  const rnd = rngOf(1234);
  g.fillStyle = "#e6e6e6";
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 1400; i++) {
    const v = 190 + Math.floor(rnd() * 65);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(
      Math.floor(rnd() * size),
      Math.floor(rnd() * size),
      1 + Math.floor(rnd() * 3),
      1 + Math.floor(rnd() * 2),
    );
  }
  g.fillStyle = "rgba(120,120,120,0.22)";
  for (let y = 0; y < size; y += 16) g.fillRect(0, y, size, 1);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  grain = texture;
  return grain;
}

const stringOf = (v: unknown): string => (typeof v === "string" ? v : "");

export function buildBag(
  instances: readonly FeatureInstance[],
  ctx: FeatureContext,
  builders: Readonly<Record<string, BuilderFn>>,
): MeshBag {
  const bag = new MeshBag();
  for (const inst of instances) {
    const model = stringOf(inst.type.render.model) || inst.type.id;
    const builder = builders[model] ?? builders[inst.type.id];
    if (builder === undefined) continue;
    let ground = Number.POSITIVE_INFINITY;
    for (let cy = inst.y; cy <= inst.y + inst.height; cy++) {
      for (let cx = inst.x; cx <= inst.x + inst.width; cx++) {
        ground = Math.min(ground, ctx.elevation.corner(cx, cy));
      }
    }
    bag.setFrame(
      inst.x + inst.width / 2,
      ground,
      inst.y + inst.height / 2,
      inst.rot,
    );
    const state = STATE_KINDS[inst.state] ?? "intact";
    const rnd = rngOf(hashOf(inst.x, inst.y, inst.variant, inst.typeIndex));
    builder(
      new Build(
        bag,
        rnd,
        state,
        inst.variant,
        inst.type.footprint[0],
        inst.type.footprint[1],
      ),
    );
  }
  return bag;
}

export function bagObject(bag: MeshBag, name: string): Object3D {
  const group = new Group();
  group.name = name;
  const solid = geometryOf(bag.solid);
  if (solid !== null) {
    boxProjectUvs(solid, 1.5);
    const map = grainTexture();
    const mesh = new Mesh(
      solid,
      new MeshLambertMaterial({ vertexColors: true, map }),
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `${name}-solid`;
    group.add(mesh);
  }
  const glow = geometryOf(bag.glow);
  if (glow !== null) {
    const mesh = new Mesh(glow, new MeshBasicMaterial({ vertexColors: true }));
    mesh.name = `${name}-glow`;
    group.add(mesh);
  }
  return group;
}

export function renderCivil(
  name: string,
  instances: readonly FeatureInstance[],
  ctx: FeatureContext,
  builders: Readonly<Record<string, BuilderFn>>,
): Object3D {
  return bagObject(buildBag(instances, ctx, builders), name);
}
