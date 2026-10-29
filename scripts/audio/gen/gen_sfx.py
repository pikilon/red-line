"""Text-to-audio for SFX, UI and ambient entries with TangoFlux (local, MPS)."""
import sys
import torch, torchaudio
from tangoflux import TangoFluxInference
from common import inventory, raw_path, seed, targets, write_sidecar

dev = "cpu"  # MPS lacks float64, which the TangoFlux sampler uses
try:
    model = TangoFluxInference(name="declare-lab/TangoFlux", device=dev)
except TypeError:
    model = TangoFluxInference(name="declare-lab/TangoFlux")


def generate(prompt, seed, duration):
    # TangoFluxInference.generate reseeds with 0, so every take came out identical.
    with torch.no_grad():
        latents = model.model.inference_flow(prompt, duration=duration, num_inference_steps=50,
                                             guidance_scale=4.5, seed=seed)
        wave = model.vae.decode(latents.transpose(2, 1)).sample.cpu()[0]
    return wave[:, :int(duration * model.vae.config.sampling_rate)]


# Optional event ids on the command line regenerate only those events.
only = set(sys.argv[1:])
for ev, e in inventory().items():
    if e["kind"] not in ("sfx", "ui", "ambient") or not e.get("prompt") or (only and ev not in only):
        continue
    dur = min(30, max(8, round(e.get("seconds") or 30))) if e.get("loop") else max(1, min(30, round((e.get("seconds") or 2) + 0.5)))
    # Negations backfire in text-to-audio: "no music" pulls the take toward music.
    prompt = e["prompt"] + ", realistic, clean recording"
    for t in targets(e):
        out = raw_path(t)
        if out.exists():
            continue
        s = seed(t)
        audio = generate(prompt, s, dur)
        out.parent.mkdir(parents=True, exist_ok=True)
        torchaudio.save(str(out), audio.float().cpu(), 44100)
        write_sidecar(t, event=ev, tool="TangoFlux", model="declare-lab/TangoFlux", prompt=prompt, seed=s,
                      steps=50, seconds=dur)
        print("sfx", t, flush=True)
