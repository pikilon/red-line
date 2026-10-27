// Spec 26 Phase 1: rasterises the `terrain:` layers of a map into one byte per cell and expands the
// `features:` list into explicit instances. Build-time only: the sim reads the result and never generates.
// Integer arithmetic throughout (no Math.random, no float geometry), so every machine compiles the same bytes.

/** Index = byte value in the compiled `ground` layer. Append only: saves and the sim hold the numbers. */
export const GROUND_MATERIALS = ["grass", "dirt", "sand", "rock", "mud", "gravel", "asphalt", "concrete", "snow-field"];
/** Index = byte value in the compiled `roads` layer; 0 = no road. */
export const ROAD_TYPES = ["none", "asphalt", "dirt"];
/** Low two bits of a `water` byte; 0 = dry. Deep water blocks ground movement. */
export const WATER_DEPTHS = ["none", "shallow", "deep"];
/** Bits 2-3 of a `water` byte (kind << 2); 0 = dry. */
export const WATER_KINDS = ["none", "river", "lake", "sea"];
export const FEATURE_STATES = ["intact", "damaged", "wrecked", "abandoned"];

const WATER_DEPTH_MASK = 3;
const WATER_KIND_SHIFT = 2;

const key = (x, y) => `${x},${y}`;

/** Footprint after `rot` quarter turns: odd turns swap width and height. */
export const rotatedFootprint = ([w, h], rot) => (rot % 2 === 1 ? [h, w] : [w, h]);

/**
 * Whether the centre of cell (x, y) lies within `width / 2` cells of the polyline `path`. Exact: coordinates
 * are doubled so centres and the half width are integers, and the segment test compares squared lengths.
 */
export function pathCoversCell(path, width, x, y) {
  const px = 2 * x + 1;
  const py = 2 * y + 1;
  const limit = width * width; // (2 * width / 2)^2 in doubled coordinates
  for (let i = 0; i + 1 < path.length; i++) {
    const ax = 2 * path[i][0];
    const ay = 2 * path[i][1];
    const dx = 2 * path[i + 1][0] - ax;
    const dy = 2 * path[i + 1][1] - ay;
    const len2 = dx * dx + dy * dy;
    const along = (px - ax) * dx + (py - ay) * dy;
    let d2;
    if (len2 === 0 || along <= 0) d2 = (px - ax) ** 2 + (py - ay) ** 2;
    else if (along >= len2) d2 = (px - ax - dx) ** 2 + (py - ay - dy) ** 2;
    else {
      const cross = (px - ax) * dy - (py - ay) * dx;
      if (cross * cross <= limit * len2) return true;
      continue;
    }
    if (d2 <= limit) return true;
  }
  return false;
}

/** Calls `visit(x, y)` for every in-map cell of a shape: `{ rect }` (inclusive) or `{ path, width }`. */
function eachShapeCell(map, shape, visit) {
  if (shape.rect) {
    const [x0, y0, x1, y1] = shape.rect;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) visit(x, y);
    return;
  }
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) if (pathCoversCell(shape.path, shape.width, x, y)) visit(x, y);
  }
}

const rectOk = (map, [x0, y0, x1, y1]) => x0 <= x1 && y0 <= y1 && x1 < map.width && y1 < map.height;
const pathOk = (map, path) => path.every(([x, y]) => x < map.width && y < map.height);

/** Out-of-map shapes of `map.terrain`, as `{ pointer, message }`. */
export function checkTerrainShapes(map) {
  const problems = [];
  const shape = (pointer, s) => {
    if (s.rect ? !rectOk(map, s.rect) : !pathOk(map, s.path)) {
      problems.push({ pointer, message: "terrain shape out of bounds" });
    }
  };
  (map.terrain?.ground?.patches ?? []).forEach((p, i) => shape(`/terrain/ground/patches/${i}`, p));
  (map.terrain?.roads ?? []).forEach((r, i) => shape(`/terrain/roads/${i}`, r));
  (map.terrain?.water ?? []).forEach((w, i) => shape(`/terrain/water/${i}`, w));
  return problems;
}

/**
 * The three per-cell layers of `map.terrain`, row-major `width x height` bytes, or null without a `terrain`
 * key. Later entries paint over earlier ones. Water fords turn the water of their own entry shallow.
 * Shapes must be in bounds (`checkTerrainShapes`).
 * @returns {{ ground: Uint8Array, roads: Uint8Array, water: Uint8Array } | null}
 */
export function rasterizeTerrain(map) {
  const terrain = map.terrain;
  if (!terrain) return null;
  const size = map.width * map.height;
  const at = (x, y) => y * map.width + x;
  const ground = new Uint8Array(size).fill(GROUND_MATERIALS.indexOf(terrain.ground?.default ?? "grass"));
  const roads = new Uint8Array(size);
  const water = new Uint8Array(size);
  for (const patch of terrain.ground?.patches ?? []) {
    const material = GROUND_MATERIALS.indexOf(patch.material);
    eachShapeCell(map, patch, (x, y) => (ground[at(x, y)] = material));
  }
  for (const road of terrain.roads ?? []) {
    const type = ROAD_TYPES.indexOf(road.type);
    eachShapeCell(map, road, (x, y) => (roads[at(x, y)] = type));
  }
  for (const body of terrain.water ?? []) {
    const kind = WATER_KINDS.indexOf(body.kind) << WATER_KIND_SHIFT;
    const deep = WATER_DEPTHS.indexOf(body.depth);
    eachShapeCell(map, body, (x, y) => {
      const ford = (body.fords ?? []).some(([fx, fy, r]) => (x - fx) ** 2 + (y - fy) ** 2 <= r * r);
      water[at(x, y)] = kind | (ford ? WATER_DEPTHS.indexOf("shallow") : deep);
    });
  }
  return { ground, roads, water };
}

/** Whether a `water` byte is deep water. */
export const isDeepWater = (byte) => (byte & WATER_DEPTH_MASK) === WATER_DEPTHS.indexOf("deep");

/** Two lowercase hex digits per byte; "" for no layer. */
export const layerHex = (bytes) => (bytes ? Buffer.from(bytes).toString("hex") : "");

/** Integer hash of a seed and a cell to 32 unsigned bits; the same on every machine. */
export function cellHash(seed, x, y) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed + 1, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Expands `map.features` into explicit instances `{ type, x, y, rot, variant, state }` (`type` = index into
 * `featureTypes`), sorted by row, column, type. `solid` holds the cells nothing may stand on ("x,y"); blocking
 * instances are added to it. Explicit entries come first and a clash is an error; area entries fill what is
 * left, skipping any cell where the footprint does not fit.
 * @returns {{ instances: object[], problems: { pointer: string, code: string, message: string }[] }}
 */
export function expandFeatures(map, featureTypes, solid) {
  const instances = [];
  const problems = [];
  const index = new Map(featureTypes.map((t, i) => [t.id, i]));
  const entries = map.features ?? [];

  const cellsOf = (type, x, y, rot) => {
    const [w, h] = rotatedFootprint(type.footprint, rot);
    const cells = [];
    for (let cy = y; cy < y + h; cy++) for (let cx = x; cx < x + w; cx++) cells.push([cx, cy]);
    return cells;
  };
  const fits = (cells) => cells.every(([x, y]) => x < map.width && y < map.height);
  const free = (type, cells) => type.blocks === "none" || cells.every(([x, y]) => !solid.has(key(x, y)));
  const place = (typeIndex, x, y, rot, variant, state) => {
    const type = featureTypes[typeIndex];
    if (type.blocks !== "none") for (const [cx, cy] of cellsOf(type, x, y, rot)) solid.add(key(cx, cy));
    instances.push({ type: typeIndex, x, y, rot, variant, state });
  };

  entries.forEach((entry, i) => {
    if (!entry.at) return;
    const pointer = `/features/${i}`;
    const typeIndex = index.get(entry.type);
    if (typeIndex === undefined) {
      problems.push({ pointer: `${pointer}/type`, code: "unknown-reference", message: `unknown feature type ${entry.type}` });
      return;
    }
    const type = featureTypes[typeIndex];
    const [x, y] = entry.at;
    const rot = entry.rot ?? 0;
    const cells = cellsOf(type, x, y, rot);
    if (!fits(cells)) {
      problems.push({ pointer: `${pointer}/at`, code: "invalid-value", message: `${entry.type} footprint out of bounds` });
    } else if (!free(type, cells)) {
      problems.push({ pointer: `${pointer}/at`, code: "invalid-value", message: `${entry.type} footprint overlaps a blocked cell, deep water or another footprint` });
    } else if ((entry.variant ?? 0) >= type.variants) {
      problems.push({ pointer: `${pointer}/variant`, code: "invalid-value", message: `${entry.type} has ${type.variants} variants` });
    } else {
      place(typeIndex, x, y, rot, entry.variant ?? 0, FEATURE_STATES.indexOf(entry.state ?? "intact"));
    }
  });

  entries.forEach((entry, i) => {
    if (!entry.area) return;
    const pointer = `/features/${i}`;
    const typeIndex = index.get(entry.type);
    if (typeIndex === undefined) {
      problems.push({ pointer: `${pointer}/type`, code: "unknown-reference", message: `unknown feature type ${entry.type}` });
      return;
    }
    const type = featureTypes[typeIndex];
    const [x0, y0, x1, y1] = entry.area;
    if (x0 > x1 || y0 > y1 || x1 >= map.width || y1 >= map.height) {
      problems.push({ pointer: `${pointer}/area`, code: "invalid-value", message: "feature area out of bounds" });
      return;
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const h = cellHash(entry.seed, x, y);
        if (h % 100 >= entry.density) continue;
        const spread = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
        const rot = type.footprint[0] === type.footprint[1] ? 0 : spread & 3;
        const cells = cellsOf(type, x, y, rot);
        if (fits(cells) && free(type, cells)) place(typeIndex, x, y, rot, (spread >>> 8) % type.variants, 0);
      }
    }
  });

  instances.sort((a, b) => a.y - b.y || a.x - b.x || a.type - b.type || a.rot - b.rot);
  return { instances, problems };
}
