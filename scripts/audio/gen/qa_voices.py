"""Local voice QA: Gemma rewrites unnatural lines (changed takes are re-voiced),
then Whisper checks every shipped voice/EVA file is intelligible.
Writes AUDIO_GEN_ROOT/lines/qa.json. Local only."""
import difflib, json, sys, yaml
from common import REPO, ROOT, raw_path
from write_lines import ask, LANG

if "--review" in sys.argv:
    for faction in ("ukraine", "russia", "common"):
        path = REPO / f"data/audio/lines/{faction}.yaml"
        data = yaml.safe_load(path.read_text())
        for key, lines in data.items():
            res = ask(f"Review these {LANG[faction]} game voice lines for '{key}' ({faction} side). Fix any line "
                      "that is unnatural, ungrammatical, illogical or not how a real soldier/EVA would say it; keep "
                      "good lines unchanged, keep profanity where present, keep the count. Return JSON "
                      '{"lines": ["..."]}.\n' + json.dumps([l["text"] for l in lines], ensure_ascii=False))
            new = res.get("lines") or []
            for l, text in zip(lines, new):
                if isinstance(text, str) and text.strip() and text.strip() != l["text"]:
                    unit, event = key.split(".", 1)
                    t = (f"audio/eva/{faction}/{event}_{l['id']}.webm" if unit == "eva"
                         else f"audio/voice/{faction}/{unit}/{event}_{l['id']}.webm")
                    print("fix", t, l["text"], "->", text.strip(), flush=True)
                    l["text"] = text.strip()
                    for p in (raw_path(t), raw_path(t).with_suffix(".json"), REPO / "client/public" / t):
                        p.unlink(missing_ok=True)
        head = path.read_text().split("\n", 1)[0]
        path.write_text(head + "\n" + yaml.safe_dump(data, allow_unicode=True, sort_keys=True, width=200))

if "--listen" in sys.argv:
    import mlx_whisper
    report, scores = {}, []
    for side in sorted(ROOT.joinpath("raw/audio").rglob("*.json")):
        meta = json.loads(side.read_text())
        if meta.get("tool") != "piper":
            continue
        t = str(side.relative_to(ROOT / "raw")).replace(".json", ".webm")
        lang = "ru" if "/russia/" in t else "uk"
        heard = mlx_whisper.transcribe(str(REPO / "client/public" / t), language=lang,
                                       path_or_hf_repo="mlx-community/whisper-large-v3-turbo")["text"].strip()
        norm = lambda s: "".join(c for c in s.lower() if c.isalnum())
        score = difflib.SequenceMatcher(None, norm(meta["text"]), norm(heard)).ratio()
        scores.append(score)
        report[t] = {"text": meta["text"], "heard": heard, "score": round(score, 2)}
    (ROOT / "lines/qa.json").write_text(json.dumps(report, ensure_ascii=False, indent=1))
    bad = sum(s < 0.6 for s in scores)
    print(f"QA {len(scores)} files, mean {sum(scores)/len(scores):.2f}, below 0.6: {bad}")
