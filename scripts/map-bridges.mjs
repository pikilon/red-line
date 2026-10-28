// Spec 26 section 17: expands the bridge entries (`{ type, from, to }`) of a map's `features:` into deck
// rectangles. Build-time only and integer-only; the sim reads the per-cell `bridges` layer (non-zero = deck).

const key = (x, y) => `${x},${y}`;

/**
 * @param map the parsed map
 * @param featureTypes compiled feature types (family `bridge` ones carry `lanes`)
 * @param solid cells nothing may stand on ("x,y"), deep water included; deck cells that are not deep water are added
 * @param isDeep (x, y) => whether the cell is deep water
 * @returns {{ instances: object[], layer: Uint8Array | null, problems: { pointer: string, code: string, message: string }[] }}
 *   instance `{ type, x, y, rot, variant, state, to }`: `(x, y)` the top-left deck cell, `to` the bottom-right one
 *   (inclusive, lanes included). Layer value = index of the bridge type + 1.
 */
export function expandBridges(map, featureTypes, solid, isDeep) {
  const instances = [];
  const problems = [];
  let layer = null;
  const bad = (pointer, message) => problems.push({ pointer, code: "invalid-value", message });
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < map.width && y < map.height;

  (map.features ?? []).forEach((entry, i) => {
    if (!entry.from) return;
    const pointer = `/features/${i}`;
    const typeIndex = featureTypes.findIndex((t) => t.id === entry.type);
    const type = featureTypes[typeIndex];
    if (!type) {
      problems.push({ pointer: `${pointer}/type`, code: "unknown-reference", message: `unknown feature type ${entry.type}` });
      return;
    }
    if (type.family !== "bridge") return bad(`${pointer}/type`, `${entry.type} is not a bridge type`);
    const [fx, fy] = entry.from;
    const [tx, ty] = entry.to;
    if (fx !== tx && fy !== ty) return bad(pointer, "a bridge must be straight: horizontal or vertical");
    if ((entry.variant ?? 0) >= type.variants) return bad(`${pointer}/variant`, `${entry.type} has ${type.variants} variants`);
    const lanes = type.lanes ?? 1;
    const horizontal = fy === ty;
    const x0 = Math.min(fx, tx);
    const y0 = Math.min(fy, ty);
    const x1 = Math.max(fx, tx) + (horizontal ? 0 : lanes - 1);
    const y1 = Math.max(fy, ty) + (horizontal ? lanes - 1 : 0);
    const length = horizontal ? x1 - x0 + 1 : y1 - y0 + 1;
    if (length < 3) return bad(pointer, "a bridge deck needs at least 3 cells");
    if (!inBounds(x0, y0) || !inBounds(x1, y1)) return bad(pointer, "bridge deck out of bounds");
    // Both ends must touch free land, lane by lane (never deep water, a rock or a footprint).
    for (let lane = 0; lane < lanes; lane++) {
      const ends = horizontal
        ? [[x0 - 1, y0 + lane], [x1 + 1, y0 + lane]]
        : [[x0 + lane, y0 - 1], [x0 + lane, y1 + 1]];
      for (const [ex, ey] of ends) {
        if (!inBounds(ex, ey) || solid.has(key(ex, ey))) return bad(pointer, `bridge end at ${ex},${ey} does not connect to land`);
      }
    }
    layer ??= new Uint8Array(map.width * map.height);
    const cells = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (layer[y * map.width + x] !== 0) return bad(pointer, `bridge overlaps another bridge at ${x},${y}`);
        if (solid.has(key(x, y)) && !isDeep(x, y)) return bad(pointer, `bridge deck overlaps a blocked cell or footprint at ${x},${y}`);
        cells.push([x, y]);
      }
    }
    for (const [x, y] of cells) {
      layer[y * map.width + x] = typeIndex + 1;
      solid.add(key(x, y));
    }
    instances.push({ type: typeIndex, x: x0, y: y0, rot: horizontal ? 0 : 1, variant: entry.variant ?? 0, state: 0, to: [x1, y1] });
  });
  return { instances, layer, problems };
}
