import type { SimCommand } from "../sim/protocol";

/** The order a left click would give on the hovered object (spec 08 §3.10). */
/** Spec 49: `attackMove` and `guard` are armed modes, not click hints. */
export type OrderHint = "garrison" | "repair" | "attackMove" | "guard";

/** Command kinds that read as a repair: bridges, buildings, vehicles. */
const REPAIR_KINDS: ReadonlySet<SimCommand["kind"]> = new Set([
  "repair",
  "repairBuilding",
  "repairVehicle",
]);

/** The hint for the first contextual order a click would issue, given the
 *  resolvers' results in click priority order. Orders without an indicator
 *  (board, heal) stop the search so a lower-priority hint never shows. */
export function orderHint(
  results: readonly (readonly SimCommand[])[],
): OrderHint | null {
  for (const commands of results) {
    const first = commands[0];
    if (first === undefined) continue;
    if (first.kind === "garrison") return "garrison";
    if (REPAIR_KINDS.has(first.kind)) return "repair";
    return null;
  }
  return null;
}

const svg = (body: string): string =>
  `url("data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${body}</svg>`,
  )}")`;

/** Garrison: a house with a down arrow, in green. */
const GARRISON_ICON = svg(
  '<path d="M4 15 16 4l12 11h-4v11H8V15z" fill="#2e9e4f" stroke="#0b2d17" stroke-width="2" stroke-linejoin="round"/><path d="M16 12v9m-4-4 4 4 4-4" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>',
);

/** Repair: a wrench, in amber. */
const REPAIR_ICON = svg(
  '<path d="M24 4a6 6 0 0 0-5.6 8.2L5 25.6 6.4 27l13.4-13.4A6 6 0 0 0 28 8l-3.6 3.6-3-1-1-3L24 4z" fill="#f2b01e" stroke="#4a3200" stroke-width="1.6" stroke-linejoin="round"/>',
);

/** Spec 49 attack move: crossed swords with a forward chevron, in red. */
const ATTACK_MOVE_ICON = svg(
  '<path d="M5 5l14 14M19 5L5 19" stroke="#0b0b0b" stroke-width="5" stroke-linecap="round"/><path d="M5 5l14 14M19 5L5 19" stroke="#e53935" stroke-width="2.5" stroke-linecap="round"/><path d="M22 10l6 6-6 6" fill="none" stroke="#e53935" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
);

/** Spec 49 guard: a shield, in blue. */
const GUARD_ICON = svg(
  '<path d="M16 3l11 4v8c0 7-5 12-11 14C10 27 5 22 5 15V7z" fill="#1e88e5" stroke="#0a2a4a" stroke-width="2" stroke-linejoin="round"/><path d="M16 9v13M10 14h12" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>',
);

/** The CSS cursor for a hint; `null` leaves the default pointer. */
export function cursorFor(hint: OrderHint | null): string {
  switch (hint) {
    case "garrison":
      return `${GARRISON_ICON} 16 16, copy`;
    case "repair":
      return `${REPAIR_ICON} 16 16, copy`;
    case "attackMove":
      return `${ATTACK_MOVE_ICON} 12 12, crosshair`;
    case "guard":
      return `${GUARD_ICON} 16 16, crosshair`;
    default:
      return "";
  }
}
