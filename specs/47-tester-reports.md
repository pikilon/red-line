# 47 — Tester reports (bugs and feature requests)

## 1. Goal

Friends testing the game can file a bug or a feature request from inside the
match, with a screenshot and attachments. Each report becomes a GitHub issue
in `pikilon/red-line`, so nothing the testers say gets lost (owner request
2026-11-04).

## 2. Precedent

Zero Hour has no in-game bug reporter; this is tooling, not a game mechanism,
so no generals-precedent note applies.

## 3. Accounts

* Only emails on the **tester list** (`public.testers`, edited by the owner in
  the Supabase table editor) can register. Registering any other email fails
  with "not on the tester list".
* A tester registers once with email and password and stays signed in on that
  browser (the session is refreshed silently). **Sign out** forgets it.
* No email is ever sent: there is no confirmation mail and no password reset.
  A tester who forgets the password asks the owner, who deletes the user in
  Supabase so the tester can register again.

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
* Body: the description, the screenshot and image attachments shown inline,
  other files and the save as links, the tester's display name (never the
  email) and a context block (page URL, map, tick, viewport, browser).
* When the backend has a GitHub Project id configured, the issue is also added
  to that project board.
* To open a reported match: download `save.json` from the issue and run
  `node --run saves:import -- save.json <id>`, then open `?load=<id>`.

## 6. Backend

* Supabase project `red-line`: Auth (email + password, confirmations off),
  table `testers`, public storage bucket `reports`, Edge Function `report`.
* The function checks the signed-in user is still on the tester list, stores
  the files in `reports/<date>/<uuid>/`, and creates the issue with a GitHub
  token kept as a function secret (`GITHUB_TOKEN`, optional
  `GITHUB_PROJECT_ID`). The game only holds the public anon key.

## 7. Assumptions

* The repository is public, so issues and attachments are public too.
* Reports are not available in the shell battle behind the main menu (its game
  menu is hidden).
