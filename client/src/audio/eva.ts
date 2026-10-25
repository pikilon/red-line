// Zero Hour EVA announcer queue (`Eva::processPlayingMessages`, Eva.cpp:395-520, spec 25 §2, §6.6).
// Only one EVA line plays at a time; queued messages expire if they wait longer than `expireMs`,
// cannot re-trigger during `cooldownMs`, and when the stream frees up, the highest-priority
// waiting message plays (strict `>` priority, FIFO on tie).

import type { EvaEventDef } from "./types";

export interface QueuedEvaMessage {
  eventId: string;
  faction: string;
  priority: number;
  triggeredAtMs: number;
  expireAtMs: number;
  cooldownMs: number;
  soundRef: string;
}

export class EvaQueue {
  private readonly defs: Record<string, EvaEventDef>;
  private readonly nowMs: () => number;
  private readonly waiting: QueuedEvaMessage[] = [];
  private readonly nextAllowedAtMs = new Map<string, number>();
  private playingUntilMs = -Infinity;
  private currentPlaying: QueuedEvaMessage | null = null;

  constructor(
    defs: Record<string, EvaEventDef>,
    nowMs: () => number = () => performance.now(),
  ) {
    this.defs = defs;
    this.nowMs = nowMs;
  }

  /**
   * Attempts to enqueue an EVA event (`Eva::setShouldPlay` / `Eva::isTimeForCheck`, Eva.cpp:430).
   * Returns `true` if queued, `false` if priority <= 0, unknown, already queued, or on cooldown.
   */
  trigger(eventId: string, faction: string): boolean {
    const def = this.defs[eventId];
    if (!def || def.priority <= 0) return false;
    const now = this.nowMs();

    // Block re-entry while already queued or currently playing this event (`Eva::isTimeForCheck`)
    if (this.waiting.some((m) => m.eventId === eventId)) return false;
    if (this.currentPlaying?.eventId === eventId && now < this.playingUntilMs)
      return false;

    const nextAllowed = this.nextAllowedAtMs.get(eventId) ?? -Infinity;
    if (now < nextAllowed) return false;

    const soundRef = def.sounds[faction] ?? def.sounds.ukraine ?? "synth:eva";
    if (!soundRef || soundRef === "NoSound") return false;

    this.waiting.push({
      eventId,
      faction,
      priority: def.priority,
      triggeredAtMs: now,
      expireAtMs: now + def.expireMs,
      cooldownMs: def.cooldownMs,
      soundRef,
    });
    return true;
  }

  /**
   * Advances the EVA queue (`Eva::processPlayingMessages`, Eva.cpp:476).
   * Drops expired waiting messages; if nothing is currently playing, pops and returns
   * the highest-priority waiting message and starts its cooldown.
   */
  process(defaultDurationMs = 1800): QueuedEvaMessage | null {
    const now = this.nowMs();
    if (this.currentPlaying && now >= this.playingUntilMs) {
      this.currentPlaying = null;
    }

    // Purge expired waiting messages (`frame >= triggeredFrame + framesToExpire`)
    for (let i = this.waiting.length - 1; i >= 0; i -= 1) {
      const item = this.waiting[i];
      if (item !== undefined && now > item.expireAtMs) {
        this.waiting.splice(i, 1);
      }
    }

    if (this.currentPlaying || this.waiting.length === 0) {
      return null;
    }

    // Select highest priority (strict `>` so FIFO wins ties, matching Eva.cpp:501)
    let bestIdx = 0;
    for (let i = 1; i < this.waiting.length; i += 1) {
      const candidate = this.waiting[i];
      const currentBest = this.waiting[bestIdx];
      if (
        candidate !== undefined &&
        currentBest !== undefined &&
        candidate.priority > currentBest.priority
      ) {
        bestIdx = i;
      }
    }

    const [chosen] = this.waiting.splice(bestIdx, 1);
    if (chosen === undefined) return null;
    this.currentPlaying = chosen;
    this.playingUntilMs = now + defaultDurationMs;
    this.nextAllowedAtMs.set(chosen.eventId, now + chosen.cooldownMs);
    return chosen;
  }

  /** Updates the remaining playback duration once the actual AudioBuffer duration is known. */
  notifyPlayingDuration(durationMs: number): void {
    if (this.currentPlaying) {
      this.playingUntilMs = this.nowMs() + Math.max(100, durationMs);
    }
  }

  isPlaying(): boolean {
    return this.currentPlaying !== null && this.nowMs() < this.playingUntilMs;
  }

  getWaitingCount(): number {
    return this.waiting.length;
  }

  reset(): void {
    this.waiting.length = 0;
    this.nextAllowedAtMs.clear();
    this.playingUntilMs = -Infinity;
    this.currentPlaying = null;
  }
}
