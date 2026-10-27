"""Speaks data/audio/lines/*.yaml with Piper (uk_UA / ru_RU) into the raw folder."""
import json, wave, yaml
from piper import PiperVoice
from common import REPO, ROOT, inventory, raw_path, seed, targets, write_sidecar

M = ROOT / "models/piper"
UK = M / "uk/uk_UA/ukrainian_tts/medium/uk_UA-ukrainian_tts-medium.onnx"
RU = {n: M / f"ru/ru_RU/{n}/medium/ru_RU-{n}-medium.onnx" for n in ("denis", "dmitri", "ruslan", "irina")}
cache = {}


def voice(path):
    if path not in cache:
        cache[path] = PiperVoice.load(str(path))
    return cache[path]


def speak(path, text, out, speaker=None, length=1.0):
    v = voice(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(out), "wb") as w:
        try:
            from piper import SynthesisConfig
            v.synthesize_wav(text, w, syn_config=SynthesisConfig(speaker_id=speaker, length_scale=length))
        except ImportError:
            v.synthesize(text, w, speaker_id=speaker, length_scale=length)


def uk_speaker(name):
    ids = json.loads(UK.with_suffix(".onnx.json").read_text()).get("speaker_id_map", {})
    return ids.get(name, 0)


lines = {f: yaml.safe_load((REPO / f"data/audio/lines/{f}.yaml").read_text()) or {}
         for f in ("ukraine", "russia", "common") if (REPO / f"data/audio/lines/{f}.yaml").exists()}
for ev, e in inventory().items():
    if e["kind"] not in ("voice", "eva"):
        continue
    for t in targets(e):
        parts = t.split("/")
        faction, unit = (parts[2], parts[3]) if e["kind"] == "voice" else (parts[2], "eva")
        name, n = parts[-1][:-5].rsplit("_", 1)
        line = next((l for l in lines.get(faction, {}).get(f"{unit}.{name}", []) if l["id"] == int(n)), None)
        out = raw_path(t)
        if not line or out.exists():
            continue
        length = {"underFire": 0.8, "die": 0.85, "attack": 0.88}.get(name, 0.92)
        if faction == "russia":
            pick = "irina" if unit == "eva" else ("denis", "dmitri", "ruslan")[seed(unit) % 3]
            model, spk = RU[pick], None
        else:
            model, spk = UK, uk_speaker("tetiana" if unit == "eva" else "mykyta")
            pick = "tetiana" if unit == "eva" else "mykyta"
        # The Ukrainian model is character-based and has no uppercase symbols.
        text = line["text"].lower() if model == UK else line["text"]
        speak(model, text, out, spk, 1.0 if unit == "eva" else length)
        write_sidecar(t, event=ev, tool="piper", voice=pick, text=line["text"], explicit=line["explicit"])
print("voices done")
