# Faction assembly line

How a new army (D-04; issues #485 USA, #486 China, #487 Iran, #488 Israel)
goes from idea to playable faction with cheap subagents. The coordinator (the
strongest model) owns design and merging; each stage is a subagent with its
own `agent.md` and a `lessons.md` it reads first and appends to last, so a
problem solved once is never paid for again.

## Stages

| # | Stage | Who | Model | Input | Output |
|---|---|---|---|---|---|
| 0 | Precedent + spec | coordinator + `generals-precedent` | strong + haiku | issue | `specs/NN-<faction>.md`, roster table, briefs |
| 1 | Rules data | coordinator | strong | spec | `data/factions/<f>.yaml`, `data/ai/<f>-*.yaml`, i18n names |
| 2 | 3D models | `meshy-modeler` | sonnet | one type + brief | `client/public/models/<id>.glb` (+ raw in `models/meshy/`) |
| 3 | Movement | `unit-animator` | sonnet | one infantry type | rig clips + `tools/models/<id>.py` limb split, rig poses |
| 4 | Audio | `voice-maker` | sonnet | faction + roster | `data/audio/lines/<f>.yaml`, voice/EVA files, events |
| 5 | Special abilities | `ability-engineer` | sonnet | one ability section of the spec | sim + data + client + tests |
| 6 | Help pages | `help-writer` | haiku | one type | `data/help/<id>.yaml`, `client/src/i18n/help/<id>.json` |
| 7 | Balance | `balance-tuner` | sonnet | faction | tuned `data/factions/<f>.yaml`, report in `docs/balance/` |

Stages 2-6 run in parallel, one subagent per type (worktree isolation when two
write the same files). Stage 7 runs last, after every stage lands.

## Coordinator rules

* One brief per call: type id, category, real-world reference, silhouette
  notes, what must NOT appear (D-03: no real people, no official logos of
  designated organisations). Keep briefs in the spec so a rerun is identical.
* Budgets per faction, stated in the spec before stage 2: Meshy credits (about
  25 per vehicle/building, 40 per infantry incl. rig and clips) and Claude
  weekly usage. Stop a stage when its budget is reached and report.
* Paid APIs (D-11): Meshy runs only after the owner confirms it for the run;
  record that confirmation in the spec.
* A subagent never merges or opens PRs; the coordinator batches its output
  into one PR per stage (or per faction when small), runs Biome and
  `node --run check`, and merges with `gh pr merge --auto --squash`.
* After each stage read the subagent's appended lessons; prune duplicates and
  move anything that is a rule into the agent's `agent.md`.

## Lessons format

Each `lessons.md` entry is three lines, newest last:

```
### <date> <short title>
Problem: what went wrong or cost a retry.
Fix: what to do instead (command, setting, prompt wording).
```
