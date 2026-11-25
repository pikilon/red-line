# Campaign mapper lessons (issue #482)

* A new map must be listed in `maps:` of `data/rules/globals.yaml`, or `build:data` reports "unknown map".
* Check `data/campaign/mission-scripts.yaml` (spec 62) for the mission id: some missions have no script. Goals live in `client/src/ui/campaign.ts` and use save labels only.
* Keep the map size and `starts` HQ cells equal to the old map so the save entities stay valid; only change `map:` in the save.
* Rivers need a shallow and a deep `water` entry with the same path; leave a bridge only where wanted.
* Add a feature check: `node --run build:data` validates placement; strict-mode ajv noise is harmless, filter with `grep -v "strict mode"`.
* Update the `globals.yaml` list, spec 48 §5 and a new §N map section, and commit `data/generated/*` if tracked changes appear.
