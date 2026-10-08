---
name: sdd-workflow
description: Step-by-step Spec-Driven Development. Use when implementing a feature, creating or updating specs in specs/, writing acceptance tests, or running the red-green-refactor cycle.
---

# Spec-Driven Development

## 0. Intake

* Work starts from a GitHub issue that links a spec (see `task-intake` skill),
  or from the owner describing a feature.
* For a new feature, extract the actor, trigger, visible outcome and the layer
  affected (`crates/sim`, `client/`, `data/`, `tools/`).

## 1. Specify (`specs/NN-kebab-case-title.md`) — tier S models only

* Context and scope (in / out).
* Numbered acceptance criteria in `Given / When / Then` form, each verifiable
  by an automated test.
* Interfaces: exact types, function signatures, file paths and data schemas the
  implementation must expose. The spec must allow implementation by
  transcription, not invention.
* Traceability table: criterion → test file and test name.
* Breakdown into issues small enough for one PR (target under 300 changed
  lines), each tagged `ready-pro` or `ready-local`.

## 2. Test first (RED)

* Simulation: Rust tests in `crates/sim` named after the criterion, e.g.
  `fn ac_02_03_units_route_around_walls()`.
* Client: Vitest unit tests next to the module; Playwright E2E under
  `client/tests/e2e/` titled `AC-02-03: ...`.
* Data: schema validation fixtures under `data/`.
* Run the test and confirm it fails because the behavior is missing, not
  because of a compile error or broken selector. Commit tests separately.

## 3. Implement (GREEN)

* Write the minimum code that makes the tests pass.
* Never edit, weaken, skip or delete tests written in step 2. If a test seems
  wrong, stop and report it in the issue with the `needs-pro` label.

## 4. Refactor

* Clean up without breaking tests, then load and execute
  `.agents/skills/verification/SKILL.md`.

## Close-out checklist

* [ ] The spec reflects the final behavior.
* [ ] Every criterion has a test whose initial failure was observed.
* [ ] Verification passes.
