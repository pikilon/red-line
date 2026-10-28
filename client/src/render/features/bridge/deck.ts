import type { FeatureContext, FeatureInstance } from "../layers";

/** Spec 26 section 17: where the bridge decks are and how high a walker
 *  stands on them. Shared by the bridge renderer (the model) and the unit
 *  renderers (`groundY` through `setDeckHeights`), so units walk on the deck
 *  they see. */

export interface Deck {
  /** First and last cell of the deck rectangle (inclusive, lanes included). */
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** True when the deck runs along x. */
  readonly horizontal: boolean;
  /** Tiles along the deck and across it. */
  readonly length: number;
  readonly width: number;
  /** Ground level under the deck (the lowest corner), in tiles. */
  readonly base: number;
  /** Deck surface above `base`, in tiles. */
  readonly height: number;
  /** Tiles at each end the surface climbs from the bank to the full height. */
  readonly ramp: number;
}

const DEFAULT_DECK_HEIGHT = 0.3;

/** Approach ramp length: tall decks need two tiles to stay drivable-looking. */
export const rampLength = (height: number): number => (height >= 0.45 ? 2 : 1);

export function deckOf(instance: FeatureInstance, ctx: FeatureContext): Deck {
  const x0 = instance.x;
  const y0 = instance.y;
  const x1 = x0 + instance.width - 1;
  const y1 = y0 + instance.height - 1;
  const horizontal = instance.width > instance.height;
  let base = Number.POSITIVE_INFINITY;
  for (let cy = y0; cy <= y1 + 1; cy++) {
    for (let cx = x0; cx <= x1 + 1; cx++) {
      base = Math.min(base, ctx.elevation.corner(cx, cy));
    }
  }
  const written = instance.type.render.deckHeight;
  const height = typeof written === "number" ? written : DEFAULT_DECK_HEIGHT;
  return {
    x0,
    y0,
    x1,
    y1,
    horizontal,
    length: horizontal ? instance.width : instance.height,
    width: horizontal ? instance.height : instance.width,
    base,
    height,
    ramp: rampLength(height),
  };
}

/** Absolute surface height at tile position (px, py) when it is over `deck`. */
export function deckSurface(deck: Deck, px: number, py: number): number | null {
  if (px < deck.x0 || py < deck.y0 || px >= deck.x1 + 1 || py >= deck.y1 + 1) {
    return null;
  }
  const u = deck.horizontal ? px - deck.x0 : py - deck.y0;
  const climb = Math.min(1, Math.min(u, deck.length - u) / deck.ramp);
  return deck.base + deck.height * climb;
}

/** A lookup for every deck of a map: the surface height at a tile position,
 *  or null off the decks. */
export function deckLookup(
  decks: readonly Deck[],
): (px: number, py: number) => number | null {
  return (px, py) => {
    for (const deck of decks) {
      const h = deckSurface(deck, px, py);
      if (h !== null) return h;
    }
    return null;
  };
}
