"""Music with ACE-Step v1 3.5B through the local ComfyUI API (127.0.0.1:8188).
Style follows the owner's pick: Red Alert 2 industrial metal / electronic."""
import json, shutil, time, urllib.request, uuid
from common import inventory, raw_path, seed, targets, write_sidecar

API = "http://127.0.0.1:8188"
COMFY_OUT = __import__("pathlib").Path.home() / ".local/share/comfyui/ComfyUI/output"
BASE = "instrumental, industrial metal, electronic rock, Red Alert 2 style soundtrack, Frank Klepacki style, " \
       "distorted electric guitar riffs, heavy synth bass, punchy drum machine, military"
STATE = {
    "menu": "menacing anthem, mid tempo, 110 bpm, big intro riff, dark synth pads",
    "calm": "brooding groove, 95 bpm, sparse guitars, pulsing synth arpeggio, tension building",
    "combat": "aggressive, fast, 140 bpm, relentless double kick, chugging riffs, alarm synth leads",
    "victory": "triumphant, 120 bpm, anthemic power chords, uplifting synth lead",
    "defeat": "slow, 70 bpm, somber, heavy doom riff, fading synth drone",
}
FACTION = {"ukraine": "ukrainian folk melody motif on synth lead", "russia": "soviet male choir pad, minor key march motif"}


def post(path, data):
    req = urllib.request.Request(API + path, json.dumps(data).encode(), {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))


def get(path):
    return json.load(urllib.request.urlopen(API + path))


for ev, e in inventory().items():
    if e["kind"] != "music":
        continue
    state = next((k for k in STATE if k in ev), "calm")
    faction = next((v for k, v in FACTION.items() if k in ev), "")
    tags = ", ".join(x for x in (BASE, STATE[state], faction) if x)
    secs = max(30, min(180, round(e.get("seconds") or 90)))
    for t in targets(e):
        out = raw_path(t)
        if any(p.suffix != ".json" for p in out.parent.glob(out.stem + ".*")):
            continue  # ComfyUI saves .flac, so any container counts
        s, prefix = seed(t), "redline_" + uuid.uuid4().hex[:8]
        g = {
            "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "ace_step_v1_3.5b.safetensors"}},
            "2": {"class_type": "ModelSamplingSD3", "inputs": {"model": ["1", 0], "shift": 5.0}},
            "3": {"class_type": "TextEncodeAceStepAudio", "inputs": {"clip": ["1", 1], "tags": tags,
                                                                      "lyrics": "[instrumental]", "lyrics_strength": 0.99}},
            "4": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["3", 0]}},
            "5": {"class_type": "EmptyAceStepLatentAudio", "inputs": {"seconds": secs, "batch_size": 1}},
            "6": {"class_type": "KSampler", "inputs": {"model": ["2", 0], "positive": ["3", 0], "negative": ["4", 0],
                                                        "latent_image": ["5", 0], "seed": s, "steps": 50, "cfg": 5.0,
                                                        "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
            "7": {"class_type": "VAEDecodeAudio", "inputs": {"samples": ["6", 0], "vae": ["1", 2]}},
            "8": {"class_type": "SaveAudio", "inputs": {"audio": ["7", 0], "filename_prefix": prefix}},
        }
        pid = post("/prompt", {"prompt": g})["prompt_id"]
        while True:
            h = get(f"/history/{pid}").get(pid)
            if h and h.get("status", {}).get("completed") is not None:
                break
            time.sleep(10)
        f = h["outputs"]["8"]["audio"][0]
        src = COMFY_OUT / f.get("subfolder", "") / f["filename"]
        out.parent.mkdir(parents=True, exist_ok=True)
        ext = src.suffix
        shutil.copy(src, out.with_suffix(ext))  # kept in its native container; process.py decodes any
        write_sidecar(t, event=ev, tool="ComfyUI ACE-Step v1 3.5B", tags=tags, seed=s, steps=50, seconds=secs,
                      file=out.with_suffix(ext).name)
        print("music", t, flush=True)
