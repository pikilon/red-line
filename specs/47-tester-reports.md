# 47 — Tester reports (bugs and feature requests)

## 1. Goal

Friends testing the game can file a bug or a feature request from inside the
match, with a screenshot and attachments. Each report becomes a GitHub issue
in `pikilon/red-line`, so nothing the testers say gets lost (owner request
2026-11-04).

## 2. Precedent

Zero Hour has no in-game bug reporter; this is tooling, not a game mechanism,
so no generals-precedent note applies.

## 3. Testers and invite links (owner request 2026-11-04)

* No accounts, passwords or emails. The owner invites a tester by name with
  `node --run testers:invite -- "Name"`, which prints a personal link
  `https://red-line.pikilon.com/?invite=<secret>` to send privately.
* Opening the link stores the secret in that browser and removes it from the
  address bar; the page then behaves as if opened without it (main menu).
  The invite stays until revoked; there is no expiry.
* `node --run testers:list` lists testers; `node --run testers:revoke --
  "Name"` deletes one, and its link stops working. Inviting the same name
  again issues a new link and voids the old one.
* Without a stored invite, the Report page explains how to get one. A revoked
  invite is forgotten on the next call and the page says so.

## 4. Reporting

* The Esc menu shows **Report** when the backend is configured. It opens a
  page with: kind (**Bug** / **Feature**), title, description, extra files,
  and two checkboxes, both on by default:
  * **Screenshot** — the game view as it was when Report was pressed.
  * **Match save** — the current match as a save file (spec 19), so the owner
    can open the exact situation.
* Pasting an image (Ctrl/Cmd+V) anywhere in the form adds it as an extra
  file, the same as picking it by hand (owner request 2026-11-04).
* **Send** creates the issue and shows its number with a link. Title and
  description are required; at most 8 extra files of 10 MB each.
* Typing in the form never reaches the game (no hotkeys fire).

## 5. The GitHub issue

* Labels: `bug` or `enhancement`, plus `tester-report`.
* The body starts with **Reporter:** and the tester's name, then the
  description, the screenshot and image attachments shown inline,
  other files and the save as links, and a context block (page URL, map, tick, viewport, browser).
* When the backend has a GitHub Project id configured, the issue is also added
  to that project board.
* To open a reported match: download `save.json` from the issue and run
  `node --run saves:import -- save.json <id>`, then open `?load=<id>`.

## 6. Backend

* Supabase project `red-line`: table `testers` (name, SHA-256 of the invite
  secret), public storage bucket `reports`, Edge Function `report` (no JWT;
  the secret travels in the `x-tester-token` header).
* `GET` returns the tester's name; `POST` stores the files in
  `reports/<date>/<uuid>/` and creates the issue with a GitHub token kept as a
  function secret (`GITHUB_TOKEN`, optional `GITHUB_PROJECT_ID`). The game
  only holds the publishable key.

## 7. Assumptions

* The repository is public, so issues and attachments are public too.
* Reports are not available in the shell battle behind the main menu (its game
  menu is hidden).
