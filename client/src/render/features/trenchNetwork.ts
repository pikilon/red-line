/** Spec 35: the dug trenches as one network of smooth channels. The sim digs
 *  2x1 pieces; drawn one by one they read as blocks, so the client joins
 *  every piece to its neighbours (any cell 8-adjacent to another piece's
 *  cell), walks the joined cells as polylines and smooths them, so straight
 *  lines stay straight, staircase diagonals become slopes and corners bend.
 *  The terrain deformer carves the polylines into the ground with a crater
 *  like profile (`trenchProfile`); the earthwork renderer dresses them. */

/** A trench piece as the network needs it (a `FeatureInstance` fits). */
export interface TrenchPiece {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** 0 finished, 1 half dug, 2 just started (feature damage states). */
  readonly state: number;
  /** 1: a covered shelter over the middle of the piece. */
  readonly variant: number;
}

/** A point of a smoothed trench centreline, in tiles. */
export interface TrenchPoint {
  readonly x: number;
  readonly z: number;
  /** Share of the full depth dug, 0..1. */
  readonly dug: number;
}

/** One straight run of a centreline the deformer carves. */
export interface TrenchStroke {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
  /** Depth in tiles at each end. */
  readonly d0: number;
  readonly d1: number;
}

/** Full depth of a finished trench, in tiles (the deformer's deepest sink). */
export const TRENCH_DEPTH = 0.2;
/** Half width of the channel in tiles; the walls end here. */
export const TRENCH_HALF_WIDTH = 0.4;
/** Spoil berm height as a share of the depth. */
export const TRENCH_RIM = 0.35;
/** Profile reach in half widths: nothing changes past it. */
export const TRENCH_REACH = 2.2;
/** Where the berm crest sits, in half widths. */
export const TRENCH_CREST = 1.3;

/** Share of the depth dug per damage state (index = state). */
const DUG = [1, 0.55, 0.15];

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Trench height at `t` half widths from the centreline for unit depth: a
 *  flat floor, steep walls and a spoil berm outside them, like a crater rim
 *  pulled along a line. */
export function trenchProfile(t: number, rim = TRENCH_RIM): number {
  if (t >= TRENCH_REACH) return 0;
  const bowl = 1 - smoothstep(0.55, 1, t);
  const crest = Math.exp(-(((t - TRENCH_CREST) / 0.28) ** 2));
  const fade = 1 - smoothstep(1.8, TRENCH_REACH, t);
  return -bowl + rim * crest * fade;
}

/** Share of the depth a piece in `state` has dug. */
export function dugShare(state: number): number {
  return DUG[Math.min(Math.max(state, 0), 2)] ?? 0;
}

/** The cells a piece covers, in reading order. */
function cellsOf(piece: TrenchPiece): [number, number][] {
  const cells: [number, number][] = [];
  for (let y = piece.y; y < piece.y + piece.height; y++) {
    for (let x = piece.x; x < piece.x + piece.width; x++) cells.push([x, y]);
  }
  return cells;
}

const key = (x: number, y: number): number => y * 65536 + x;

/** Smoothed centrelines of the network, one per run between ends and
 *  junctions. */
export function trenchLines(pieces: readonly TrenchPiece[]): TrenchPoint[][] {
  const owner = new Map<number, number>();
  pieces.forEach((piece, index) => {
    for (const [x, y] of cellsOf(piece)) owner.set(key(x, y), index);
  });
  const nodes = new Map<number, { x: number; y: number; dug: number }>();
  const links = new Map<number, Set<number>>();
  const link = (a: number, b: number): void => {
    if (a === b) return;
    links.get(a)?.add(b);
    links.get(b)?.add(a);
  };
  for (const piece of pieces) {
    const dug = dugShare(piece.state);
    const cells = cellsOf(piece);
    for (const [x, y] of cells) {
      nodes.set(key(x, y), { x, y, dug });
      if (!links.has(key(x, y))) links.set(key(x, y), new Set());
    }
    for (let i = 1; i < cells.length; i++) {
      const [ax, ay] = cells[i - 1] as [number, number];
      const [bx, by] = cells[i] as [number, number];
      link(key(ax, ay), key(bx, by));
    }
  }
  // Neighbouring pieces join at their closest cells.
  pieces.forEach((piece, index) => {
    const best = new Map<number, [number, number, number]>();
    for (const [x, y] of cellsOf(piece)) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const other = owner.get(key(x + dx, y + dy));
          if (other === undefined || other <= index) continue;
          const distance = Math.abs(dx) + Math.abs(dy);
          const previous = best.get(other);
          if (previous === undefined || distance < previous[0]) {
            best.set(other, [distance, key(x, y), key(x + dx, y + dy)]);
          }
        }
      }
    }
    for (const [, a, b] of best.values()) link(a, b);
  });

  const seen = new Set<string>();
  const edge = (a: number, b: number): string =>
    a < b ? `${a}:${b}` : `${b}:${a}`;
  const walk = (start: number, next: number): number[] => {
    const path = [start];
    let previous = start;
    let current = next;
    seen.add(edge(start, next));
    for (;;) {
      path.push(current);
      const around = links.get(current);
      if (around === undefined || around.size !== 2 || current === start) {
        break;
      }
      const onward = [...around].find((n) => n !== previous);
      if (onward === undefined || seen.has(edge(current, onward))) break;
      seen.add(edge(current, onward));
      previous = current;
      current = onward;
    }
    return path;
  };
  const paths: number[][] = [];
  const order = [...links.keys()].sort((a, b) => a - b);
  for (const start of order) {
    const around = links.get(start) as Set<number>;
    if (around.size === 2) continue;
    if (around.size === 0) {
      paths.push([start]);
      continue;
    }
    for (const next of [...around].sort((a, b) => a - b)) {
      if (!seen.has(edge(start, next))) paths.push(walk(start, next));
    }
  }
  // What is left are closed loops.
  for (const start of order) {
    for (const next of [...(links.get(start) as Set<number>)]) {
      if (!seen.has(edge(start, next))) paths.push(walk(start, next));
    }
  }
  return paths.map((path) =>
    smooth(
      path.map((id) => {
        const node = nodes.get(id) as { x: number; y: number; dug: number };
        return { x: node.x + 0.5, z: node.y + 0.5, dug: node.dug };
      }),
    ),
  );
}

/** Two relaxing passes (staircases flatten, the ends stay put) and two
 *  Chaikin cuts (corners round). */
function smooth(points: TrenchPoint[]): TrenchPoint[] {
  let line = points;
  for (let pass = 0; pass < 2 && line.length > 2; pass++) {
    line = line.map((point, i) => {
      const before = line[i - 1];
      const after = line[i + 1];
      if (before === undefined || after === undefined) return point;
      return {
        x: (before.x + 2 * point.x + after.x) / 4,
        z: (before.z + 2 * point.z + after.z) / 4,
        dug: point.dug,
      };
    });
  }
  for (let cut = 0; cut < 2 && line.length > 2; cut++) {
    const next: TrenchPoint[] = [line[0] as TrenchPoint];
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i] as TrenchPoint;
      const b = line[i + 1] as TrenchPoint;
      const mix = (t: number): TrenchPoint => ({
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        dug: a.dug + (b.dug - a.dug) * t,
      });
      if (i > 0) next.push(mix(0.25));
      if (i < line.length - 2) next.push(mix(0.75));
    }
    next.push(line[line.length - 1] as TrenchPoint);
    line = next;
  }
  return line;
}

/** The runs the deformer carves. A lone cell becomes a dot. */
export function trenchStrokes(lines: readonly TrenchPoint[][]): TrenchStroke[] {
  const strokes: TrenchStroke[] = [];
  for (const line of lines) {
    const first = line[0];
    if (first === undefined) continue;
    if (line.length === 1) {
      const d = first.dug * TRENCH_DEPTH;
      strokes.push({
        x0: first.x,
        z0: first.z,
        x1: first.x,
        z1: first.z,
        d0: d,
        d1: d,
      });
      continue;
    }
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1] as TrenchPoint;
      const b = line[i] as TrenchPoint;
      strokes.push({
        x0: a.x,
        z0: a.z,
        x1: b.x,
        z1: b.z,
        d0: a.dug * TRENCH_DEPTH,
        d1: b.dug * TRENCH_DEPTH,
      });
    }
  }
  return strokes;
}

/** Distance from (x, z) to the nearest stroke and the depth there. */
export function nearestStroke(
  strokes: readonly TrenchStroke[],
  x: number,
  z: number,
): { distance: number; depth: number } {
  let distance = Infinity;
  let depth = 0;
  for (const s of strokes) {
    const dx = s.x1 - s.x0;
    const dz = s.z1 - s.z0;
    const length = dx * dx + dz * dz;
    const t =
      length === 0
        ? 0
        : Math.min(
            1,
            Math.max(0, ((x - s.x0) * dx + (z - s.z0) * dz) / length),
          );
    const d = Math.hypot(x - (s.x0 + dx * t), z - (s.z0 + dz * t));
    if (d < distance) {
      distance = d;
      depth = s.d0 + (s.d1 - s.d0) * t;
    }
  }
  return { distance, depth };
}

/** Relief the network adds at (x, z), in tiles (negative inside). */
export function trenchReliefAt(
  strokes: readonly TrenchStroke[],
  x: number,
  z: number,
): number {
  const { distance, depth } = nearestStroke(strokes, x, z);
  return trenchProfile(distance / TRENCH_HALF_WIDTH) * depth;
}

let latest: readonly TrenchStroke[] = [];
let sink: ((strokes: readonly TrenchStroke[]) => void) | null = null;

/** The earthwork renderer publishes the strokes of every rebuild. */
export function publishTrenchStrokes(strokes: readonly TrenchStroke[]): void {
  latest = strokes;
  sink?.(strokes);
}

/** The skirmish hands the strokes to its terrain deformer; `null` detaches
 *  and forgets the last match's trenches. */
export function onTrenchStrokes(
  listener: ((strokes: readonly TrenchStroke[]) => void) | null,
): void {
  sink = listener;
  if (listener === null) latest = [];
  else listener(latest);
}
