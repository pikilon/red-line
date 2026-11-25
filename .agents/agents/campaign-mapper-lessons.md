# Campaign mapper lessons (issue #482)

* A new map must be listed in `maps:` of `data/rules/globals.yaml`, or `build:data` reports "unknown map".
* Check `data/campaign/mission-scripts.yaml` (spec 62) for the mission id: some missions have no script. Goals live in `client/src/ui/campaign.ts` and use save labels only.
* Keep the map size and `starts` HQ cells equal to the old map so the save entities stay valid; only change `map:` in the save.
* Rivers need a shallow and a deep `water` entry with the same path; leave a bridge only where wanted.
* Add a feature check: `node --run build:data` validates placement; strict-mode ajv noise is harmless, filter with `grep -v "strict mode"`.
* Update the `globals.yaml` list, spec 48 §5 and a new §N map section, and commit `data/generated/*` if tracked changes appear.
* Snake Island (#482): a sea map needs no `blocked`; one deep `sea` rect plus a shallow fringe is enough, and `pier` is walkable over deep water. Water rects are inclusive `[x0, y0, x1, y1]`.
* When the saves put bases 45+ cells apart, the island must be as wide as the old HQ span: scale the real place up and say so in the spec.
* Most missions have no `mission-scripts.yaml` entry (only Hostomel so far): `grep -n "^campaign-" data/campaign/mission-scripts.yaml` first.
* Decoration ids that exist: `warehouse-barn`, `factory`, `house-small`, `shop`, `lamp-post`, `crate-stack`, `stone-wall`, `bush`, `dead-tree`, `lighthouse`, `pier`, `buoy`, `fishing-boat`.
