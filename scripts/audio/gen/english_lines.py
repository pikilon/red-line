"""Rewrites data/audio/lines/<faction>.yaml into English spoken with a Slavic accent
(spec 25 §2 difference 3, owner 2026-11-04). The local LM Studio model writes the English
line (`text`) and a phonetic respelling in the speaker's alphabet (`speak`): Russian Cyrillic
for Russia, Ukrainian Cyrillic for Ukraine and common. Piper's Russian/Ukrainian voices then
read `speak`, which gives English with a native accent. Lines that already have `speak` are
kept unless their key is passed with --redo. Local only.

  python english_lines.py <faction> [--redo key1,key2]
"""
import json, sys, yaml
from common import REPO
from write_lines import ask

faction = sys.argv[1]
redo = set(sys.argv[sys.argv.index("--redo") + 1].split(",")) if "--redo" in sys.argv else set()
ALPHABET = {
    "russia": "Russian Cyrillic (as a Russian would read it aloud, e.g. 'Moving out, commander!' -> "
              "'Мувинг аут, командер!', 'Target destroyed' -> 'Таргет дестройд')",
    "ukraine": "Ukrainian Cyrillic, all lowercase (as a Ukrainian would read it aloud, e.g. 'Moving out, "
               "commander!' -> 'мувінг аут, командер!', 'Target destroyed' -> 'таргет дестройд')",
}
ALPHABET["common"] = ALPHABET["ukraine"]
SIDE = {"russia": "a Russian", "ukraine": "a Ukrainian", "common": "a Ukrainian"}

path = REPO / f"data/audio/lines/{faction}.yaml"
data = yaml.safe_load(path.read_text())
for key, lines in data.items():
    if key not in redo and all("speak" in l for l in lines):
        continue
    unit, event = key.split(".", 1)
    eva = unit == "eva"
    who = ("the base EVA computer, calm, formal military, NEVER any profanity" if eva else
           f"{SIDE[faction]} soldier/crew of unit '{unit}' talking on the radio")
    src = [{"text": l["text"], "explicit": l["explicit"]} for l in lines]
    res = ask(
        f"These are game voice lines for '{key}' ({faction} side), said by {who}. Rewrite each one as a "
        "short natural ENGLISH line (1-8 words) with the same meaning and mood, the way a Slavic soldier "
        "speaking English on the radio would say it. Lines marked explicit keep strong English profanity "
        "(fuck, shit, bastards...); the others stay clean. Then give `speak`: the English line respelled "
        f"phonetically in {ALPHABET[faction]}, so a {faction if faction != 'common' else 'Ukrainian'} "
        "text-to-speech voice reads it as accented English. Keep the punctuation. Return JSON "
        '{"lines": [{"text": "...", "speak": "..."}, ...]} with exactly ' + str(len(lines)) + " items in order.\n"
        + json.dumps(src, ensure_ascii=False))
    out = res.get("lines") or []
    if len(out) != len(lines) or not all(isinstance(o, dict) and o.get("text") and o.get("speak") for o in out):
        print("!! bad answer, skipped", key, flush=True)
        continue
    for l, o in zip(lines, out):
        l["text"], l["speak"] = o["text"].strip(), o["speak"].strip()
        if faction != "russia":
            l["speak"] = l["speak"].lower()
    print("en", faction, key, flush=True)
    path.write_text(f"# {faction.capitalize()} voice/EVA script in Slavic-accented English (spec 25 §5.3): `text` "
                    "is the line, `speak` its phonetic respelling for the TTS voice. Drafted by a local model, "
                    "review by ear.\n" + yaml.safe_dump(data, allow_unicode=True, sort_keys=True, width=200))
print("english lines done", faction)
