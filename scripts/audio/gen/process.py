"""Raw generator output -> shipped Opus/WebM under client/public/audio (spec 25 §4.5 step 3, §12).
Raw files are never modified: rerun this to redo or undo any effect."""
import json, subprocess, sys
from common import RAW, REPO, inventory, targets

PUB = REPO / "client/public/audio"
force = "--force" in sys.argv


def dur(p):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                          "-of", "csv=p=0", str(p)]).strip() or 0)


def loop_chain(src, x):
    """Seamless loop: the tail crossfades into the head (start at x, end with the first x seconds)."""
    L = dur(src)
    return (f"[0:a]atrim={x}:{L},asetpts=PTS-STARTPTS[a];[0:a]atrim=0:{x},asetpts=PTS-STARTPTS[b];"
            f"[a][b]acrossfade=d={x}:c1=tri:c2=tri,")


TRIM = "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,"
# Longest one-shot per event family (seconds). Zero Hour's samples are short; long
# generated tails overlap in a fight and read as a noise bed.
CAPS = [("weapon.", 1.4), ("impact.", 0.9), ("explosion.small", 1.8), ("explosion.medium", 2.6),
        ("explosion.large", 3.5), ("explosion.", 2.5), ("move.", 1.8), ("vehicle.", 1.8),
        ("building.", 3.0), ("ui.", 0.5)]


def cap(ev, secs):
    return min(secs, next((c for prefix, c in CAPS if ev.startswith(prefix)), 3.0))


RADIO = "highpass=f=300,lowpass=f=3400,acompressor=threshold=-18dB:ratio=4:makeup=4,asoftclip=type=tanh,"
done = []
for ev, e in inventory().items():
    for t in targets(e):
        srcs = sorted(p for p in (RAW / t).parent.glob((RAW / t).stem + ".*") if p.suffix != ".json")
        if not srcs:
            continue
        src, out = srcs[0], PUB / t[len("audio/"):]
        done.append((ev, t))
        if out.exists() and not force:
            continue
        k = e["kind"]
        if k == "voice":
            chain, br, ch = TRIM + RADIO + "loudnorm=I=-20:TP=-2,", "32k", 1
        elif k == "eva":
            chain, br, ch = TRIM + "highpass=f=180,lowpass=f=6000,acompressor=threshold=-18dB:ratio=3,loudnorm=I=-20:TP=-2,", "32k", 1
        elif k == "music":
            chain, br, ch = (loop_chain(src, 4) if e.get("loop") else "") + "loudnorm=I=-16:TP=-1.5,", "96k", 2
        elif k == "ambient":
            chain, br, ch = loop_chain(src, 2) + "loudnorm=I=-24:TP=-3,", "96k", 2
        else:
            secs = min(cap(ev, e.get("seconds") or 2), dur(src))
            fade = max(0.05, secs * 0.35)
            chain, br, ch = ("afftdn=nf=-35," + TRIM + f"atrim=0:{secs},loudnorm=I=-18:TP=-3,"
                             f"afade=t=out:st={secs - fade:.3f}:d={fade:.3f},"), "64k", 1
        out.parent.mkdir(parents=True, exist_ok=True)
        flt = chain.rstrip(",")
        args = ["ffmpeg", "-v", "error", "-y", "-i", str(src)]
        args += ["-filter_complex", flt] if "[0:a]" in flt else ["-af", flt]
        args += ["-ac", str(ch), "-ar", "48000", "-c:a", "libopus", "-b:a", br, str(out)]
        subprocess.run(args, check=True)

manifest, explicit = {}, []
for ev, t in done:
    manifest.setdefault(ev, []).append("/" + t)
    side = (RAW / t).with_suffix(".json")
    if side.exists() and json.loads(side.read_text()).get("explicit"):
        explicit.append("/" + t)
(PUB / "manifest.json").write_text(json.dumps({"version": 1, "events": dict(sorted(manifest.items())),
                                               "explicit": sorted(explicit)}, indent=1) + "\n")
# Same formatting as the repo check, so CI does not reject the generated file.
subprocess.run(["npx", "biome", "format", "--write", "public/audio/manifest.json"], cwd=REPO / "client", check=False,
               capture_output=True)
print("processed", len(done), "files,", len(manifest), "events")
