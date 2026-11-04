/** Help cards of units and buildings (spec 48). Text lives in
 *  `client/src/i18n/help/<type-id>.json`, one file per card. */
import { RULES, typeIndex } from "../rules";

/** One thing a type can do, with the controls and screenshots that show it. */
export interface HelpSection {
  title: string;
  /** The controls that trigger it, e.g. "Select infantry, right-click the vehicle". */
  how?: string;
  body: string;
  /** Shot ids: `client/public/help/<id>.jpg`, recipes in `data/help/`. */
  shots?: string[];
  /** A launched type this section stands for (spec 48 §3.2). */
  about?: string;
}

export interface HelpCard {
  /** Type id; equals the file name. */
  id: string;
  /** One line under the name, e.g. "Infantry fighting vehicle". */
  role: string;
  summary: string;
  sections: HelpSection[];
  strong?: string[];
  weak?: string[];
  tips?: string[];
}

const FILES = import.meta.glob<{ default: HelpCard }>("../i18n/help/*.json", {
  eager: true,
});

/** Every card by type id. */
export const HELP_CARDS: ReadonlyMap<string, HelpCard> = new Map(
  Object.values(FILES).map((file) => [file.default.id, file.default]),
);

/** Where the help of a type lives: its own card, or the section of the
 *  launcher card that is `about` it. Null when there is none. */
export function helpFor(
  typeId: string,
): { card: HelpCard; section: number | null } | null {
  const own = HELP_CARDS.get(typeId);
  if (own !== undefined) return { card: own, section: null };
  for (const card of HELP_CARDS.values()) {
    const section = card.sections.findIndex((s) => s.about === typeId);
    if (section >= 0) return { card, section };
  }
  return null;
}

/** Launched drones and missiles: one-way flyers covered by their launcher's
 *  card instead of a card of their own (spec 48 §3.2). */
export function isLaunched(typeId: string): boolean {
  const def = RULES.types[typeIndex(typeId)];
  if (def === undefined || def.oneWay === undefined) return false;
  return RULES.locomotors[def.locomotor]?.kind === "air";
}

/** Types the player can build or select: every unit and building of a
 *  faction (common types are the test placeholder and supply depots). */
export function helpedTypes(): string[] {
  return RULES.types
    .filter(
      (type) =>
        type.category !== "depot" && type.id !== "tech-slice-placeholder",
    )
    .map((type) => type.id);
}

/** Public URL of a screenshot. */
export function shotUrl(shot: string): string {
  return `${import.meta.env.BASE_URL}help/${shot}.jpg`;
}
