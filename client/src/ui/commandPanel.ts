import { t } from "../i18n";
import { RULES, typeDef, typeName } from "../rules";
import type { EntityState, QueueState } from "../sim/matchSnapshot";

/** Snapshot progress is permille and a complete building is exactly full (spec §5.15). */
const PROGRESS_FULL = 1000;

/** A single construct/produce button offered by the command panel. */
export interface CommandButton {
  /** Type index of the unit/building this button constructs or produces. */
  typeIndex: number;
  /** Player-facing label, e.g. "Power plant (600)". */
  label: string;
  /** Credits required to build or produce this type. */
  cost: number;
  /** Whether the button is currently actionable (affordable, requirements met). */
  enabled: boolean;
  /** Whether the button constructs a building or produces a unit. */
  action: "construct" | "produce";
}

/** Arguments for `commandButtons` (spec §6.6). */
export interface CommandPanelArgs {
  /** Own entities currently selected. */
  selected: EntityState[];
  /** All own entities (used to check requirements and completeness). */
  ownEntities: EntityState[];
  /** Available credits. */
  credits: number;
  /** Queue of the selected production building, if any. */
  queue: QueueState | null;
}

/** Builds the construct/produce buttons for the current selection (spec §6.6). */
export function commandButtons({
  selected,
  ownEntities,
  credits,
  queue,
}: CommandPanelArgs): CommandButton[] {
  // An enemy entity in the selection gives no buttons.
  const ownIds = new Set(ownEntities.map((entity) => entity.id));
  if (selected.some((entity) => !ownIds.has(entity.id))) return [];
  if (selected.length === 0) return [];

  // A selected unit that can build: use the lowest-id one, action construct.
  let builder: EntityState | null = null;
  for (const entity of selected) {
    const def = typeDef(entity.kind);
    if (def.category !== "unit" || def.builds.length === 0) continue;
    if (builder === null || entity.id < builder.id) builder = entity;
  }
  if (builder !== null) {
    return buildButtons(
      typeDef(builder.kind).builds,
      "construct",
      credits,
      ownEntities,
    );
  }

  // Exactly one complete own building with non-empty produces: action produce.
  const producers = selected.filter((entity) => {
    const def = typeDef(entity.kind);
    return (
      def.category === "building" &&
      def.produces.length > 0 &&
      isComplete(entity)
    );
  });
  if (producers.length === 1) {
    const producer = producers[0];
    if (producer === undefined) return []; // guarded: length is exactly 1
    const queueFull = queue !== null && queue.items.length >= RULES.maxQueue;
    return buildButtons(
      typeDef(producer.kind).produces,
      "produce",
      credits,
      ownEntities,
      queueFull,
    );
  }

  return [];
}

/** Renders the buttons for `targetKinds` (construct or produce). */
function buildButtons(
  targetKinds: readonly number[],
  action: "construct" | "produce",
  credits: number,
  ownEntities: EntityState[],
  queueFull = false,
): CommandButton[] {
  return targetKinds.map((kind) => {
    const def = typeDef(kind);
    const enabled =
      credits >= def.cost &&
      requiresSatisfied(def.requires, ownEntities) &&
      (action !== "produce" || !queueFull);
    return {
      typeIndex: kind,
      label: t("ui.buttonLabel", { name: typeName(kind), cost: def.cost }),
      cost: def.cost,
      enabled,
      action,
    };
  });
}

/** True when every required kind is an own complete building in `ownEntities`. */
function requiresSatisfied(
  requires: readonly number[],
  ownEntities: EntityState[],
): boolean {
  for (const requiredKind of requires) {
    if (
      !ownEntities.some(
        (entity) => entity.kind === requiredKind && isComplete(entity),
      )
    ) {
      return false;
    }
  }
  return true;
}

/** A building is complete when its permille progress reaches the total (spec §5.15). */
function isComplete(entity: EntityState): boolean {
  return entity.progress >= PROGRESS_FULL;
}
