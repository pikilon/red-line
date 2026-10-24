import ruleset from "@data/ruleset.json";
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Uint32BufferAttribute,
} from "three";
import decalData from "../../../data/render/decals.json";
import { typeDef, WEAPONS } from "../rules";
import {
  ENTITY_FLAGS,
  type EntityState,
  hasFlag,
  type MatchSnapshot,
} from "../sim/matchSnapshot";
import { ATLAS_CELLS, createDecalAtlas, DECAL_CELLS } from "./decalTextures";
import { createRng, valueNoise } from "./terrainTexture";

/** Balance values for the ground marks (`data/render/decals.json`, spec 24). */
export type DecalConfig = typeof decalData;
export const DECALS: DecalConfig = decalData;

const DAMAGE_TYPES = ruleset.damageTypes as readonly string[];
const TICKS_PER_SECOND = 15;
/** Marks sit this far above the ground plane to avoid z-fighting. */
const GROUND_LIFT = 0.012;
/** Same dirt noise as the terrain overlay (terrain.ts, spec 10 §4). */
const DIRT_NOISE_PERIOD = 12;
const DIRT_ALPHA_LOW = 0.55;
const DIRT_ALPHA_HIGH = 0.7;

/** How well a surface keeps a mark (0 none, 1 full) and the mark tint. */
export interface SurfaceSample {
  strength: number;
  color: number;
  /** 0 soft .. 1 hard; hard ground keeps fainter marks. */
  hardness: number;
  /** Snow-covered ground: marks on it fill up while it snows. */
  snowy?: boolean;
}
/** Tile coordinates in, surface out; swap it when weather or relief land. */
export type SurfaceAt = (x: number, y: number) => SurfaceSample;
/** Ground height in tiles at a tile position; flat by default. */
export type HeightAt = (x: number, y: number) => number;

type Surfaces = DecalConfig["surfaces"];

function surfaceOf(surfaces: Surfaces, name: keyof Surfaces): SurfaceSample {
  const entry = surfaces[name];
  return {
    strength: 1 - entry.hardness,
    color: Number(entry.color),
    hardness: entry.hardness,
  };
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Surface of the generated terrain: rock keeps nothing, grass little, the
 *  dirt overlay (same noise as the terrain mesh) a lot. */
export function createTerrainSurface(
  width: number,
  height: number,
  rockCells: Uint8Array,
  seed: number,
  surfaces: Surfaces = DECALS.surfaces,
): SurfaceAt {
  const rock = surfaceOf(surfaces, "rock");
  const grass = surfaceOf(surfaces, "grass");
  const dirt = surfaceOf(surfaces, "dirt");
  return (x, y) => {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (cx < 0 || cy < 0 || cx >= width || cy >= height) return rock;
    if ((rockCells[cy * width + cx] ?? 0) === 1) return rock;
    const mix = smoothstep(
      DIRT_ALPHA_LOW,
      DIRT_ALPHA_HIGH,
      valueNoise(x, y, DIRT_NOISE_PERIOD, seed),
    );
    return {
      strength: grass.strength + (dirt.strength - grass.strength) * mix,
      color: mix > 0.5 ? dirt.color : grass.color,
      hardness: grass.hardness + (dirt.hardness - grass.hardness) * mix,
    };
  };
}

/** Where the weather layer has put snow, and whether it is snowing now. */
export interface SnowSource {
  /** Snow cover 0..1 at tile (x, y), as the ground cover layer draws it. */
  coverage(x: number, y: number): number;
  /** True while snow is falling (marks on snow fill up). */
  falling(): boolean;
}

/** Cover at (x, y) the way the cover shader paints it: the per-cell thresholds
 *  are filtered bilinearly (texel centres at cell centres) and the edge is a
 *  smoothstep of width `edge` above the threshold (weather.ts, spec 22 §4). */
export function snowCoverage(
  thresholds: Uint8Array,
  width: number,
  height: number,
  cover: number,
  x: number,
  y: number,
  edge: number = DECALS.snow.coverEdge,
): number {
  const fx = Math.min(width - 1, Math.max(0, x - 0.5));
  const fy = Math.min(height - 1, Math.max(0, y - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (cx: number, cy: number): number =>
    (thresholds[cy * width + cx] ?? 255) / 255;
  const top = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
  const bottom = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
  return smoothstep(
    top * (1 - ty) + bottom * ty,
    top * (1 - ty) + bottom * ty + edge,
    cover,
  );
}

/** Surface of `base` blended towards the snow surface by the snow coverage, so
 *  marks neither turn white before the snow nor stay dark on it. */
export function withSnow(
  base: SurfaceAt,
  snow: SnowSource,
  surfaces: Surfaces = DECALS.surfaces,
): SurfaceAt {
  const white = surfaceOf(surfaces, "snow");
  return (x, y) => {
    const ground = base(x, y);
    if (ground.strength <= 0) return ground;
    const amount = snow.coverage(x, y);
    if (amount <= 0.01) return ground;
    return {
      strength: ground.strength + (white.strength - ground.strength) * amount,
      color: amount > 0.5 ? white.color : ground.color,
      hardness: ground.hardness + (white.hardness - ground.hardness) * amount,
      snowy: amount > 0.5,
    };
  };
}

interface Mark {
  alive: boolean;
  /** Ageing runs faster while snow falls on it. */
  snowy: boolean;
  /** Milliseconds of effective age since `startMs`. */
  age: number;
  peak: number;
  startMs: number;
  lifeMs: number;
  fadeMs: number;
  /** Packed 0..1 tint. */
  r: number;
  g: number;
  b: number;
}

/** Opacity factor (0..1) of a mark of age `ageMs`: full, then a linear fade. */
export function markFade(
  ageMs: number,
  lifeMs: number,
  fadeMs: number,
): number {
  if (ageMs < 0) return 0;
  if (ageMs < lifeMs) return 1;
  if (fadeMs <= 0) return 0;
  return Math.max(0, 1 - (ageMs - lifeMs) / fadeMs);
}

export interface MarkSpec {
  /** Centre in tiles. */
  x: number;
  y: number;
  /** Unit vector of the long axis. */
  dirX: number;
  dirY: number;
  halfWidth: number;
  halfLength: number;
  cell: keyof typeof DECAL_CELLS;
  color: number;
  alpha: number;
  snowy?: boolean;
  startMs: number;
  lifeMs: number;
  fadeMs: number;
}

export interface Decals {
  readonly group: Group;
  /** Stamps one mark; the oldest is recycled when the pool is full. */
  stamp(spec: MarkSpec): void;
  /** Leaves tracks behind the moving wheeled and tracked `entities`. */
  recordMovers(entities: readonly EntityState[], nowMs: number): void;
  /** Leaves scorches and craters where the shots of `snapshot` land. */
  recordShots(snapshot: MatchSnapshot, nowMs: number): void;
  setSurface(surface: SurfaceAt): void;
  /** Makes marks on snow-covered ground shallow-lived while it snows. */
  setSnow(snow: SnowSource): void;
  setHeight(height: HeightAt): void;
  /** Recomputes mark opacities at `nowMs`. */
  update(nowMs: number): void;
  clear(): void;
  /** Marks currently alive (not yet recycled). */
  count(): number;
}

interface Walker {
  x: number;
  y: number;
  carry: number;
  dirX: number;
  dirY: number;
}

/** Pooled ground marks drawn as one transparent mesh (spec 24). */
export function createDecals(
  surface: SurfaceAt,
  config: DecalConfig = DECALS,
): Decals {
  let heightAt: HeightAt = () => 0;
  const trackLayer = createLayer(config.tracks.maxMarks, () => heightAt);
  const blastLayer = createLayer(config.blasts.maxMarks, () => heightAt);
  const group = new Group();
  group.add(trackLayer.mesh, blastLayer.mesh);
  const stamp = (spec: MarkSpec): void =>
    (spec.cell === "tread" ? trackLayer : blastLayer).stamp(spec);
  let surfaceAt = surface;
  let snow: SnowSource | null = null;
  let lastUpdateMs: number | null = null;
  const walkers = new Map<number, Walker>();
  /** Cosmetic variation only; never feeds the simulation. */
  const rng = createRng(0x5eed);

  function leaveTracks(
    entity: EntityState,
    walker: Walker,
    nowMs: number,
  ): void {
    const type = typeDef(entity.kind);
    const kind = locomotorKind(type.locomotor);
    if (kind !== "tracks" && kind !== "wheels") return;
    const style =
      kind === "tracks" ? config.tracks.tracked : config.tracks.wheeled;
    const hullWidth = type.render.size[0] / 100;
    const hullLength = type.render.size[2] / 100;
    const gauge = hullWidth * style.gaugePerHull;
    const halfLength = Math.max(0.1, hullLength * style.lengthPerHull);
    for (const side of [-1, 1]) {
      // Gaps, wobble and uneven pressure keep the strips from looking drawn.
      if (rng() < config.tracks.gapChance) continue;
      const wobble = (rng() - 0.5) * 2 * config.tracks.wobbleTiles;
      const turn = (rng() - 0.5) * 2 * config.tracks.angleJitter;
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);
      const dirX = walker.dirX * cos - walker.dirY * sin;
      const dirY = walker.dirX * sin + walker.dirY * cos;
      // The strip ends at the hull and trails behind it; its ground (colour,
      // snow, hardness) is read where the strip lies, not under the hull.
      const x =
        entity.x -
        walker.dirY * (gauge * side + wobble) -
        walker.dirX * halfLength;
      const y =
        entity.y +
        walker.dirX * (gauge * side + wobble) -
        walker.dirY * halfLength;
      const sample = surfaceAt(x, y);
      const alpha = config.tracks.peakAlpha * sample.strength;
      if (alpha <= 0.01) continue;
      stamp({
        x,
        y,
        dirX,
        dirY,
        halfWidth:
          Math.max(0.03, (hullWidth * style.stripWidthPerHull) / 2) *
          (0.8 + 0.4 * rng()),
        halfLength,
        cell: "tread",
        color: sample.color,
        alpha: alpha * (0.5 + 0.5 * rng()),
        snowy: sample.snowy,
        startMs: nowMs,
        lifeMs: config.tracks.lifetimeMs,
        fadeMs: config.tracks.fadeMs,
      });
    }
  }

  function recordMovers(entities: readonly EntityState[], nowMs: number): void {
    const seen = new Set<number>();
    for (const entity of entities) {
      const type = typeDef(entity.kind);
      if (type.category !== "unit" || type.locomotor < 0) continue;
      seen.add(entity.id);
      const walker = walkers.get(entity.id);
      if (walker === undefined) {
        walkers.set(entity.id, {
          x: entity.x,
          y: entity.y,
          carry: 0,
          dirX: 0,
          dirY: 1,
        });
        continue;
      }
      const dx = entity.x - walker.x;
      const dy = entity.y - walker.y;
      const length = Math.hypot(dx, dy);
      walker.x = entity.x;
      walker.y = entity.y;
      if (length < 1e-4) continue;
      if (length > config.tracks.maxJumpTiles) {
        walker.carry = 0;
        continue;
      }
      walker.dirX = dx / length;
      walker.dirY = dy / length;
      walker.carry += length;
      if (walker.carry < config.tracks.spacingTiles) continue;
      walker.carry %= config.tracks.spacingTiles;
      leaveTracks(entity, walker, nowMs);
    }
    for (const id of walkers.keys()) if (!seen.has(id)) walkers.delete(id);
  }

  function recordShots(snapshot: MatchSnapshot, nowMs: number): void {
    const byId = new Map<number, EntityState>();
    for (const entity of snapshot.entities) byId.set(entity.id, entity);
    for (const shooter of snapshot.entities) {
      if (!hasFlag(shooter, ENTITY_FLAGS.fired) || shooter.target === null)
        continue;
      const target = byId.get(shooter.target);
      const weapon = WEAPONS[typeDef(shooter.kind).weapon];
      if (target === undefined || weapon === undefined) continue;
      const blast =
        config.blasts.byDamageType[
          DAMAGE_TYPES[
            weapon.damageType
          ] as keyof typeof config.blasts.byDamageType
        ];
      if (blast === undefined) continue;
      const delayMs = (weapon.projectileTicks / TICKS_PER_SECOND) * 1000;
      const radius = Math.max(
        blast.radiusTiles,
        (weapon.splashCenti / 100) * blast.splashFactor,
      );
      stampBlast(target.x, target.y, radius, blast.crater, nowMs + delayMs);
    }
  }

  function stampBlast(
    x: number,
    y: number,
    radius: number,
    crater: boolean,
    startMs: number,
  ): void {
    const sample = surfaceAt(x, y);
    // Rock shows scorches but no craters.
    const soil = sample.strength > 0 ? 1 : 0;
    // A random orientation and uneven axes make each blast different.
    const angle = rng() * Math.PI * 2;
    const base = {
      x,
      y,
      dirX: Math.cos(angle),
      dirY: Math.sin(angle),
      snowy: sample.snowy,
      startMs,
      lifeMs: config.blasts.lifetimeMs,
      fadeMs: config.blasts.fadeMs,
    };
    const scorchHalf = radius * config.blasts.scorchPerCrater;
    stamp({
      ...base,
      halfWidth: scorchHalf * (0.85 + 0.3 * rng()),
      halfLength: scorchHalf * (0.85 + 0.3 * rng()),
      cell: "scorch",
      color: Number(config.blasts.scorchColor),
      alpha: config.blasts.scorchAlpha * (0.75 + 0.25 * rng()),
    });
    if (crater && soil > 0) {
      stamp({
        ...base,
        halfWidth: radius * (0.85 + 0.3 * rng()),
        halfLength: radius * (0.85 + 0.3 * rng()),
        cell: "crater",
        color: Number(config.blasts.craterColor),
        alpha: config.blasts.craterAlpha * (0.75 + 0.25 * rng()),
      });
    }
  }

  return {
    group,
    stamp,
    recordMovers,
    recordShots,
    setSurface(next) {
      surfaceAt = next;
    },
    setSnow(next) {
      snow = next;
    },
    setHeight(next) {
      heightAt = next;
    },
    update(nowMs) {
      const dtMs =
        lastUpdateMs === null ? 0 : Math.max(0, nowMs - lastUpdateMs);
      lastUpdateMs = nowMs;
      const snowing = snow?.falling() ?? false;
      trackLayer.update(nowMs, dtMs, snowing);
      blastLayer.update(nowMs, dtMs, snowing);
    },
    clear() {
      trackLayer.clear();
      blastLayer.clear();
      lastUpdateMs = null;
      walkers.clear();
    },
    count: () => trackLayer.count() + blastLayer.count(),
  };
}

interface Layer {
  readonly mesh: Mesh;
  stamp(spec: MarkSpec): void;
  update(nowMs: number, dtMs: number, snowing: boolean): void;
  clear(): void;
  count(): number;
}

/** One ring of marks drawn as a single transparent mesh; the oldest mark is
 *  recycled when full (Zero Hour evicts FIFO too, spec 24 §2). */
function createLayer(capacity: number, heightOf: () => HeightAt): Layer {
  const marks: Mark[] = Array.from({ length: capacity }, () => ({
    alive: false,
    snowy: false,
    age: 0,
    peak: 0,
    startMs: 0,
    lifeMs: 0,
    fadeMs: 0,
    r: 0,
    g: 0,
    b: 0,
  }));
  const positions = new Float32Array(capacity * 4 * 3);
  const uvs = new Float32Array(capacity * 4 * 2);
  const colors = new Float32Array(capacity * 4 * 4);
  const indices = new Uint32Array(capacity * 6);
  for (let slot = 0; slot < capacity; slot++) {
    const v = slot * 4;
    indices.set([v, v + 1, v + 2, v, v + 2, v + 3], slot * 6);
  }
  const geometry = new BufferGeometry();
  const positionAttribute = new BufferAttribute(positions, 3);
  const colorAttribute = new BufferAttribute(colors, 4);

  geometry.setAttribute("position", positionAttribute);
  const uvAttribute = new BufferAttribute(uvs, 2);
  geometry.setAttribute("uv", uvAttribute);
  geometry.setAttribute("color", colorAttribute);
  geometry.setIndex(new Uint32BufferAttribute(indices, 1));
  geometry.setDrawRange(0, 0);

  const material = new MeshBasicMaterial({
    map: createDecalAtlas(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = "decals";
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;

  let cursor = 0;
  let highest = 0;
  let alive = 0;

  function stamp(spec: MarkSpec): void {
    const slot = cursor;
    cursor = (cursor + 1) % capacity;
    highest = Math.max(highest, slot + 1);
    const mark = marks[slot];
    if (mark === undefined) return;
    if (!mark.alive) alive++;
    mark.alive = true;
    mark.age = 0;
    mark.snowy = spec.snowy === true;
    mark.peak = spec.alpha;
    mark.startMs = spec.startMs;
    mark.lifeMs = spec.lifeMs;
    mark.fadeMs = spec.fadeMs;
    mark.r = ((spec.color >> 16) & 0xff) / 255;
    mark.g = ((spec.color >> 8) & 0xff) / 255;
    mark.b = (spec.color & 0xff) / 255;

    const rightX = -spec.dirY;
    const rightY = spec.dirX;
    const lift = heightOf()(spec.x, spec.y) + GROUND_LIFT;
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const;
    corners.forEach(([side, end], corner) => {
      const px =
        spec.x +
        rightX * spec.halfWidth * side +
        spec.dirX * spec.halfLength * end;
      const py =
        spec.y +
        rightY * spec.halfWidth * side +
        spec.dirY * spec.halfLength * end;
      const vertex = slot * 4 + corner;
      positions.set([px, lift, py], vertex * 3);
      const cellU = (DECAL_CELLS[spec.cell] + (side + 1) / 2) / ATLAS_CELLS;
      uvs.set([cellU, (end + 1) / 2], vertex * 2);
    });
    positionAttribute.needsUpdate = true;
    uvAttribute.needsUpdate = true;
    geometry.setDrawRange(0, highest * 6);
  }

  function update(nowMs: number, dtMs: number, snowing: boolean): void {
    let live = 0;
    for (let slot = 0; slot < highest; slot++) {
      const mark = marks[slot];
      if (mark === undefined || !mark.alive) continue;
      // Snowfall fills in marks lying on snow; before `startMs` nothing ages.
      if (nowMs >= mark.startMs) {
        mark.age += dtMs * (mark.snowy && snowing ? DECALS.snow.fillRate : 1);
      } else {
        mark.age = 0;
      }
      const age = nowMs >= mark.startMs ? mark.age : -1;
      if (age >= mark.lifeMs + mark.fadeMs) mark.alive = false;
      else live++;
      const alpha = mark.alive
        ? mark.peak * markFade(age, mark.lifeMs, mark.fadeMs)
        : 0;
      for (let corner = 0; corner < 4; corner++) {
        colors.set([mark.r, mark.g, mark.b, alpha], (slot * 4 + corner) * 4);
      }
    }
    alive = live;
    colorAttribute.needsUpdate = true;
  }

  return {
    mesh,
    stamp,
    update,
    clear() {
      for (const mark of marks) mark.alive = false;
      colors.fill(0);
      colorAttribute.needsUpdate = true;
      alive = 0;
    },
    count: () => alive,
  };
}

function locomotorKind(index: number): string {
  return (
    (ruleset.locomotors[index] as { kind: string } | undefined)?.kind ?? "foot"
  );
}
