# 14 — Showcase

Status: superseded by `19-save-games.md` (2026-10-15), except §2 and the
`#hud-selected-type` label of §5. Originally accepted 2026-10-13, issue #259.
Depends on `03-phase2-core-loop.md` §5.8 (`DebugSpawn`) and `08-player-controls.md`.

## 1. Context

To inspect models, skins and liveries the owner wants a match that starts with
every building and every unit of both sides already built and laid out in
formation, plus the name of the selected unit on screen. It is a debug aid:
nothing of it runs in a normal skirmish.

## 2. Sim: `DebugSpawn` of buildings

`DebugSpawn { kind, pos }` (spec 03 §5.8) also accepts a building type: when
`debug_commands` is on, `kind` is a building type, the footprint with origin
`cell_of(pos)` is free (`World::footprint_free`) and fewer than `MAX_UNITS`
entities exist, a complete building (`place_building(.., complete = true)`) of
`p` is placed there, ignoring credits, prerequisites, fog and power. Depots stay
unsupported. Unit behaviour is unchanged.

## 3. Map `showcase` (`data/maps/showcase.yaml`)

100 x 40, no `blocked` cells, no depots, `starts`: Ukraine with HQ origin
`[4, 6]` and Russia with HQ origin `[54, 6]`. The dozer of each start is the
engineering vehicle slot of its formation (§4).

## 4. Formation (`client/src/app/showcase.ts`)

```ts
export interface ShowcaseSpawn {
  player: number;
  typeIndex: number;
  /** Tiles; buildings use the origin cell, units the centre of the cell. */
  x: number;
  y: number;
}

/** Every building and unit type of each player's faction, in ruleset order,
 *  except the HQ and the dozer that the map start already provides. */
export function showcasePlan(rules: ShowcaseRules, map: ShowcaseMap): ShowcaseSpawn[];
```

Per player, with `x0` = the start HQ x: buildings at origin `(x0 + 5 * i, hqY)`
where `i` counts the buildings in ruleset order (the HQ is `i = 0`); units in two
rows of four at `y = 16.5` and `y = 20.5`, `x = x0 + 3.5 + 4 * col`, in ruleset
order (the dozer is unit slot 6: `x0 + 11.5, 20.5`, which is the map start's
`dozerCenti`). Depots and types of other factions are skipped.

## 5. Client

`?showcase=1` is `?debug=1&map=showcase&ai=off` with the whole map revealed
(`OBSERVER` viewer), the camera at zoom 1 centred on the formation of the controlled side (`x0 + 14`, `y = 12`) and, once the match is ready,
one `debugSpawn` command per `showcasePlan` entry. `?showcase=units` is the same match with the camera at zoom 2 on the two unit
rows (`x0 + 9.5`, `y = 18.5`), to inspect vehicles up close. F2 or the menu switch the
controlled side, which is how the other side's units are selected.

The HUD gains `#hud-selected-type` under `#hud-selected`: empty without
selection, the name (`type.<id>` i18n) of a single selected type, or
`Name x n` entries joined with ", " when several types are selected (same type
counted).

## Acceptance criteria

* AC-14-01: Given a skirmish with debug commands, When a building type is spawned
  on a free footprint, Then a complete building of that player exists there; it
  is ignored without debug commands and on an occupied footprint.
* AC-14-02: Given the ruleset and the `showcase` map, Then `showcasePlan` has
  every non-HQ building and non-dozer unit type of each faction exactly once,
  none overlap, all are inside the map, and the map's dozer start equals the
  dozer slot.
* AC-14-03: Given selected type names, Then `selectionLabel` gives "", "Name",
  and "Name x 2, Other" as in §5.
* AC-14-04: Given `?showcase=1`, When the match is ready, Then both sides'
  buildings and units exist (14 per faction) and clicking a unit with the real
  mouse shows its name in `#hud-selected-type`.
