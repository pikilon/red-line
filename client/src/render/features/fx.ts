import type { FeatureInstance } from "./layers";

/** Spec 31 block 1: fire, smoke, dust and debris of the map features, drawn
 *  in the particle pools of the vehicle effects (spec 27). Visual only: the
 *  look uses its own seeded generator and never feeds the simulation. */

/** Where map features put their particles: tiles, `z` above the ground. */
export interface FeatureParticles {
  fire(
    x: number,
    y: number,
    z: number,
    size: number,
    startMs: number,
    rise?: number,
    lifeMs?: number,
  ): void;
  smoke(
    x: number,
    y: number,
    z: number,
    size: number,
    startMs: number,
    dark: number,
    lifeMs?: number,
    alpha?: number,
  ): void;
  chunks(
    x: number,
    y: number,
    z: number,
    count: number,
    startMs: number,
    power: number,
  ): void;
}

/** What a standing feature shows: a damaged building smokes, a wrecked one
 *  burns, a collapsing one burns hard and raises dust, a tree on fire burns. */
export type FeatureBlaze = "none" | "smoke" | "fire" | "collapse" | "burning";

/** How a feature went: a building into rubble, a tree into a stump, or a
 *  small piece of decor flattened. */
export type FeatureEnd = "building" | "tree" | "decor";

/** How long rubble keeps smoking, and how long its embers glow. */
export const SMOULDER_MS = 40_000;
const EMBERS_MS = 20_000;
/** A burnt tree's stump smokes for a while. */
const STUMP_SMOKE_MS = 15_000;

/** Roof height of the civilian models, tiles (smoke leaves from the top). */
const ROOF: Readonly<Record<string, number>> = {
  "office-tower": 3.4,
  "apartment-block": 2.6,
  church: 2.4,
  factory: 1.8,
  "townhouse-row": 1.6,
  "warehouse-barn": 1.5,
  "gas-station": 0.9,
};

/** Roof height of `instance` in tiles. */
export function roofOf(instance: FeatureInstance): number {
  const given = Number(instance.type.render.height);
  if (Number.isFinite(given) && given > 0) return given;
  const model = String(instance.type.render.model ?? instance.type.id);
  return ROOF[model] ?? (instance.type.family === "vegetation" ? 1.6 : 1.2);
}

interface Source {
  instance: FeatureInstance;
  blaze: FeatureBlaze;
}

interface Smoulder {
  instance: FeatureInstance;
  startMs: number;
  /** Rubble smokes and glows; a burnt stump only smokes. */
  rubble: boolean;
}

/** Seeded generator for the look of particles. */
function generator(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export class FeatureFx {
  private readonly particles: FeatureParticles;
  private readonly sources = new Map<number, Source>();
  private readonly smoulders = new Map<number, Smoulder>();
  /** Fractional particles carried to the next frame, per emitter. */
  private readonly debt = new Map<string, number>();
  private readonly rnd = generator(0x5e31);
  private lastMs: number | null = null;

  constructor(particles: FeatureParticles) {
    this.particles = particles;
  }

  /** Sets what feature `index` shows while it stands. */
  set(index: number, instance: FeatureInstance, blaze: FeatureBlaze): void {
    if (blaze === "none") {
      this.sources.delete(index);
      return;
    }
    this.sources.set(index, { instance, blaze });
  }

  /** Feature `index` went (`instance` is how it looked): a burst of dust
   *  and debris, then smoke where it stood. */
  destroyed(
    index: number,
    instance: FeatureInstance,
    end: FeatureEnd,
    burnt: boolean,
    nowMs: number,
  ): void {
    this.sources.delete(index);
    const { x, y, w, d } = this.box(instance);
    const area = Math.sqrt(w * d);
    const between = (a: number, b: number) => a + (b - a) * this.rnd();
    const dust = end === "building" ? Math.round(22 * area) : 4;
    for (let i = 0; i < dust; i++) {
      this.particles.smoke(
        x + between(-0.5, 0.5) * w,
        y + between(-0.5, 0.5) * d,
        between(0.05, end === "building" ? 1.2 : 0.4),
        between(0.45, 0.85) * (end === "building" ? 1 : 0.6),
        nowMs + between(0, 500),
        between(0.05, 0.25),
        between(2600, 4200),
        0.75,
      );
    }
    const pieces =
      end === "building" ? Math.round(18 * area) : end === "decor" ? 6 : 0;
    if (pieces > 0) {
      this.particles.chunks(
        x,
        y,
        end === "building" ? 0.8 : 0.2,
        pieces,
        nowMs,
        end === "building" ? 1.3 : 0.7,
      );
    }
    if (end === "building" || burnt) {
      this.smoulders.set(index, {
        instance,
        startMs: nowMs,
        rubble: end === "building",
      });
    }
  }

  /** Emits this frame's particles. */
  update(nowMs: number): void {
    const dt =
      this.lastMs === null
        ? 0
        : Math.min(0.1, Math.max(0, (nowMs - this.lastMs) / 1000));
    this.lastMs = nowMs;
    if (dt === 0) return;
    for (const [index, source] of this.sources) {
      this.emitSource(index, source, nowMs, dt);
    }
    for (const [index, smoulder] of this.smoulders) {
      const age = nowMs - smoulder.startMs;
      const life = smoulder.rubble ? SMOULDER_MS : STUMP_SMOKE_MS;
      if (age >= life) {
        this.smoulders.delete(index);
        continue;
      }
      this.emitSmoulder(index, smoulder, age / life, age, nowMs, dt);
    }
    if (this.debt.size > 4096) this.debt.clear();
  }

  /** Features smoking or burning now (sources and smouldering ruins). */
  active(): number {
    return this.sources.size + this.smoulders.size;
  }

  clear(): void {
    this.sources.clear();
    this.smoulders.clear();
    this.debt.clear();
  }

  private emitSource(
    index: number,
    { instance, blaze }: Source,
    nowMs: number,
    dt: number,
  ): void {
    const { x, y, w, d } = this.box(instance);
    const area = Math.sqrt(w * d);
    const roof = roofOf(instance);
    const between = (a: number, b: number) => a + (b - a) * this.rnd();
    // Two fixed hot spots per building, so a wreck burns in its windows.
    const spot = (n: number) => {
      const a = ((index * 7 + n * 13) % 10) / 10 - 0.45;
      const b = ((index * 11 + n * 5) % 10) / 10 - 0.45;
      return { x: x + a * w * 0.8, y: y + b * d * 0.8 };
    };
    const anywhere = () => ({
      x: x + between(-0.45, 0.45) * w,
      y: y + between(-0.45, 0.45) * d,
    });
    if (blaze === "burning") {
      for (let i = this.due(`f${index}`, 14, dt); i > 0; i--) {
        const at = anywhere();
        this.particles.fire(
          at.x,
          at.y,
          between(0.2, roof * 0.85),
          between(0.5, 0.8),
          nowMs,
          1.2,
        );
      }
      for (let i = this.due(`s${index}`, 3.5, dt); i > 0; i--) {
        this.particles.smoke(x, y, roof, 0.45, nowMs, 0.9, 3800, 0.8);
      }
      return;
    }
    if (blaze === "smoke") {
      for (let i = this.due(`s${index}`, 0.9 * area, dt); i > 0; i--) {
        const at = spot(0);
        this.particles.smoke(at.x, at.y, roof, 0.3, nowMs, 0.45, 3200, 0.55);
      }
      return;
    }
    if (blaze === "fire") {
      for (let i = this.due(`f${index}`, 8 * area, dt); i > 0; i--) {
        const at = spot(i % 2);
        this.particles.fire(
          at.x,
          at.y,
          between(0.3, roof * 0.9),
          between(0.55, 0.9),
          nowMs,
          1.2,
        );
      }
      for (let i = this.due(`s${index}`, 2.2 * area, dt); i > 0; i--) {
        const at = spot(i % 2);
        this.particles.smoke(at.x, at.y, roof, 0.45, nowMs, 0.9);
      }
      return;
    }
    // Collapse: the building goes down in fire, black smoke and dust.
    for (let i = this.due(`f${index}`, 12 * area, dt); i > 0; i--) {
      const at = anywhere();
      this.particles.fire(
        at.x,
        at.y,
        between(0.2, roof),
        between(0.7, 1.1),
        nowMs,
        1.4,
      );
    }
    for (let i = this.due(`s${index}`, 4.5 * area, dt); i > 0; i--) {
      const at = anywhere();
      this.particles.smoke(at.x, at.y, roof, 0.6, nowMs, 0.95, 4200, 0.9);
    }
    for (let i = this.due(`d${index}`, 4 * area, dt); i > 0; i--) {
      const at = anywhere();
      this.particles.smoke(at.x, at.y, 0.15, 0.7, nowMs, 0.1, 2800, 0.6);
    }
    if (this.due(`c${index}`, 2, dt) > 0) {
      const at = anywhere();
      this.particles.chunks(at.x, at.y, roof * 0.7, 3, nowMs, 0.9);
    }
  }

  private emitSmoulder(
    index: number,
    { instance, rubble }: Smoulder,
    f: number,
    age: number,
    nowMs: number,
    dt: number,
  ): void {
    const { x, y, w, d } = this.box(instance);
    const area = Math.sqrt(w * d);
    const between = (a: number, b: number) => a + (b - a) * this.rnd();
    const fade = 1 - f;
    const rate = (rubble ? 3 * area : 1.2) * fade;
    for (let i = this.due(`m${index}`, rate, dt); i > 0; i--) {
      this.particles.smoke(
        x + between(-0.4, 0.4) * w,
        y + between(-0.4, 0.4) * d,
        rubble ? 0.4 : 0.3,
        rubble ? 0.4 : 0.22,
        nowMs,
        0.75,
        3600,
        0.45 + 0.35 * fade,
      );
    }
    if (rubble && age < EMBERS_MS) {
      const glow = 1 - age / EMBERS_MS;
      for (let i = this.due(`e${index}`, 6 * area * glow, dt); i > 0; i--) {
        this.particles.fire(
          x + between(-0.4, 0.4) * w,
          y + between(-0.4, 0.4) * d,
          between(0.1, 0.4),
          between(0.3, 0.6) * (0.5 + 0.5 * glow),
          nowMs,
          0.7,
          between(400, 750),
        );
      }
    }
  }

  /** Whole particles due for `key` at `perSecond` over `dt`. */
  private due(key: string, perSecond: number, dt: number): number {
    const total = (this.debt.get(key) ?? 0) + perSecond * dt;
    const whole = Math.floor(total);
    this.debt.set(key, total - whole);
    return whole;
  }

  /** Centre and size of `instance`'s footprint, tiles. */
  private box(instance: FeatureInstance): {
    x: number;
    y: number;
    w: number;
    d: number;
  } {
    return {
      x: instance.x + instance.width / 2,
      y: instance.y + instance.height / 2,
      w: instance.width,
      d: instance.height,
    };
  }
}
