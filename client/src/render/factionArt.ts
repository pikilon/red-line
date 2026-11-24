/** Which painted texture set a type uses, keyed by the faction prefix of its
 *  id (`ua-`, `ru-`). A faction with no set of its own yet (a new army added
 *  as data) borrows the default set: never a crash, never a missing texture. */
export const ART_SETS = ["ua", "ru"] as const;
export type ArtSet = (typeof ART_SETS)[number];

/** Set used by neutral types and by factions without art of their own. */
export const FALLBACK_ART_SET: ArtSet = ART_SETS[0];

function prefixOf(typeId: string): string {
  const dash = typeId.indexOf("-");
  return dash < 0 ? "" : typeId.slice(0, dash);
}

/** Texture set of a type id: its faction prefix when it has art, else the
 *  fallback set. */
export function artSetOf(typeId: string): ArtSet {
  const prefix = prefixOf(typeId);
  return ART_SETS.find((set) => set === prefix) ?? FALLBACK_ART_SET;
}

/** Whether `typeId` belongs to a faction with art of its own. */
export function hasOwnArt(typeId: string): boolean {
  return (ART_SETS as readonly string[]).includes(prefixOf(typeId));
}
