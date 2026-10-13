import {
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  PlaneGeometry,
  RGBAFormat,
  SphereGeometry,
  SRGBColorSpace,
  UnsignedByteType,
} from "three";
import { RULES, typeDef } from "../rules";
import { ENTITY_FLAGS, type EntityState, hasFlag } from "../sim/matchSnapshot";
import { RU_WHITE, UA_BLUE, UA_YELLOW } from "./liveries";

export const RU_BLUE = 0x0039a6;
export const RU_RED = 0xd52b1e;

/** Horizontal stripes of each faction's flag, top to bottom (spec 16 §4). */
export const FLAGS = {
  ukraine: [UA_BLUE, UA_YELLOW],
  russia: [RU_WHITE, RU_BLUE, RU_RED],
} as const;
type FlagId = keyof typeof FLAGS;

export const POLE_INSET = 0.2;
export const POLE_ABOVE = 1.2;
export const POLE_RADIUS = 0.035;
export const FLAG_LENGTH = 1.2;
export const FLAG_HEIGHT = 0.8;
export const FLAG_AMPLITUDE = 0.1;
/** Waves along the cloth (radians per model unit) and their speed (rad/s). */
const WAVE_NUMBER = 5.5;
const WAVE_SPEED = 4.5;
const POLE_COLOR = 0x8a8a8a;
const TEXTURE_SIZE = 64;

function flagIdOf(factionId: string): FlagId | null {
  return factionId in FLAGS ? (factionId as FlagId) : null;
}

/** The stripes of the flag flown on `kind`, or null when it is no faction's HQ. */
export function flagOf(kind: number): readonly number[] | null {
  const faction = RULES.factions.find((entry) => entry.hq === kind);
  const id = faction === undefined ? null : flagIdOf(faction.id);
  return id === null ? null : FLAGS[id];
}

/** The stripe colour at height `v` (0 bottom, 1 top). */
export function flagSample(stripes: readonly number[], v: number): number {
  const index = Math.min(
    stripes.length - 1,
    Math.max(0, Math.floor((1 - v) * stripes.length)),
  );
  return stripes[index] ?? 0;
}

/** Wave offset of the cloth at `s` (0 pole, 1 fly end) and time `t` seconds. */
export function flagWave(s: number, t: number, phase: number): number {
  if (s <= 0) return 0;
  return (
    FLAG_AMPLITUDE *
    Math.min(s, 1) *
    Math.sin(s * FLAG_LENGTH * WAVE_NUMBER - t * WAVE_SPEED + phase)
  );
}

function flagTexture(stripes: readonly number[]): DataTexture {
  const width = TEXTURE_SIZE;
  const height = TEXTURE_SIZE;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const color = flagSample(stripes, (y + 0.5) / height);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = (color >> 16) & 0xff;
      data[i + 1] = (color >> 8) & 0xff;
      data[i + 2] = color & 0xff;
      data[i + 3] = 255;
    }
  }
  const texture = new DataTexture(
    data,
    width,
    height,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** The cloth material: `flagWave` in the vertex shader, phase from the
 *  instance's x position, normals bent with the wave. */
function clothMaterial(
  stripes: readonly number[],
  time: { value: number },
): MeshLambertMaterial {
  const material = new MeshLambertMaterial({
    map: flagTexture(stripes),
    side: DoubleSide,
  });
  const wave = `float flagS = clamp( position.x / ${FLAG_LENGTH.toFixed(3)}, 0.0, 1.0 );
float flagArg = position.x * ${WAVE_NUMBER.toFixed(3)} - flagTime * ${WAVE_SPEED.toFixed(3)} + instanceMatrix[3].x;`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.flagTime = time;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float flagTime;",
      )
      .replace(
        "#include <beginnormal_vertex>",
        `${wave}
float flagSlope = ${FLAG_AMPLITUDE.toFixed(3)} * ( flagS * ${WAVE_NUMBER.toFixed(3)} * cos( flagArg ) + sin( flagArg ) / ${FLAG_LENGTH.toFixed(3)} );
vec3 objectNormal = normalize( vec3( -flagSlope, 0.0, 1.0 ) );
#ifdef USE_TANGENT
  vec3 objectTangent = vec3( tangent.xyz );
#endif`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
transformed.z += ${FLAG_AMPLITUDE.toFixed(3)} * flagS * sin( flagArg );`,
      );
  };
  material.customProgramCacheKey = () => "flag-cloth";
  return material;
}

/** A unit-high shaft standing on the origin, scaled to the pole height. */
function poleGeometry(): CylinderGeometry {
  const shaft = new CylinderGeometry(POLE_RADIUS, POLE_RADIUS, 1, 6);
  shaft.translate(0, 0.5, 0);
  return shaft;
}

export interface FlagRenderer {
  readonly group: Group;
  readonly poles: InstancedMesh;
  /** One cloth mesh per faction id of `FLAGS`. */
  readonly cloths: Readonly<Record<string, InstancedMesh>>;
  update(entities: readonly EntityState[], nowMs: number): void;
}

/** Poles and waving cloths on every complete HQ (spec 16 §4). */
export function createFlagRenderer(capacity: number): FlagRenderer {
  const group = new Group();
  const poles = new InstancedMesh(
    poleGeometry(),
    new MeshLambertMaterial({ color: POLE_COLOR }),
    capacity,
  );
  const finials = new InstancedMesh(
    new SphereGeometry(POLE_RADIUS * 1.8, 8, 6),
    new MeshLambertMaterial({ color: POLE_COLOR }),
    capacity,
  );
  const time = { value: 0 };
  const cloth = new PlaneGeometry(FLAG_LENGTH, FLAG_HEIGHT, 16, 1);
  // The hoist edge sits on the pole (x = 0), the cloth hangs below its top.
  cloth.translate(FLAG_LENGTH / 2, -FLAG_HEIGHT / 2, 0);
  const cloths: Record<string, InstancedMesh> = {};
  for (const [id, stripes] of Object.entries(FLAGS)) {
    const mesh = new InstancedMesh(
      cloth,
      clothMaterial(stripes, time),
      capacity,
    );
    mesh.castShadow = true;
    cloths[id] = mesh;
  }
  for (const mesh of [poles, finials, ...Object.values(cloths)]) {
    mesh.count = 0;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  poles.castShadow = true;

  const matrix = new Matrix4();
  const counts: Record<string, number> = {};

  return {
    group,
    poles,
    cloths,
    update(entities, nowMs) {
      time.value = nowMs / 1000;
      let poleCount = 0;
      for (const id of Object.keys(cloths)) counts[id] = 0;
      for (const entity of entities) {
        if (
          hasFlag(entity, ENTITY_FLAGS.ghost) ||
          hasFlag(entity, ENTITY_FLAGS.underConstruction)
        ) {
          continue;
        }
        const faction = RULES.factions.find(
          (entry) => entry.hq === entity.kind,
        );
        const id = faction === undefined ? null : flagIdOf(faction.id);
        const mesh = id === null ? undefined : cloths[id];
        if (id === null || mesh === undefined || poleCount >= capacity)
          continue;
        const [w, h, d] = typeDef(entity.kind).render.size.map(
          (size) => size / 100,
        ) as [number, number, number];
        const top = h + POLE_ABOVE;
        const x = entity.x - w / 2 + POLE_INSET;
        const z = entity.y + d / 2 - POLE_INSET;
        matrix.makeScale(1, top, 1).setPosition(x, 0, z);
        poles.setMatrixAt(poleCount, matrix);
        matrix.makeTranslation(x, top, z);
        finials.setMatrixAt(poleCount, matrix);
        poleCount++;
        const index = counts[id] ?? 0;
        matrix.makeTranslation(x, top - POLE_RADIUS * 2, z);
        mesh.setMatrixAt(index, matrix);
        counts[id] = index + 1;
      }
      poles.count = poleCount;
      finials.count = poleCount;
      poles.instanceMatrix.needsUpdate = true;
      finials.instanceMatrix.needsUpdate = true;
      for (const [id, mesh] of Object.entries(cloths)) {
        mesh.count = counts[id] ?? 0;
        mesh.instanceMatrix.needsUpdate = true;
      }
    },
  };
}
