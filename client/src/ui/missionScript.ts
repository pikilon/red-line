import type { MessageKey } from "../i18n";
import { typeDef } from "../rules";
import type { EntityState } from "../sim/matchSnapshot";
import { TICK_RATE_HZ } from "../sim/protocol";

/** Spec 62 §3: a condition of a mission script; every condition of a script
 *  must hold at once. Entities are indices into the mission's save. */
export type ScriptCondition =
  | { kind: "after"; ticks: number }
  /** At least `steps` of the mission's goals are done. */
  | { kind: "goal"; steps: number }
  | { kind: "destroyed"; entity: number }
  /** A unit of `side` stands inside the cell rectangle [x0, y0, x1, y1]. */
  | {
      kind: "enters";
      side: ScriptSide;
      area: readonly [number, number, number, number];
    };

export type ScriptSide = "own" | "enemy";

/** Spec 62 §3: an action of a mission script. */
export type ScriptAction =
  | { kind: "message"; text: MessageKey }
  | { kind: "dialogue"; speaker: MessageKey; text: MessageKey }
  | {
      kind: "reinforce";
      side: ScriptSide;
      type: string;
      count: number;
      at: readonly [number, number];
    }
  | { kind: "objective"; text: MessageKey; entities: readonly number[] }
  | { kind: "end"; won: boolean };

export interface MissionScript {
  id: string;
  when: readonly ScriptCondition[];
  actions: readonly ScriptAction[];
  /** Fires again every `everyTicks` while the conditions hold (spec 62 §3). */
  repeat: boolean;
  everyTicks: number;
}

/** What the mission looks like to the scripts at one tick. */
export interface ScriptView {
  tick: number;
  /** The player the mission controls; the enemy is the other one. */
  player: number;
  entities: readonly EntityState[];
  /** How many goals of the mission are done. */
  goalsDone: number;
  dead(index: number): boolean;
}

/** One script action that fired, for the panel to carry out. */
export type ScriptEffect = ScriptAction;

/** The raw form of a script in `data/generated/mission-scripts.json`. */
export interface RawScript {
  id: string;
  when: readonly Record<string, unknown>[];
  do: readonly Record<string, unknown>[];
  repeat?: boolean;
  every?: number;
}

const seconds = (value: number): number => Math.round(value * TICK_RATE_HZ);

/** Resolves the raw scripts of a mission: labels become save indices and text
 *  keys get the mission's prefix `k` (spec 62 §2). */
export function resolveScripts(
  raw: readonly RawScript[],
  k: string,
  index: (label: string) => number,
): MissionScript[] {
  const key = (suffix: unknown) =>
    `${k}.script.${String(suffix)}` as MessageKey;
  return raw.map((script) => ({
    id: script.id,
    repeat: script.repeat ?? false,
    everyTicks: seconds(script.every ?? 1),
    when: script.when.map((c): ScriptCondition => {
      if ("after" in c)
        return { kind: "after", ticks: seconds(c.after as number) };
      if ("goal" in c) return { kind: "goal", steps: c.goal as number };
      if ("destroyed" in c)
        return { kind: "destroyed", entity: index(c.destroyed as string) };
      const e = c.enters as {
        side: ScriptSide;
        area: [number, number, number, number];
      };
      return { kind: "enters", side: e.side, area: e.area };
    }),
    actions: script.do.map((a): ScriptAction => {
      if ("message" in a) return { kind: "message", text: key(a.message) };
      if ("dialogue" in a)
        return {
          kind: "dialogue",
          speaker: key(`${String(a.dialogue)}.speaker`),
          text: key(`${String(a.dialogue)}.text`),
        };
      if ("reinforce" in a) {
        const r = a.reinforce as {
          side: ScriptSide;
          type: string;
          count: number;
          at: [number, number];
        };
        return { kind: "reinforce", ...r };
      }
      if ("objective" in a) {
        const o = a.objective as { text: string; destroy?: string[] };
        return {
          kind: "objective",
          text: key(o.text),
          entities: (o.destroy ?? []).map(index),
        };
      }
      return { kind: "end", won: "victory" in a };
    }),
  }));
}

/** Whether a unit of `side` stands in `area` (cells, inclusive). */
function enters(
  condition: Extract<ScriptCondition, { kind: "enters" }>,
  view: ScriptView,
): boolean {
  const owner = condition.side === "own" ? view.player : 1 - view.player;
  const [x0, y0, x1, y1] = condition.area;
  return view.entities.some((entity) => {
    if (entity.owner !== owner) return false;
    if (typeDef(entity.kind).category !== "unit") return false;
    const x = Math.floor(entity.x);
    const y = Math.floor(entity.y);
    return x >= x0 && x <= x1 && y >= y0 && y <= y1;
  });
}

function holds(condition: ScriptCondition, view: ScriptView): boolean {
  switch (condition.kind) {
    case "after":
      return view.tick >= condition.ticks;
    case "goal":
      return view.goalsDone >= condition.steps;
    case "destroyed":
      return view.dead(condition.entity);
    case "enters":
      return enters(condition, view);
  }
}

/** Evaluates scripts in list order (spec 62 §2): a one-shot script is done
 *  after its actions fire, a repeating one is checked again every
 *  `everyTicks`. The runner holds no clock of its own: its output is a pure
 *  function of the views it is given. */
export function createScriptRunner(scripts: readonly MissionScript[]): {
  update(view: ScriptView): ScriptEffect[];
  /** Save indices the pending scripts wait on, for the panel to poll. */
  watched(): number[];
} {
  const fired = new Set<string>();
  const nextCheck = new Map<string, number>();
  return {
    update(view) {
      const effects: ScriptEffect[] = [];
      for (const script of scripts) {
        if (!script.repeat && fired.has(script.id)) continue;
        if (view.tick < (nextCheck.get(script.id) ?? 0)) continue;
        if (!script.when.every((c) => holds(c, view))) continue;
        fired.add(script.id);
        if (script.repeat)
          nextCheck.set(script.id, view.tick + script.everyTicks);
        effects.push(...script.actions);
      }
      return effects;
    },
    watched() {
      const indices = new Set<number>();
      for (const script of scripts) {
        if (!script.repeat && fired.has(script.id)) continue;
        for (const c of script.when)
          if (c.kind === "destroyed") indices.add(c.entity);
      }
      return [...indices];
    },
  };
}
