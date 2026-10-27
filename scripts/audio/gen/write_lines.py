"""Drafts the Ukrainian/Russian voice and EVA scripts (data/audio/lines/<faction>.yaml,
spec 25 §5.3) with the local LM Studio model. Soldiers swear; variant 1 stays clean."""
import json, re, urllib.request, yaml
from common import REPO, ROOT, inventory

LM = "http://127.0.0.1:1234/v1/chat/completions"
MODEL = "gemma-4-26b-a4b-it-mlx"
SITUATION = {
    "select": "the player selects the unit; short readiness acknowledgement",
    "move": "the player orders a move; acknowledgement on the move",
    "attack": "the player orders an attack; aggressive, combative",
    "underFire": "the unit is being shot at; panic, anger, swearing",
    "die": "the soldier/crew is killed; one very short scream or last curse (1-3 words)",
    "created": "the unit just left the factory/barracks, reporting for duty",
}
LANG = {"ukraine": "Ukrainian", "russia": "Russian", "common": "Ukrainian"}
transcripts = json.loads((ROOT / "lines/transcripts.json").read_text())


def ask(prompt):
    body = json.dumps({"model": MODEL, "temperature": 0.8, "messages": [
        {"role": "system", "content": "You write voice lines for a gritty modern war RTS game "
         "(Ukraine vs Russia), adult audience. Soldiers talk like real soldiers on the radio, "
         "including strong profanity (Russian mat: блять, сука, нахуй, пиздец, ёб твою мать; "
         "Ukrainian: бля, курва, сука, йобаний, срака, хрін). Output only JSON."},
        {"role": "user", "content": prompt}]}).encode()
    req = urllib.request.Request(LM, body, {"Content-Type": "application/json"})
    text = json.load(urllib.request.urlopen(req, timeout=600))["choices"][0]["message"]["content"]
    return json.loads(re.search(r"\{.*\}", text, re.S).group(0))


groups = {}
for ev, e in inventory().items():
    if e["kind"] in ("voice", "eva") and e.get("variants"):
        parts = e["target"].split("/")  # audio/voice/<faction>/<set>/<event>_<n> | audio/eva/<faction>/<event>_<n>
        faction, unit = (parts[2], parts[3]) if e["kind"] == "voice" else (parts[2], "eva")
        groups.setdefault((faction, unit), {})[parts[-1].split("_<n>")[0]] = (ev, e["variants"])

files = {}
for (faction, unit), events in sorted(groups.items()):
    path = REPO / f"data/audio/lines/{faction}.yaml"
    data = files.setdefault(faction, yaml.safe_load(path.read_text()) if path.exists() else {})
    todo = {k: v for k, v in events.items() if f"{unit}.{k}" not in data}
    if not todo:
        continue
    spec = []
    for name, (ev, n) in todo.items():
        ref = "; ".join(transcripts.get(ev, [])[:5])
        what = (f"EVA (calm base computer voice, formal military, NEVER any profanity) announcing: {name}"
                if unit == "eva" else SITUATION.get(name, name))
        spec.append(f'- "{name}": {n} lines. Situation: {what}. Original English lines for the same '
                    f"situation (adapt the idea, do not translate literally): {ref or 'none'}")
    who = "the base EVA computer" if unit == "eva" else f"unit '{unit}' (id hints at the vehicle/role)"
    res = ask(f"Write {LANG[faction]} lines for {who}, {faction} side.\n" + "\n".join(spec) +
              '\nLines are 1-8 words, natural spoken ' + LANG[faction] + ', no stage directions. '
              'For soldier units at least half of the lines (never the first) use strong profanity. '
              'Return JSON {"<event>": [{"text": "...", "explicit": true|false}, ...]} with exactly the '
              "requested number of lines per event.")
    for name, (ev, n) in todo.items():
        lines = (res.get(name) or [])[:n]
        while len(lines) < n:
            lines.append(lines[-1] if lines else {"text": "Так точно!" if faction != "russia" else "Есть!", "explicit": False})
        data[f"{unit}.{name}"] = [{"id": i + 1, "text": l["text"].strip(), "explicit": bool(l.get("explicit")) and i > 0 and unit != "eva"}
                                  for i, l in enumerate(lines)]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"# {LANG[faction]} voice/EVA script (spec 25 §5.3); drafted by a local model, "
                    "review by ear.\n" + yaml.safe_dump(data, allow_unicode=True, sort_keys=True, width=200))
    print("lines", faction, unit)
