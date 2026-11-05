import { type MessageKey, t } from "../i18n";
import { RULES, typeDef, typeIndex, typeName } from "../rules";
import {
  ENTITY_FLAGS,
  type EntityState,
  type MatchSnapshot,
} from "../sim/matchSnapshot";
import { type SimCommand, TICK_RATE_HZ } from "../sim/protocol";
import { appendDiv } from "./dom";

/** One objective of a tutorial (spec 46 §3), like a Zero Hour one-shot
 *  script: `own` is BUILT_BY_PLAYER, `destroy` holds once every listed
 *  entity is dead. Entities are indices into the mission's save, whose first
 *  entity is the player's HQ: the sim numbers them in order after the map's
 *  depots. `hint` replaces the generic hint of its kind. */
export type TutorialGoal = (
  | { kind: "own"; type: string; count: number }
  | { kind: "destroy"; entities: readonly number[]; text: MessageKey }
  /** Holds once `ticks` passed since it became the current step, like a
   *  Zero Hour timer script (spec 48 §3). */
  | { kind: "survive"; ticks: number; text: MessageKey }
  /** Holds once the sim names the player the winner: every enemy building
   *  is gone (spec 48 §3). */
  | { kind: "victory" }
) & { hint?: MessageKey };

/** Enemy units the mission sends at the player once `after` steps are done,
 *  like a Zero Hour script ordering a team to attack (spec 46 §3). */
export interface TutorialWave {
  after: number;
  units: readonly number[];
  target: number;
}

/** Ticks between two attack orders to a tutorial wave. */
const REORDER_TICKS = 450;

export interface TutorialMission {
  /** The example save the mission starts from (`?load=<id>`, spec 19). */
  id: string;
  faction: "ukraine" | "russia";
  title: MessageKey;
  goals: readonly TutorialGoal[];
  wave?: TutorialWave;
}

function own(type: string, count = 1, hint?: MessageKey): TutorialGoal {
  return { kind: "own", type, count, ...(hint === undefined ? {} : { hint }) };
}

/** Every enemy of the save: `entities` are its indices. */
function clear(entities: readonly number[], hint?: MessageKey): TutorialGoal {
  return {
    kind: "destroy",
    entities,
    text: "tutorial.goal.clear",
    ...(hint === undefined ? {} : { hint }),
  };
}

/** Type ids of one army used by its missions. */
interface Roster {
  prefix: "ua" | "ru";
  antiTank: string;
  scout: string;
  tank: string;
}

const ROSTERS: readonly Roster[] = [
  {
    prefix: "ua",
    antiTank: "ua-stugna-team",
    scout: "ua-kozak-scout",
    tank: "ua-leopard-2a4",
  },
  {
    prefix: "ru",
    antiTank: "ru-rpg-gunner",
    scout: "ru-brdm-scout",
    tank: "ru-t-72b3",
  },
];

function missions(roster: Roster): TutorialMission[] {
  const { prefix: p } = roster;
  const faction = p === "ua" ? "ukraine" : "russia";
  return [
    {
      id: `tutorial-${p}-base`,
      faction,
      title: "tutorial.base",
      goals: [
        own(`${p}-power-plant`),
        own(`${p}-supply-center`),
        own(`${p}-barracks`),
      ],
    },
    {
      id: `tutorial-${p}-infantry`,
      faction,
      title: "tutorial.infantry",
      // The patrol: save entities 4..=6.
      goals: [own(`${p}-rifleman`, 3), own(roster.antiTank), clear([4, 5, 6])],
    },
    {
      id: `tutorial-${p}-armor`,
      faction,
      title: "tutorial.armor",
      // The outpost: save entities 5..=7.
      goals: [own(roster.scout), own(roster.tank), clear([5, 6, 7])],
    },
    ...(p === "ua" ? UKRAINE_AIR : RUSSIA_AIR),
  ];
}

/** Spec 46 §3: the air war is asymmetric, so each army's drone and air
 *  defense missions are written out. */
const UKRAINE_AIR: readonly TutorialMission[] = [
  {
    id: "tutorial-ua-drones",
    faction: "ukraine",
    title: "tutorial.drones",
    goals: [
      own("ua-fpv-team", 1, "tutorial.hint.uaFpv"),
      own("ua-baba-yaga", 1, "tutorial.hint.uaBabaYaga"),
      // A T-72 and two riflemen: save entities 5..=7.
      clear([5, 6, 7], "tutorial.hint.uaDroneStrike"),
    ],
  },
  {
    id: "tutorial-ua-air-defense",
    faction: "ukraine",
    title: "tutorial.airDefense",
    goals: [
      own("ua-sting-nest", 1, "tutorial.hint.uaSting"),
      own("ua-gepard", 1, "tutorial.hint.uaGepard"),
      {
        kind: "destroy",
        entities: [5, 6, 7, 8],
        text: "tutorial.goal.shootDown",
        hint: "tutorial.hint.uaShootDown",
      },
    ],
    // Four Geran-2 (save entities 5..=8) at the power plant (1).
    wave: { after: 2, units: [5, 6, 7, 8], target: 1 },
  },
];

const RUSSIA_AIR: readonly TutorialMission[] = [
  {
    id: "tutorial-ru-drones",
    faction: "russia",
    title: "tutorial.drones",
    goals: [
      own("ru-molniya-crew", 1, "tutorial.hint.ruMolniya"),
      own("ru-geran-2", 2, "tutorial.hint.ruGeran"),
      // A power plant, a scout car and a rifleman: save entities 6..=8.
      clear([6, 7, 8], "tutorial.hint.ruDroneStrike"),
    ],
  },
  {
    id: "tutorial-ru-air-defense",
    faction: "russia",
    title: "tutorial.airDefense",
    goals: [
      own("ru-pantsir", 1, "tutorial.hint.ruPantsir"),
      own("ru-pole-21", 1, "tutorial.hint.ruPole"),
      {
        kind: "destroy",
        entities: [8, 9, 10, 11],
        text: "tutorial.goal.shootDown",
        hint: "tutorial.hint.ruShootDown",
      },
    ],
    // Two Baba Yagas and two TW-12.7 (save entities 8..=11) at the power
    // plant (1).
    wave: { after: 2, units: [8, 9, 10, 11], target: 1 },
  },
];

/** Every tutorial, in menu order: Ukraine's, then Russia's (spec 46 §2). */
export const TUTORIALS: readonly TutorialMission[] = ROSTERS.flatMap(missions);

export function findTutorial(id: string | null): TutorialMission | null {
  return TUTORIALS.find((mission) => mission.id === id) ?? null;
}

/** The mission after `mission` for the same army, or null for the last. */
export function nextTutorial(mission: TutorialMission): TutorialMission | null {
  const next = TUTORIALS[TUTORIALS.indexOf(mission) + 1];
  return next?.faction === mission.faction ? next : null;
}

/** What the tutorial knows of the match each snapshot. */
export interface TutorialView {
  /** How many entities of `kind` the player has finished so far, alive or
   *  not (Zero Hour's BUILT_BY_PLAYER). */
  built(kind: number): number;
  /** Whether save entity `index` is dead; false until the sim answered. */
  dead(index: number): boolean;
  /** Whether step `step` has been current for `ticks` ticks; the first call
   *  for a step starts its clock. Absent: never. */
  held?(step: number, ticks: number): boolean;
  /** Whether the sim named the player the winner. Absent: never. */
  won?(): boolean;
}

/** Whether `goal` holds in `view`. */
export function goalMet(
  goal: TutorialGoal,
  view: TutorialView,
  step = 0,
): boolean {
  switch (goal.kind) {
    case "destroy":
      return goal.entities.every(view.dead);
    case "survive":
      return view.held?.(step, goal.ticks) ?? false;
    case "victory":
      return view.won?.() ?? false;
    case "own":
      return view.built(typeIndex(goal.type)) >= goal.count;
  }
}

/** Records every finished entity of `player` by type (BUILT_BY_PLAYER). */
export function createBuiltTracker(): {
  update(entities: readonly EntityState[], player: number): void;
  built(kind: number): number;
} {
  const ids = new Map<number, Set<number>>();
  return {
    update(entities, player) {
      for (const entity of entities) {
        if (entity.owner !== player) continue;
        if ((entity.flags & ENTITY_FLAGS.underConstruction) !== 0) continue;
        let set = ids.get(entity.kind);
        if (set === undefined) {
          set = new Set();
          ids.set(entity.kind, set);
        }
        set.add(entity.id);
      }
    },
    built: (kind) => ids.get(kind)?.size ?? 0,
  };
}

/** Steps done so far: like one-shot scripts, a step only counts once every
 *  earlier one is done and stays done (spec 46 §3). */
export function advance(
  mission: TutorialMission,
  done: number,
  view: TutorialView,
): number {
  let step = done;
  while (
    step < mission.goals.length &&
    goalMet(mission.goals[step] as TutorialGoal, view, step)
  ) {
    step++;
  }
  return step;
}

/** `ticks` as m:ss. */
function clock(ticks: number): string {
  const seconds = Math.ceil(ticks / TICK_RATE_HZ);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The objective line of `goal`. */
export function goalText(goal: TutorialGoal): string {
  if (goal.kind === "destroy") return t(goal.text);
  if (goal.kind === "survive") return t(goal.text, { time: clock(goal.ticks) });
  if (goal.kind === "victory") return t("campaign.goal.victory");
  const kind = typeIndex(goal.type);
  const name = typeName(kind);
  const building = typeDef(kind).category === "building";
  if (building) return t("tutorial.goal.build", { name });
  return t("tutorial.goal.train", { name, count: goal.count });
}

/** How to reach `goal`. */
function hintText(goal: TutorialGoal, mission: TutorialMission): string {
  if (goal.hint !== undefined) return t(goal.hint);
  if (goal.kind === "survive") return t("campaign.hint.survive");
  if (goal.kind === "victory") return t("campaign.hint.victory");
  if (goal.kind === "destroy") {
    // Ukraine starts in the west of first-line, Russia in the east.
    const east = mission.faction === "ukraine";
    const direction = t(east ? "tutorial.east" : "tutorial.west");
    return t("tutorial.hint.clear", { direction });
  }
  const kind = typeIndex(goal.type);
  if (typeDef(kind).category === "building") return t("tutorial.hint.build");
  const producer = RULES.types.findIndex((type) =>
    type.produces.includes(kind),
  );
  return t("tutorial.hint.train", { producer: typeName(producer) });
}

export interface TutorialActions {
  /** What comes after `mission` is won: null for nothing (spec 48 §4). */
  next(mission: TutorialMission): { label: MessageKey; go(): void } | null;
  /** Called once when every step is done or the player wins (spec 48 §4). */
  won?(mission: TutorialMission): void;
  /** Restarts the mission after a defeat (spec 48 §4). */
  retry?(): void;
  /** Back to the main menu. */
  menu(): void;
  /** Issues a command to the sim, as a mission script would. */
  command(command: SimCommand): void;
  /** Which entity ids are alive, regardless of fog, as a script knows. */
  alive(ids: readonly number[]): Promise<boolean[]>;
}

/** `#tutorial`: the objective list of `mission` and, once every step is
 *  done, the mission-complete panel (spec 46 §4). */
export function createTutorialPanel(
  root: HTMLElement,
  mission: TutorialMission,
  actions: TutorialActions,
): {
  update(snapshot: MatchSnapshot, player: number): void;
} {
  const element = appendDiv(root, "tutorial");
  const title = document.createElement("h2");
  title.textContent = t(mission.title);
  const list = document.createElement("ol");
  const items = mission.goals.map((goal) => {
    const item = document.createElement("li");
    item.textContent = goalText(goal);
    list.appendChild(item);
    return item;
  });
  const hint = document.createElement("p");
  hint.id = "tutorial-hint";
  element.append(title, list, hint);
  let done = -1;
  /** Tick of the last attack order given to the wave; null before it. */
  let waveOrderedAt: number | null = null;
  /** Save indices the sim last reported dead, and whether it is asked. */
  const dead = new Set<number>();
  let asking = false;
  /** Entity id of the save's first entity, the player's HQ. */
  let firstId: number | null = null;
  const built = createBuiltTracker();
  /** Tick each survive step became current, and the latest tick seen. */
  const stepStarts = new Map<number, number>();
  let tick = 0;
  let winner = false;
  const view: TutorialView = {
    built: built.built,
    dead: (index) => dead.has(index),
    held: (step, ticks) => {
      const start = stepStarts.get(step) ?? tick;
      stepStarts.set(step, start);
      return tick - start >= ticks;
    },
    won: () => winner,
  };

  /** Asks the sim which entities of the current `destroy` goal live. */
  function poll(goal: TutorialGoal | undefined, base: number): void {
    if (goal?.kind !== "destroy" || asking) return;
    asking = true;
    const indices = goal.entities;
    void actions.alive(indices.map((index) => base + index)).then((alive) => {
      asking = false;
      indices.forEach((index, i) => {
        if (alive[i] === false) dead.add(index);
      });
    });
  }

  /** Orders the wave at its target, again every `REORDER_TICKS`: a bomber
   *  that went home to reload comes back. It goes for the HQ once the first
   *  target is gone. */
  function orderWave(
    wave: TutorialWave,
    snapshot: MatchSnapshot,
    player: number,
    base: number,
  ): void {
    if (waveOrderedAt !== null && snapshot.tick < waveOrderedAt + REORDER_TICKS)
      return;
    waveOrderedAt = snapshot.tick;
    const target = [base + wave.target, base].find((id) =>
      snapshot.entities.some((entity) => entity.id === id),
    );
    const units = wave.units
      .filter((index) => !dead.has(index))
      .map((index) => base + index);
    if (target === undefined || units.length === 0) return;
    actions.command({ kind: "attack", player: 1 - player, units, target });
  }

  /** Ends the mission: won shows what comes next, lost offers a retry. */
  function finish(won: boolean): void {
    finished = true;
    if (won) actions.won?.(mission);
    hint.textContent = t(won ? "tutorial.complete" : "campaign.failed");
    const next = won ? actions.next(mission) : null;
    const buttons: [MessageKey, () => void][] = [];
    if (next !== null) buttons.push([next.label, next.go]);
    if (!won && actions.retry !== undefined)
      buttons.push(["campaign.retry", actions.retry]);
    buttons.push(["tutorial.menu", actions.menu]);
    for (const [key, action] of buttons) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = t(key);
      button.addEventListener("click", action);
      element.appendChild(button);
    }
    element.classList.add("complete");
  }

  let finished = false;

  return {
    update(snapshot, player) {
      if (finished) return;
      tick = snapshot.tick;
      if (snapshot.outcome !== "ongoing") {
        winner = snapshot.outcome === "winner" && snapshot.winner === player;
        // Spec 48 §4: the sim's victory wins the mission, its defeat loses it.
        if (!winner) {
          finish(false);
          return;
        }
      }
      built.update(snapshot.entities, player);
      for (const entity of snapshot.entities) {
        if (entity.owner !== player) continue;
        firstId = Math.min(firstId ?? entity.id, entity.id);
      }
      if (firstId === null) return;
      const step = advance(mission, Math.max(done, 0), view);
      const { wave } = mission;
      if (wave !== undefined && step >= wave.after) {
        orderWave(wave, snapshot, player, firstId);
      }
      poll(mission.goals[step], firstId);
      if (winner) {
        for (const item of items) item.className = "done";
        finish(true);
        return;
      }
      const current = mission.goals[step];
      if (current?.kind === "survive") {
        // Spec 48 §4: a survive step counts down in its line.
        const start = stepStarts.get(step) ?? tick;
        const left = Math.max(0, current.ticks - (tick - start));
        const item = items[step];
        if (item !== undefined)
          item.textContent = t(current.text, { time: clock(left) });
      }
      if (step === done) return;
      done = step;
      items.forEach((item, index) => {
        item.className =
          index < step ? "done" : index === step ? "current" : "";
      });
      const goal = mission.goals[step];
      if (goal === undefined) finish(true);
      else hint.textContent = hintText(goal, mission);
    },
  };
}
