---
name: repository-delivery
description: Create commits, branches or worktrees, or use GitHub for issues, pull requests, releases or remote operations.
---

# Repository Delivery

## Identity

* Run GitHub CLI commands only through `scripts/gh.sh <args>`; it selects the
  `pikilon` account itself. Do not run `gh auth status` first.
* Commits must be authored as `pikilon <pikilon@gmail.com>`. The repository
  sets this in its local git config; in a fresh clone or worktree run
  `git config user.name pikilon && git config user.email pikilon@gmail.com`.
* Remote: `git@github-pikilon:pikilon/red-line.git` (SSH host alias that uses
  the owner's personal key).

## Branches and worktrees

* One issue = one branch `<issue-number>-<kebab-summary>` = one worktree.
  Never share a worktree between agents.
* Never push to `main` directly once the repository is public; open a PR that
  references the issue (`Closes #N`).

## Commits

English, third person, with one prefix: `feat`, `fix`, `chore`, `docs`,
`refactor`, `test`, `build`, `ci`, `perf`, `style`.
Example: `feat: adds flow field integration pass`.
