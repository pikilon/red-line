import { type MessageKey, t } from "../i18n";
import { RULES, typeDef, typeIndex, typeName } from "../rules";
import { ENTITY_FLAGS, type EntityState } from "../sim/matchSnapshot";
import { appendDiv } from "./dom";

/** One objective of a tutorial (spec 46 §3), like a Zero Hour one-shot
 *  script: `own` = BUILT_BY_PLAYER, `clear` = every enemy destroyed. */
export type TutorialGoal =
  | { kind: "own"; type: string; count: number }
  | { kind: "clear" };

export interface TutorialMission {
  /** The example save the mission starts from (`?load=<id>`, spec 19). */
  id: string;
  faction: "ukraine" | "russia";
  title: MessageKey;
  goals: readonly TutorialGoal[];
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
  const own = (type: string, count = 1): TutorialGoal => ({
    kind: "own",
    type,
    count,
  });
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
      goals: [own(`${p}-rifleman`, 3), own(roster.antiTank), { kind: "clear" }],
    },
    {
      id: `tutorial-${p}-armor`,
      faction,
      title: "tutorial.armor",
      goals: [own(roster.scout), own(roster.tank), { kind: "clear" }],
    },
  ];
}

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
  entities: readonly EntityState[];
  player: number;
  /** Enemies seen and not seen destroyed; null before any enemy is seen. */
  enemiesLeft: number | null;
}

/** Whether `goal` holds in `view`. */
export function goalMet(goal: TutorialGoal, view: TutorialView): boolean {
  if (goal.kind === "clear") return view.enemiesLeft === 0;
  const kind = typeIndex(goal.type);
  let count = 0;
  for (const entity of view.entities) {
    if (entity.owner !== view.player || entity.kind !== kind) continue;
    if ((entity.flags & ENTITY_FLAGS.underConstruction) !== 0) continue;
    count++;
  }
  return count >= goal.count;
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
    goalMet(mission.goals[step] as TutorialGoal, view)
  ) {
    step++;
  }
  return step;
}

/** Counts the enemies of `player` under fog of war: one that leaves the
 *  snapshot while its last tile is in sight was destroyed; one that leaves
 *  into the fog is still alive (spec 46 §3). */
export function createEnemyTracker(): {
  update(
    entities: readonly EntityState[],
    player: number,
    inSight: (x: number, y: number) => boolean,
  ): number | null;
} {
  const known = new Map<number, { x: number; y: number }>();
  let seen = false;
  return {
    update(entities, player, inSight) {
      const present = new Set<number>();
      for (const entity of entities) {
        if (entity.owner !== 1 - player) continue;
        present.add(entity.id);
        known.set(entity.id, { x: entity.x, y: entity.y });
        seen = true;
      }
      for (const [id, at] of known) {
        if (!present.has(id) && inSight(at.x, at.y)) known.delete(id);
      }
      return seen ? known.size : null;
    },
  };
}

/** The objective line of `goal`. */
function goalText(goal: TutorialGoal): string {
  if (goal.kind === "clear") return t("tutorial.goal.clear");
  const kind = typeIndex(goal.type);
  const name = typeName(kind);
  const building = typeDef(kind).category === "building";
  if (building) return t("tutorial.goal.build", { name });
  return t("tutorial.goal.train", { name, count: goal.count });
}

/** How to reach `goal`. */
function hintText(goal: TutorialGoal, mission: TutorialMission): string {
  if (goal.kind === "clear") {
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
  /** Opens `mission`. */
  play(mission: TutorialMission): void;
  /** Back to the main menu. */
  menu(): void;
}

/** `#tutorial`: the objective list of `mission` and, once every step is
 *  done, the mission-complete panel (spec 46 §4). */
export function createTutorialPanel(
  root: HTMLElement,
  mission: TutorialMission,
  actions: TutorialActions,
): {
  update(
    entities: readonly EntityState[],
    player: number,
    inSight: (x: number, y: number) => boolean,
  ): void;
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
  const enemies = createEnemyTracker();

  function complete(): void {
    hint.textContent = t("tutorial.complete");
    const next = nextTutorial(mission);
    const buttons: [MessageKey, () => void][] = [
      ...(next === null
        ? []
        : [
            ["tutorial.next", () => actions.play(next)] as [
              MessageKey,
              () => void,
            ],
          ]),
      ["tutorial.menu", actions.menu],
    ];
    for (const [key, action] of buttons) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = t(key);
      button.addEventListener("click", action);
      element.appendChild(button);
    }
    element.classList.add("complete");
  }

  return {
    update(entities, player, inSight) {
      const enemiesLeft = enemies.update(entities, player, inSight);
      const view = { entities, player, enemiesLeft };
      const step = advance(mission, Math.max(done, 0), view);
      if (step === done) return;
      done = step;
      items.forEach((item, index) => {
        item.className =
          index < step ? "done" : index === step ? "current" : "";
      });
      const goal = mission.goals[step];
      if (goal === undefined) complete();
      else hint.textContent = hintText(goal, mission);
    },
  };
}
