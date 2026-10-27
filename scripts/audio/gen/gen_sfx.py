"""Text-to-audio for SFX, UI and ambient entries with TangoFlux (local, MPS)."""
import torch, torchaudio
from tangoflux import TangoFluxInference
from common import inventory, raw_path, seed, targets, write_sidecar

dev = "cpu"  # MPS lacks float64, which the TangoFlux sampler uses
try:
    model = TangoFluxInference(name="declare-lab/TangoFlux", device=dev)
except TypeError:
    model = TangoFluxInference(name="declare-lab/TangoFlux")
for ev, e in inventory().items():
    if e["kind"] not in ("sfx", "ui", "ambient") or not e.get("prompt"):
        continue
    dur = 30 if e.get("loop") else max(1, min(30, round((e.get("seconds") or 2) + 0.5)))
    prompt = e["prompt"] + ", realistic, clean recording, no music, no speech"
    for t in targets(e):
        out = raw_path(t)
        if out.exists():
            continue
        s = seed(t)
        torch.manual_seed(s)
        audio = model.generate(prompt, steps=50, duration=dur)
        out.parent.mkdir(parents=True, exist_ok=True)
        torchaudio.save(str(out), audio.float().cpu(), 44100)
        write_sidecar(t, event=ev, tool="TangoFlux", model="declare-lab/TangoFlux", prompt=prompt, seed=s,
                      steps=50, seconds=dur)
        print("sfx", t, flush=True)
