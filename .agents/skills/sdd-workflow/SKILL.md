---
name: sdd-workflow
description: Spec-Driven Development rules. Use when implementing a feature, creating or updating specs in specs/, writing acceptance tests, or running the red-green-refactor cycle.
---

# Spec-Driven Development

## Specs (`specs/NN-kebab-case-title.md`) — tier S models only

* Context and scope (in / out).
* Numbered acceptance criteria in `Given / When / Then` form, each verifiable
  by an automated test.
* Interfaces: exact types, function signatures, file paths and data schemas.
  The spec must allow implementation by transcription, not invention.
* Traceability table: criterion → test file and test name.
* Breakdown into issues small enough for one PR (target under 300 changed
  lines), each tagged `ready-pro` or `ready-local`.

## Tests first

* Simulation: Rust tests in `crates/sim` named after the criterion, e.g.
  `fn ac_02_03_units_route_around_walls()`.
* Client: Vitest unit tests next to the module; Playwright E2E under
  `client/tests/e2e/` titled `AC-02-03: ...`.
* Data: schema validation fixtures under `data/`.
* A test must first fail because the behavior is missing, not because of a
  compile error or broken selector. Commit tests separately from the
  implementation.
* When the implementation is done, the spec reflects the final behavior.
