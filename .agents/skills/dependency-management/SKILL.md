---
name: dependency-management
description: Add, update, remove or install dependencies (Cargo crates, npm packages, system tools), or edit package manifests or lockfiles.
---

# Dependency Management

## General

* Prefer no dependency. Every new dependency must be justified in the PR body
  and be compatible with AGPL-3.0 (for code) or CC BY-SA 4.0 (for assets).
* Lockfiles (`Cargo.lock`, `package-lock.json`) are always committed.
* System tools are documented in `scripts/doctor.sh` in the same change.

## Rust

* Declare versions once in the root `[workspace.dependencies]` and use
  `{ workspace = true }` in crates.
* `crates/sim` may only depend on crates that are deterministic and
  `no_std`-friendly or pure computation; never on rendering, async runtimes,
  clocks or OS randomness.

## npm

* Confirm `package.json#engines` before installing.
* Save exact versions; registry sources only (no git, tarball or file deps).
* Install scripts are opt-in; never enable them globally.
