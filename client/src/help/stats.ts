/** The stats strip of a help card, generated from the rules so it follows
 *  balance changes (spec 48 §3.2). */
import ruleset from "@data/ruleset.json";
import { type MessageKey, t } from "../i18n";
import { RULES, type TypeDef, typeIndex, typeName, WEAPONS } from "../rules";

const TICKS_PER_SECOND = 15;

export interface HelpStat {
  label: string;
  value: string;
  /** Type ids the value names, shown as links to their cards. */
  links?: string[];
}

const tiles = (centi: number): string =>
  (centi / 100).toFixed(centi % 100 === 0 ? 0 : 1);

function names(kinds: readonly number[]): string {
  return kinds.map((kind) => typeName(kind)).join(", ");
}

/** The stats of `typeId`, in reading order; empty for an unknown id. */
export function helpStats(typeId: string): HelpStat[] {
  const kind = typeIndex(typeId);
  const def: TypeDef | undefined = RULES.types[kind];
  if (def === undefined) return [];
  const stat = (key: string, value: string, links?: string[]): HelpStat => ({
    label: t(`help.stat.${key}` as MessageKey),
    value,
    ...(links === undefined ? {} : { links }),
  });
  const out: HelpStat[] = [];
  if (def.cost > 0) out.push(stat("cost", String(def.cost)));
  out.push(stat("health", String(def.hp)));
  const armor = ruleset.armorClasses[def.armor];
  if (armor !== undefined)
    out.push(stat("armor", t(`help.armor.${armor}` as MessageKey)));
  if (def.category === "unit" && def.speedCenti > 0) {
    const perSecond = (def.speedCenti * TICKS_PER_SECOND) / 100;
    out.push(
      stat(
        "speed",
        t("help.unit.tilesPerSecond", { value: perSecond.toFixed(1) }),
      ),
    );
  }
  out.push(stat("sight", t("help.unit.tiles", { value: tiles(def.sightCenti) })));
  const weapon = WEAPONS[def.weapon];
  if (def.weapon >= 0 && weapon !== undefined) {
    const damage = ruleset.damageTypes[weapon.damageType];
    out.push(
      stat(
        "weapon",
        t("help.unit.weapon", {
          damage: t(`help.damage.${damage}` as MessageKey),
          range: tiles(weapon.rangeCenti),
        }),
      ),
    );
    const ground = weapon.antiGround !== false;
    const air = weapon.antiAir ?? "none";
    out.push(
      stat(
        "targets",
        t(`help.targets.${ground ? "ground" : "noGround"}.${air}` as MessageKey),
      ),
    );
  }
  if (def.transport !== undefined)
    out.push(stat("carries", t("help.unit.slots", { count: def.transport.slots })));
  if (def.power !== 0)
    out.push(
      stat("power", def.power > 0 ? `+${def.power}` : String(def.power)),
    );
  const builtAt = RULES.types.flatMap((other, index) =>
    other.produces.includes(kind) || other.builds.includes(kind) ? [index] : [],
  );
  if (builtAt.length > 0)
    out.push(
      stat(
        "builtAt",
        names(builtAt),
        builtAt.map((index) => RULES.types[index]?.id ?? ""),
      ),
    );
  if (def.requires.length > 0)
    out.push(
      stat(
        "requires",
        names(def.requires),
        def.requires.map((index) => RULES.types[index]?.id ?? ""),
      ),
    );
  return out;
}
