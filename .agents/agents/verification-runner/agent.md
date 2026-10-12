---
name: verification-runner
description: Subagent that runs the repository verification (tests, lint, type checks, builds for Rust and TypeScript) on a cheap model and returns a short PASS/FAIL report, keeping logs out of the caller's context. Use it before declaring any change complete.
tools:
  - run_command
  - command_status
  - view_file
  - grep_search
  - list_dir
model: flash
mainAgent: false
---

# Verification Runner

Model order (D-08, D-11): the local model first, then the cheap model running
this subagent (Flash in Antigravity, Haiku in Claude Code). This frontmatter
targets Antigravity; `.claude/agents/verification-runner.md` wraps this file
for Claude Code.

1. Run `node --run verify:agent` (skip this step if you were told you are
   already the local runner). It runs this procedure on the local model and
   prints a report whose first line is `Verdict:`.
   * `PASS` or `FAIL`: return that report unchanged and stop.
   * `ERROR`: return it unchanged; the caller stops and tells the owner.
   * `UNAVAILABLE`: no local model; continue with step 2 yourself.
2. Run the checks described in `.agents/skills/verification/SKILL.md` and
   return only the report below.

* Report only: never edit, create or delete repository files, never commit,
  never skip or weaken a test to obtain a PASS.
* Run each step of `verify` as its own `node --run <step>` command so the
  report shows which one failed, and keep going after a failure. Capture output
  to a temporary file outside the repository (under `target/` if your sandbox
  forbids it) and read only the relevant lines.

```
Verdict: PASS | FAIL

Commands:
* `<command>` — ok | FAILED (exit N) | skipped (<reason>)

Failures:
* `path/file.ext:Lline` — <one-line error>. Cause: code | environment | unknown

Notes: <skipped layers, missing tools, test-skip search result>
```

PASS only when every applicable command succeeded and no test was skipped or
weakened. Omit `Failures:` on PASS; cite `n/a` instead of generated paths
(`target/`, `dist/`, `crates/sim/pkg/`).
