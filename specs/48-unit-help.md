# 48 — Unit and building help cards

Status: accepted (owner request 2026-11-04). Client and data only: no sim,
save format or rules change.

## 1. Goal

Every unit and building has a help card that explains, with the game paused,
what it is for and every thing it can do (reload, garrison, carry troops,
jam drones, repair, launch drones...), illustrated with screenshots of the
game. The player can open it for what is selected and for anything in the
build panels before buying it.

## 2. Precedent (`generals-precedent`, Zero Hour)

Zero Hour explains a type before it is built through the command bar build
tooltip: hovering a command button shows a popup with the name, cost, build
time and a description string from the button's `DescriptLabel`
(`CommandButton.ini`, `ControlBar::populateBuildTooltipLayout`). Red Line keeps
the idea (help for anything on a build tile) but, since phones have no hover,
puts it behind a help button and a full card instead of a tooltip.

## 3. Behaviour

### 3.1 Opening a card

* The HUD bar top row holds a `?` button (`#hud-help`) on every device.
* Pressing it arms help: the bar's tiles and selection chips show a `?` badge
  and a hint replaces the selection name. Tapping a tile or chip, enabled or
  not, opens the card of its type instead of building or narrowing.
* Pressing `?` again or `Esc` disarms help without opening anything.
* With help armed, nothing else in the bar changes: tabs still switch, so a
  player can open the card of anything on the Build tab of any building.

### 3.2 The card

* A card opens over the game and pauses it like the game menu (spec 08 §3):
  the simulation, effects clock and sounds stop; closing it resumes them.
  `Esc`, the close button or a tap outside the card close it.
* Contents, top to bottom:
  1. Cameo, name, side and a one-line role.
  2. A stats strip generated from the rules (cost, build time, health, armour,
     speed, sight, weapon range and targets, transport slots, power, built at,
     requires). It is never written by hand, so it follows balance changes.
  3. A summary paragraph.
  4. One section per thing the type can do, each with a title, the controls
     that trigger it ("how"), an explanation and zero to three screenshots.
  5. Strong against / weak against / tips lists.
* Drones and missiles launched by another type (FPV, Sting, Molniya, Geran,
  Flamingo, Storm Shadow) have no card of their own: they are a section of
  their launcher's card, with their own stats strip. Asking for their help
  (e.g. the Flamingo tile of the missile site) opens the launcher's card
  scrolled to that section.
* Links: a type named in a card (the building that produces it, a unit it
  carries...) is a link to that type's card.

### 3.3 Screenshots that stay faithful

Screenshots are not hand-made: each is a recipe that `node --run help:shots`
replays in the real game.

* A recipe names an example save (spec 19) staged for it, how many ticks to
  play, what to select and whether the HUD shows. Help saves are ordinary
  example saves whose id starts with `help-`, so `?load=help-...` shows the
  same situation to anyone.
* The script writes `client/public/help/<shot>.jpg` and records in
  `client/public/help/shots.json` a fingerprint of the recipe, its save and
  the look of the game (models, textures, render code, render data and
  faction data).
* When the look changes, the fingerprints stop matching: `node --run
  help:shots -- --check` lists the stale shots and `node --run status`
  reports their count. `node --run help:shots` regenerates only stale or
  missing shots (`--all` forces every one).
* A unit test fails when a buildable or selectable type has no card, a card
  names a shot without a recipe or image, or a launched type is not covered
  by a launcher card.

## 4. Data

* Card text (player-facing, English): `client/src/i18n/help/<type-id>.json`.
* Shot recipes: `data/help/<type-id>.yaml` (list of shots).
* Help saves: `data/saves/help-<type-id>-<what>.yaml`.

## 5. Assumptions

* A1. The `?` button is a mode (armed, then tap a tile or chip), not a
  long-press, because right-click on a tile already cancels production.
* A2. Screenshots are 960 × 540 JPEG, at most three per section.
* A3. English only, like the rest of the game.

## 6. Acceptance

* AC-48-01: pressing `?` then a Build tile opens that type's card and pauses
  the game; closing it resumes.
* AC-48-02: pressing `?` then the Flamingo tile opens the missile site card
  at the Flamingo section.
* AC-48-03: every buildable or selectable type has a card or is covered.

## 7. Authoring a card (agents)

Template: `client/src/i18n/help/ua-bradley.json`, `data/help/ua-bradley.yaml`,
`data/saves/help-ua-bradley-*.yaml`. For type `<id>` write only:

1. `client/src/i18n/help/<id>.json`: `id`, `role`, `summary`, `sections`
   (`title`, `how`, `body`, `shots`, optional `about`), `strong`, `weak`,
   `tips`. Player-facing English, short sentences, no numbers that the stats
   strip already shows (cost, health, range...). Never invent a mechanic:
   every claim comes from `data/factions/*.yaml` and the spec that owns it
   (grep the type id and the YAML key, e.g. `transport` spec 34, `charges`
   and `link` and `jammer` spec 43, repair specs 38 and 39, healing 40,
   garrison 31, trenches 35, selling 37, rally 33, production 33/41).
   Controls in `how` must match the client (spec 41 buttons, spec 08 clicks).
2. One section per thing it can do: its weapon, each special ability
   (carry, unload, garrison, dig, repair, reload/resupply, jam, launch drones,
   build, harvest, heal, produce, power...), plus how it is repaired or healed.
   A launcher card has one section per launched type with `about: <type-id>`.
3. `data/help/<id>.yaml`: one recipe per shot, `{ id: <id>-<what>, save,
   ticks, select: [type ids], hud: true|false, tab: build|orders|groups }`.
   Prefer one to three shots per section; `hud: true` when a button matters.
4. `data/saves/help-<id>-<what>.yaml`: a small scene (copy an existing save
   of the same spec, keep `debug: true`, `starts: false`, `victory: false`,
   `client.revealed: true`). Map players follow the stock maps: Ukraine is player 0, Russia player 1; for a Russian card set `client.controlled: 1`. Camera `zoom: 3` centred on the action; with
   `hud: true` keep the action in the upper two thirds. Map `showcase` is open
   ground around x 30-60, y 10-30 (tiles; `atCenti` is tiles × 100).
5. Run `node --run help:shots -- --type <id>`, open every
   `client/public/help/<id>-*.jpg` and check it shows what the section says;
   adjust `ticks`, positions or camera and rerun (`--all` forces).
6. Run `cd client && npx vitest run src/help` (the "every unit has help" test
   fails until all cards exist; the others must pass for your card).

Touch nothing else: no `en.json`, no `globals.yaml`, no code.
