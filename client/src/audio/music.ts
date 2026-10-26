// Zero Hour music state machine (specs/25-audio.md §10, §11).
//
// Zero Hour switches between a calm build-up track and a combat track when
// fighting starts, then falls back to calm after a quiet window. We keep that
// behaviour with a small testable director; the mixer owns the crossfade.
// Victory/defeat are terminal states for the rest of the match.

export type MusicResult = "ongoing" | "victory" | "defeat";

export interface MusicUpdate {
  faction: string;
  /** True on a snapshot that contains a detonation or a death. */
  combatActive: boolean;
  result: MusicResult;
  /** Client wall-clock time (the sim never drives audio timing). */
  nowMs: number;
}

const MENU_EVENT = "music.menu";

export class MusicDirector {
  private faction = "ukraine";
  private lastCombatAtMs = -Infinity;
  private eventId = MENU_EVENT;
  private readonly combatHoldMs: number;

  constructor(combatHoldMs: number) {
    this.combatHoldMs = combatHoldMs;
  }

  /** Faction IDs follow `data/factions/*.yaml` (`ukraine`, `russia`). */
  setFaction(faction: string): void {
    if (faction === this.faction) return;
    this.faction = faction;
    // A new side starts in its calm state, not in the previous side's combat.
    this.lastCombatAtMs = -Infinity;
  }

  update({ combatActive, result, nowMs }: MusicUpdate): string {
    if (result === "victory" || result === "defeat") {
      this.eventId = `music.${result}.${this.faction}`;
      return this.eventId;
    }
    if (combatActive) this.lastCombatAtMs = nowMs;
    const inCombat = nowMs - this.lastCombatAtMs < this.combatHoldMs;
    this.eventId = inCombat
      ? `music.combat.${this.faction}`
      : `music.calm.${this.faction}`;
    return this.eventId;
  }

  getEventId(): string {
    return this.eventId;
  }

  reset(): void {
    this.lastCombatAtMs = -Infinity;
    this.eventId = MENU_EVENT;
  }
}

/** Menu music is the state before the first match snapshot. */
export function menuMusicEvent(): string {
  return MENU_EVENT;
}
