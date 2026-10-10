---
name: instruction-placement
description: Add, move, remove, or review repository rules, agent instructions, preferences, or workflows by locating their affected scope and narrowest authoritative layer.
---

# Instruction Placement

Treat instruction placement as a design decision. Do not edit a guidance file
until the rule's affected paths, triggering intent, lifetime, and enforceability
are clear.

## Locate the Existing Authority

1. Read every applicable `AGENTS.md` before inspecting its subtree.
2. Search with `rg` across `AGENTS.md`, `.agents/skills/`, `specs/`, tooling
   configuration, tests, CI, `README.md`, and `docs/` for the rule, its subject,
   and references to its current location.
3. Identify who needs the rule, when they need it, which paths it governs, and
   whether a machine can enforce it.
4. Update an existing authority when its intent already matches. Create a new
   layer only when no current one has the correct scope.

## Choose One Canonical Layer

* **Machine-enforceable invariant:** implement it in a linter, type check, test,
  script, or CI. Put remediation in its diagnostic. Do not duplicate it as
  prompt prose unless an agent still needs a non-enforceable decision rule.
* **Observable product behavior:** place it in `specs/*.md` and follow
  `.agents/skills/sdd-workflow/SKILL.md`.
* **Stable rule needed for every repository task:** keep it concise in the root
  `AGENTS.md`.
* **Path-specific rule:** place it in the closest `AGENTS.md` whose subtree
  exactly covers the affected files. Prefer a common ancestor over copying the
  rule into several files.
* **Intent-specific or multi-step workflow:** update the matching skill under
  `.agents/skills/`, or create one only when the intent is genuinely distinct.
* **Temporary plan, handover, investigation, or history:** keep it outside
  auto-loaded instructions and outside `specs/`; use `docs/` only when the
  repository needs the document permanently.
* **Personal preference that is not a team contract:** do not commit it to the
  repository; use a user-scoped standard instruction or skill instead.

Honor the root `AGENTS.md` Configuration Portability policy when selecting a
file format or documenting a tool-specific requirement.

## Apply the Change

Keep one source of truth. Other layers may point to it but must not restate it.
When moving or deleting a rule, remove its old copy and update every reference
in the same change. Keep auto-loaded files terse and follow the root
`AGENTS.md` Repository Language policy.

If placement reveals a conflict between an existing rule and the repository's
goals or actual code, report the conflict instead of silently preserving it.

## Verify

* Search again for duplicates, stale wording, and dangling paths.
* Confirm the selected layer covers all affected work and no unrelated work.
* Measure `AGENTS.md` size changes when altering always-loaded context.
* Validate every new or changed skill with the available skill validator.
* Delegate verification to `.agents/agents/verification-runner/agent.md` before
  closing the configuration change.
