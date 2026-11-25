/** Spec 59: the local player profile kept in the browser, with export and
 *  import. Campaign progress stays in its own key (spec 48) and travels in the
 *  export file. */
import { STORAGE_KEY as CAMPAIGN_KEY } from "./ui/campaign";

export const PROFILE_KEY = "redline.profile.v1";
export const PROFILE_FORMAT = "redline-profile";
export const DEFAULT_NAME = "Commander";
export const DEFAULT_COLOUR = "#3b82f6";
export const MAX_NAME_LENGTH = 20;

export interface FactionRecord {
  played: number;
  won: number;
  lost: number;
}

export interface Profile {
  name: string;
  colour: string;
  /** Finished matches per faction id; a draw only adds to `played`. */
  stats: Record<string, FactionRecord>;
}

export type MatchResult = "won" | "lost" | "draw";

type Store = Pick<Storage, "getItem" | "setItem">;

export function defaultProfile(): Profile {
  return { name: DEFAULT_NAME, colour: DEFAULT_COLOUR, stats: {} };
}

export function cleanName(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_NAME;
  const name = value.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
  return name === "" ? DEFAULT_NAME : name;
}

function cleanColour(value: unknown): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : DEFAULT_COLOUR;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

/** A profile from untrusted data: bad fields fall back to the defaults. */
export function parseProfile(raw: unknown): Profile {
  const obj =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  const stats: Record<string, FactionRecord> = {};
  const source =
    typeof obj.stats === "object" && obj.stats !== null
      ? (obj.stats as Record<string, unknown>)
      : {};
  for (const [faction, value] of Object.entries(source)) {
    if (typeof value !== "object" || value === null) continue;
    const record = value as Record<string, unknown>;
    const won = count(record.won);
    const lost = count(record.lost);
    stats[faction] = {
      played: Math.max(count(record.played), won + lost),
      won,
      lost,
    };
  }
  return { name: cleanName(obj.name), colour: cleanColour(obj.colour), stats };
}

function safeStorage(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadProfile(storage: Store | null = safeStorage()): Profile {
  try {
    const raw = storage?.getItem(PROFILE_KEY);
    return raw ? parseProfile(JSON.parse(raw)) : defaultProfile();
  } catch {
    return defaultProfile();
  }
}

export function saveProfile(
  profile: Profile,
  storage: Store | null = safeStorage(),
): void {
  try {
    storage?.setItem(PROFILE_KEY, JSON.stringify(parseProfile(profile)));
  } catch {
    // Private mode: the profile lasts for this page only.
  }
}

/** Adds a finished match to the stored statistics and returns the profile. */
export function recordMatch(
  faction: string,
  result: MatchResult,
  storage: Store | null = safeStorage(),
): Profile {
  const profile = loadProfile(storage);
  const record = profile.stats[faction] ?? { played: 0, won: 0, lost: 0 };
  profile.stats[faction] = {
    played: record.played + 1,
    won: record.won + (result === "won" ? 1 : 0),
    lost: record.lost + (result === "lost" ? 1 : 0),
  };
  saveProfile(profile, storage);
  return profile;
}

export function totals(profile: Profile): FactionRecord {
  const sum: FactionRecord = { played: 0, won: 0, lost: 0 };
  for (const record of Object.values(profile.stats)) {
    sum.played += record.played;
    sum.won += record.won;
    sum.lost += record.lost;
  }
  return sum;
}

function cleanCampaign(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof value !== "object" || value === null) return out;
  for (const [faction, won] of Object.entries(value)) {
    const n = count(won);
    if (n > 0) out[faction] = n;
  }
  return out;
}

function readCampaign(storage: Store | null): Record<string, number> {
  try {
    const raw = storage?.getItem(CAMPAIGN_KEY);
    return cleanCampaign(raw ? JSON.parse(raw) : {});
  } catch {
    return {};
  }
}

/** The export file's text: profile and campaign progress. */
export function exportProfile(storage: Store | null = safeStorage()): string {
  return JSON.stringify(
    {
      format: PROFILE_FORMAT,
      version: 1,
      profile: loadProfile(storage),
      campaign: readCampaign(storage),
    },
    null,
    2,
  );
}

/** Replaces the stored profile and campaign progress with an export file's.
 *  Returns false, changing nothing, when the text is not such a file. */
export function importProfile(
  text: string,
  storage: Store | null = safeStorage(),
): boolean {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return false;
  }
  if (typeof data !== "object" || data === null) return false;
  const file = data as Record<string, unknown>;
  if (file.format !== PROFILE_FORMAT || file.version !== 1) return false;
  if (typeof file.profile !== "object" || file.profile === null) return false;
  saveProfile(parseProfile(file.profile), storage);
  try {
    storage?.setItem(
      CAMPAIGN_KEY,
      JSON.stringify(cleanCampaign(file.campaign)),
    );
  } catch {
    // Private mode.
  }
  return true;
}
