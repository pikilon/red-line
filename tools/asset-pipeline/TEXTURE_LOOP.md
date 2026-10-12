# Texture loop: instructions for the judge agent (one resource per agent)

You generate and judge texture candidates for ONE resource of `textures.yaml`.
You are the cheap judge: be strict about the rules, but the owner approves the final pick in the morning,
so an imperfect best attempt is acceptable when flagged.

Tool (from this folder): `~/.local/share/comfyui/.venv/bin/python texture_tool.py ...`
Never run two generations at once. Use only this tool and local files. Download nothing, call no remote service.

## Loop (at most 4 attempts, one image per attempt)

1. `show ID` to read the resource: what it is, where the game uses it (`used_by`), what is next to it (`neighbours`) and its `rules`.
2. `generate ID --attempt N [--extra "..."] [--neg-extra "..."]`. It prints JSON with the paths of the image, a 2x2 tile preview (`tile_preview`),
   an optional in-game context preview (`context_preview`, the candidate blended over grass) and metrics.
3. Open `tile_preview` (and `context_preview` when it is not null) with the Read tool and judge it:
   - Does it look like the subject, seen straight from above, with no perspective, horizon, shadows, objects, text, logos?
   - Does it obey every rule in `rules`? Is it free of obviously repeating blobs when tiled 2x2? Does it fit the context image
     (colour and scale harmonise with the grass around it)?
   - Strange colours (e.g. red or blue blades in grass, tinted noise) are a failure.
   - Metrics: the texture is already made seamless; `seam_error` should be at most 1.5 x `neighbour_pixel_diff`.
     `large_scale_variation` above 6 means a vignette, a gradient or one big object: a failure.
     `colour_distance` is already small by construction.
4. Score 1-5 and decide valid (score >= 4 and no rule broken) or not. If not valid, change the next attempt with `--extra` and `--neg-extra`
   (short English phrases that fix exactly the problem you saw, e.g. `--neg-extra "red, flowers"`). Stop early at the first valid attempt.
5. Choose the pick: the first valid attempt, otherwise the highest score. `accept ID --attempt PICK`.
6. Write `<root>/runs/ID/verdict.json` (root = `/Volumes/Externo Mac SSD/red-line-textures`):
   `{"pick": N, "valid": true|false, "reason": "one sentence", "attempts": {"1": "score 3: red blades", "2": "score 4: ok"}}`
   Mark `"valid": false` honestly when no attempt passed, so the owner knows to look closer.

## Final report (under 60 words)

Resource id, number of attempts, pick, valid yes/no, the main problem if any. No more.
