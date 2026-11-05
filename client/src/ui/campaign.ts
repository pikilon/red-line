import type { MessageKey } from "../i18n";
import { TICK_RATE_HZ } from "../sim/protocol";
import type { TutorialGoal, TutorialMission } from "./tutorial";

/** One campaign mission (spec 48 §3): a tutorial mission (objectives over an
 *  example save) with the movie that plays before it and its briefing. */
export interface CampaignMission extends TutorialMission {
  /** 1-based place in its campaign. */
  number: number;
  /** Date and place line. */
  when: MessageKey;
  /** Description of the movie shown before the mission (spec 48 §4). */
  video: MessageKey;
  briefing: MessageKey;
}

export type CampaignFaction = "ukraine" | "russia";

export interface Campaign {
  faction: CampaignFaction;
  /** The campaign's aim, shown on its menu page. */
  aim: MessageKey;
  missions: readonly CampaignMission[];
  /** Description of the movie shown after the last mission. */
  ending: MessageKey;
}

/** Labels of every campaign save, by save id: destroy goals name entities by
 *  label and the mission resolves them to save indices (spec 46 §3). */
const SAVES = import.meta.glob<{
  setup: { entities: readonly { label?: string }[] };
}>("../../../data/generated/saves/campaign-*.json", {
  eager: true,
  import: "default",
});

/** Save index of `label` in save `id`; throws when missing so a test fails. */
export function labelIndex(id: string, label: string): number {
  const save = SAVES[`../../../data/generated/saves/${id}.json`];
  const index =
    save?.setup.entities.findIndex((entity) => entity.label === label) ?? -1;
  if (index < 0) throw new Error(`campaign save ${id} has no label ${label}`);
  return index;
}

const minutes = (value: number): number =>
  Math.round(value * 60 * TICK_RATE_HZ);

/** Goal builders; `k` is the mission's i18n prefix. */
type Goals = {
  own(type: string, count?: number, hint?: string): TutorialGoal;
  destroy(labels: readonly string[], text: string, hint?: string): TutorialGoal;
  survive(min: number, text: string, hint?: string): TutorialGoal;
  victory(hint?: string): TutorialGoal;
};

function goalsOf(id: string, k: string): Goals {
  const key = (name: string) => `${k}.${name}` as MessageKey;
  const hint = (name?: string) =>
    name === undefined ? {} : { hint: key(name) };
  return {
    own: (type, count = 1, h) => ({ kind: "own", type, count, ...hint(h) }),
    destroy: (labels, text, h) => ({
      kind: "destroy",
      entities: labels.map((label) => labelIndex(id, label)),
      text: key(text),
      ...hint(h),
    }),
    survive: (min, text, h) => ({
      kind: "survive",
      ticks: minutes(min),
      text: key(text),
      ...hint(h),
    }),
    victory: (h) => ({ kind: "victory", ...hint(h) }),
  };
}

/** Builds mission `number` of `faction` on save `campaign-<p>-<nn>-<slug>`. */
function mission(
  faction: CampaignFaction,
  number: number,
  slug: string,
  goals: (g: Goals) => TutorialGoal[],
): CampaignMission {
  const p = faction === "ukraine" ? "ua" : "ru";
  const nn = String(number).padStart(2, "0");
  const id = `campaign-${p}-${nn}-${slug}`;
  const k = `campaign.${p}.${nn}`;
  return {
    id,
    faction,
    number,
    title: `${k}.title` as MessageKey,
    when: `${k}.when` as MessageKey,
    video: `${k}.video` as MessageKey,
    briefing: `${k}.briefing` as MessageKey,
    goals: goals(goalsOf(id, k)),
  };
}

const ua = (n: number, slug: string, goals: (g: Goals) => TutorialGoal[]) =>
  mission("ukraine", n, slug, goals);
const ru = (n: number, slug: string, goals: (g: Goals) => TutorialGoal[]) =>
  mission("russia", n, slug, goals);

/** Spec 48 §3: Ukraine's campaign, from Hostomel to the Kremlin bunker. */
const UKRAINE: readonly CampaignMission[] = [
  ua(1, "hostomel", (g) => [
    g.survive(4, "goal.hold", "hint.hold"),
    g.destroy(["lz", "lz-barracks"], "goal.lz", "hint.lz"),
    g.victory(),
  ]),
  ua(2, "irpin", (g) => [
    g.own("ua-fpv-team", 2, "hint.fpv"),
    g.destroy(
      ["convoy1", "convoy2", "convoy3", "convoy4"],
      "goal.convoy",
      "hint.convoy",
    ),
    g.victory(),
  ]),
  ua(3, "moskva", (g) => [
    g.own("ua-missile-site", 1, "hint.site"),
    g.destroy(["radar1", "radar2"], "goal.radars", "hint.radars"),
    g.destroy(["moskva"], "goal.moskva", "hint.moskva"),
    g.victory(),
  ]),
  ua(4, "snake-island", (g) => [
    g.own("ua-himars", 2, "hint.himars"),
    g.destroy(["tor1", "tor2"], "goal.airDefense", "hint.airDefense"),
    g.victory("hint.victory"),
  ]),
  ua(5, "kharkiv", (g) => [
    g.destroy(["balakliia"], "goal.balakliia", "hint.balakliia"),
    g.destroy(["izium"], "goal.izium"),
    g.destroy(["kupiansk"], "goal.kupiansk"),
    g.victory(),
  ]),
  ua(6, "nord-stream", (g) => [
    g.destroy(["line1", "line2", "line3"], "goal.lines", "hint.lines"),
    g.survive(1, "goal.exfil", "hint.exfil"),
  ]),
  ua(7, "kursk", (g) => [
    g.destroy(["post1", "post2", "post3"], "goal.border", "hint.border"),
    g.destroy(["sudzha", "sudzha-garrison"], "goal.sudzha", "hint.sudzha"),
    g.survive(3, "goal.hold", "hint.hold"),
  ]),
  ua(8, "spiderweb", (g) => [
    g.destroy(
      ["bomber-n1", "bomber-n2", "bomber-s1", "bomber-s2"],
      "goal.bombers",
      "hint.bombers",
    ),
    g.destroy(["olenya", "belaya"], "goal.airfields", "hint.airfields"),
  ]),
  ua(9, "long-arm", (g) => [
    g.own("ua-missile-site", 1, "hint.site"),
    g.destroy(
      ["refinery1", "refinery2", "refinery3"],
      "goal.refineries",
      "hint.refineries",
    ),
    g.destroy(
      ["warehouse1", "warehouse2"],
      "goal.warehouses",
      "hint.warehouses",
    ),
    g.victory(),
  ]),
  ua(10, "moscow", (g) => [
    g.destroy(["shield1", "shield2", "shield3"], "goal.shield", "hint.shield"),
    g.destroy(["kremlin"], "goal.bunker", "hint.bunker"),
    g.victory(),
  ]),
];

/** Spec 48 §3: Russia's campaign, from Hostomel to the Narva. */
const RUSSIA: readonly CampaignMission[] = [
  ru(1, "hostomel", (g) => [
    g.destroy(["tower1", "tower2", "hangar"], "goal.airport", "hint.airport"),
    g.survive(3, "goal.hold", "hint.hold"),
    g.victory(),
  ]),
  ru(2, "snake-island", (g) => [
    g.destroy(["guard1", "guard2"], "goal.guards", "hint.guards"),
    g.destroy(["zmiinyi"], "goal.post"),
    g.victory(),
  ]),
  ru(3, "mariupol", (g) => [
    g.own("ru-tos-1a", 1, "hint.tos"),
    g.destroy(["bunker1", "bunker2"], "goal.bunkers", "hint.bunkers"),
    g.destroy(["azovstal", "command"], "goal.azovstal", "hint.azovstal"),
    g.victory(),
  ]),
  ru(4, "bakhmut", (g) => [
    g.own("ru-rifleman", 12, "hint.wagner"),
    g.destroy(
      ["strongpoint1", "strongpoint2", "strongpoint3"],
      "goal.strongpoints",
      "hint.strongpoints",
    ),
    g.destroy(["artemivsk"], "goal.town"),
    g.victory(),
  ]),
  ru(5, "surovikin-line", (g) => [
    g.survive(5, "goal.hold", "hint.hold"),
    g.destroy(
      [
        "leopard1",
        "leopard2",
        "leopard3",
        "leopard4",
        "bradley1",
        "bradley2",
        "bradley3",
        "bradley4",
      ],
      "goal.spearhead",
      "hint.spearhead",
    ),
  ]),
  ru(6, "avdiivka", (g) => [
    g.own("ru-su-34", 2, "hint.su34"),
    g.destroy(["koksokhim"], "goal.koksokhim", "hint.koksokhim"),
    g.destroy(["zenit"], "goal.zenit"),
    g.victory(),
  ]),
  ru(7, "kursk-pipe", (g) => [
    g.destroy(["trench1", "trench2"], "goal.trenches", "hint.trenches"),
    g.destroy(["sudzha"], "goal.sudzha", "hint.sudzha"),
    g.survive(2, "goal.hold", "hint.hold"),
  ]),
  ru(8, "oreshnik", (g) => [
    g.own("ru-geran-2", 6, "hint.gerans"),
    g.destroy(["patriot1", "patriot2"], "goal.patriots", "hint.patriots"),
    g.destroy(["yuzhmash"], "goal.yuzhmash", "hint.yuzhmash"),
    g.victory(),
  ]),
  ru(9, "kyiv", (g) => [
    g.destroy(["patriot"], "goal.patriot", "hint.patriot"),
    g.destroy(["bankova"], "goal.bankova", "hint.bankova"),
    g.victory(),
  ]),
  ru(10, "narva", (g) => [
    g.destroy(
      ["bridgehead1", "bridgehead2"],
      "goal.bridgeheads",
      "hint.bridgeheads",
    ),
    g.destroy(["tallinn"], "goal.capital"),
    g.victory(),
  ]),
];

/** Both campaigns, in menu order (spec 48 §4). */
export const CAMPAIGNS: readonly Campaign[] = [
  {
    faction: "ukraine",
    aim: "campaign.ua.aim",
    missions: UKRAINE,
    ending: "campaign.ua.ending",
  },
  {
    faction: "russia",
    aim: "campaign.ru.aim",
    missions: RUSSIA,
    ending: "campaign.ru.ending",
  },
];

export function findCampaignMission(id: string | null): CampaignMission | null {
  for (const campaign of CAMPAIGNS) {
    const found = campaign.missions.find((m) => m.id === id);
    if (found !== undefined) return found;
  }
  return null;
}

export function campaignOf(faction: CampaignFaction): Campaign {
  return CAMPAIGNS.find((c) => c.faction === faction) as Campaign;
}

/** The mission after `mission` in its campaign, or null after the last. */
export function nextCampaignMission(
  mission: CampaignMission,
): CampaignMission | null {
  return (
    campaignOf(mission.faction as CampaignFaction).missions[mission.number] ??
    null
  );
}

/** Where a campaign page of the main menu opens (spec 48 §4): `?campaign=`
 *  a mission id (its briefing) or `<faction>-ending`. */
export function campaignUrl(target: CampaignMission | CampaignFaction): string {
  const id = typeof target === "string" ? `${target}-ending` : target.id;
  return `?campaign=${id}`;
}

const STORAGE_KEY = "redline.campaign";

/** Missions won per campaign; missions are played in order, so mission n
 *  is open once n - 1 are won (spec 48 §4). Kept in the browser. */
export interface CampaignProgress {
  won(faction: CampaignFaction): number;
  record(mission: CampaignMission): void;
}

export function createCampaignProgress(
  storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage(),
): CampaignProgress {
  const read = (): Partial<Record<CampaignFaction, number>> => {
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  };
  return {
    won: (faction) => {
      const value = read()[faction];
      return typeof value === "number" && value > 0 ? Math.floor(value) : 0;
    },
    record: (mission) => {
      const state = read();
      const faction = mission.faction as CampaignFaction;
      state[faction] = Math.max(state[faction] ?? 0, mission.number);
      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // Private mode: progress lasts for this page only.
      }
    },
  };
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
