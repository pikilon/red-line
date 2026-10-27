"""Transcribes the local reference voice/EVA lines with Whisper, so new lines can be
written for the same situations. Text only: the audio never feeds a generator (spec 25 §4.2)."""
import json, mlx_whisper
from common import REPO, ROOT, inventory

pack = json.loads((REPO / ".local/audio-ref-webm/pack.json").read_text())["files"]
by_event = {}
for rel, info in pack.items():
    for key, val in info.items():
        if "event" in key.lower() and isinstance(val, list):
            for ev in val:
                by_event.setdefault(ev, []).append(rel)
out_path = ROOT / "lines/transcripts.json"
out = json.loads(out_path.read_text()) if out_path.exists() else {}
for ev, entry in inventory().items():
    if entry["kind"] not in ("voice", "eva") or ev in out:
        continue
    texts = []
    for rel in by_event.get(ev, [])[:8]:
        r = mlx_whisper.transcribe(str(REPO / ".local/audio-ref-webm" / rel),
                                   path_or_hf_repo="mlx-community/whisper-large-v3-turbo", language="en")
        texts.append(r["text"].strip())
    out[ev] = texts
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=1))
print("transcribed", len(out))
