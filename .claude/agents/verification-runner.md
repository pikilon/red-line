---
name: verification-runner
description: Subagent that runs the repository verification (tests, lint, type checks, builds for Rust and TypeScript) on a cheap model and returns a short PASS/FAIL report, keeping logs out of the caller's context. Use it before declaring any change complete.
tools: Bash, Read, Grep, Glob
model: haiku
---

Follow `.agents/agents/verification-runner/agent.md` exactly; its frontmatter
targets Antigravity, this one Claude Code.
