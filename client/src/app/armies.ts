import { RULES } from "../rules";

/** Spec 53: the armies chosen for a skirmish. */
export interface ArmyChoice {
  /** Faction id the player commands. */
  player: string;
  /** Faction id of the enemy. */
  enemy: string;
}

/** Ids of every faction in the ruleset, in ruleset order. */
export function armyIds(): string[] {
  return RULES.factions.map((faction) => faction.id);
}

/** `id` when it names a faction of the ruleset, else null. */
export function validArmy(id: unknown): string | null {
  return typeof id === "string" && armyIds().includes(id) ? id : null;
}

/** The `?army=` / `?enemy=` choice of the URL, else the saved choice, else
 *  null (the map's own factions). Both ids must be known factions. */
export function readArmies(
  params: URLSearchParams,
  saved: ArmyChoice | undefined,
): ArmyChoice | null {
  const player = validArmy(params.get("army")) ?? validArmy(saved?.player);
  const enemy = validArmy(params.get("enemy")) ?? validArmy(saved?.enemy);
  if (player === null && enemy === null) return null;
  const all = armyIds();
  const foes = enemyArmyIds();
  const foe = foes.includes(enemy ?? "") ? enemy : null;
  return {
    player: player ?? all[0] ?? "",
    enemy: foe ?? foes[1] ?? foes[0] ?? "",
  };
}

/** The faction id of each start for a player commanding start `side`. */
export function startArmies(choice: ArmyChoice | null, side: 0 | 1): string[] {
  if (choice === null) return [];
  return side === 1
    ? [choice.enemy, choice.player]
    : [choice.player, choice.enemy];
}

/** Ids of the factions an AI can command (they have a personality). */
export function enemyArmyIds(): string[] {
  return RULES.factions
    .filter((_, index) => RULES.ai.some((ai) => ai.faction === index))
    .map((faction) => faction.id);
}

/** The AI personality of `factionId`: `<faction>-<style>` (the style of
 *  `DEFAULT_AI`), falling back to the faction's first personality. */
export function personalityFor(
  factionId: string,
  style: string,
  personalities: readonly string[] = RULES.ai.map((ai) => ai.id),
): string {
  const wanted = `${factionId}-${style}`;
  if (personalities.includes(wanted)) return wanted;
  return personalities.find((id) => id.startsWith(`${factionId}-`)) ?? wanted;
}

/** The faction id owning `player`'s entities in `entities`: the faction of the
 *  first typed entity it owns, else the faction of the same index (the map's
 *  default). */
export function factionIdOfPlayer(
  entities: readonly { owner: number; kind: number }[],
  player: number,
): string {
  for (const entity of entities) {
    if (entity.owner !== player) continue;
    const index = RULES.types[entity.kind]?.faction;
    const id = index === undefined ? undefined : RULES.factions[index]?.id;
    if (id !== undefined) return id;
  }
  return RULES.factions[player]?.id ?? RULES.factions[0]?.id ?? "";
}

/** The armies a first visit to the picker shows: the map's own two. */
export function defaultArmies(): ArmyChoice {
  const all = armyIds();
  const foes = enemyArmyIds();
  return { player: all[0] ?? "", enemy: foes[1] ?? foes[0] ?? "" };
}
