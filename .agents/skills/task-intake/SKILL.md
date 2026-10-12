---
name: task-intake
description: Pick, claim, execute and hand back a GitHub issue. Use when starting work, asked "what's next", running unattended or overnight, or when a task is blocked.
---

# Task Intake

## Labels

* Tier: `ready-pro` (Sonnet/DeepSeek or better), `ready-local` (any model,
  including local overnight models), `needs-pro` (escalated), `blocked`,
  `spec` (tier S authoring work).
* Area: `area:sim`, `area:client`, `area:data`, `area:ai`, `area:assets`,
  `area:infra`.

## Writing issues

* Under "Files allowed to change", list every file as its own `` - `path` ``
  line: `scripts/night-runner.sh` reads only the first backticked path of each
  line and matches it exactly (no globs). Include knock-on files, e.g. the
  `crates/headless` banner test when `API_VERSION` bumps.
* To reset an escalated issue, remove the `<!-- night-runner:failure -->`
  comments and restore its tier label.

## Unattended runs

* Run every unblocked `ready-local` issue through `scripts/night-runner.sh`
  (local models, free) first. Take a `ready-pro` issue only when no
  `ready-local` one is unblocked, and only a few per night.

## Pick

1. `gh issue list --label <tier> --state open --search "no:assignee"`
2. Take the lowest-numbered issue whose dependencies are closed.
3. Claim it: `gh issue edit <N> --add-assignee @me` and comment the
   harness and model you are (e.g. `Claimed by OpenCode / Ornith`).

## Execute

* Read the issue, its linked spec and the applicable `AGENTS.md` files.
* Touch only the files the issue allows. Follow the SDD workflow skill.

## Hand back

* Success: PR with `Closes #N`, verification report in the PR body.
* After three failed attempts, or if the spec is ambiguous or a test looks
  wrong: comment what you tried and the exact error, swap the tier label to
  `needs-pro`, unassign yourself and stop. Never work around a test.
