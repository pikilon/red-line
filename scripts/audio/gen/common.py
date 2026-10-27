"""Shared helpers for the local audio generator (spec 25 §4.5). Local only, never in CI."""
import hashlib, json, os, pathlib, yaml

REPO = pathlib.Path(__file__).resolve().parents[3]
ROOT = pathlib.Path(os.environ.get("AUDIO_GEN_ROOT", "/Volumes/Externo Mac SSD/red-line-audio"))
RAW = ROOT / "raw"  # untouched generator output, kept so post-processing can be redone


def inventory():
    return yaml.safe_load((REPO / "data/audio/inventory.yaml").read_text())["entries"]


def targets(entry):
    """Expanded `audio/...webm` targets of one inventory entry, variant 1..n."""
    t, n = entry.get("target"), entry.get("variants") or 0
    return [t.replace("<n>", str(i)) for i in range(1, n + 1)] if t else []


def raw_path(target):
    return RAW / target.replace(".webm", ".wav")


def seed(key):
    return int(hashlib.sha256(key.encode()).hexdigest()[:8], 16)


def write_sidecar(target, **meta):
    p = raw_path(target).with_suffix(".json")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(meta, ensure_ascii=False, indent=1))
