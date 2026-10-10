---
name: repository-delivery
description: Create commits, branches or worktrees, or use GitHub for issues, pull requests, releases or remote operations.
---

# Repository Delivery

## Identity

* GitHub operations act as `pikilon`. If `gh` answers with another account or
  fails to authenticate, stop and ask the owner to fix the login; do not switch
  accounts yourself.
* Commits must be authored as `pikilon <pikilon@gmail.com>`. The repository
  sets this in its local git config; in a fresh clone or worktree run
  `git config user.name pikilon && git config user.email pikilon@gmail.com`.
* Remote: `git@github-pikilon:pikilon/red-line.git` (SSH host alias that uses
  the owner's personal key).

## Branches and worktrees

* One issue = one branch `<issue-number>-<kebab-summary>` = one worktree.
  Never share a worktree between agents.
* Write, build and test only inside your issue's worktree. Never copy or write
  files into the main checkout: `git status` there must be unchanged when you
  hand back (the overnight runner fails the attempt otherwise).
* Never push to `main` directly once the repository is public; open a PR that
  references the issue (`Closes #N`).

## Commits

English, third person, with one prefix: `feat`, `fix`, `chore`, `docs`,
`refactor`, `test`, `build`, `ci`, `perf`, `style`.
Example: `feat: adds flow field integration pass`.
