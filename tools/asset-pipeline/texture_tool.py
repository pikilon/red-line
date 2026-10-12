#!/usr/bin/env python3
"""Texture candidate tool for the local ComfyUI (D-07). Run with the ComfyUI venv:
  ~/.local/share/comfyui/.venv/bin/python texture_tool.py <command> ...

  list                          ids, kind and priority of every resource in textures.yaml
  show ID                       the resource definition (what a judge needs to know)
  generate ID --attempt N [--extra TEXT] [--neg-extra TEXT]
                                one image: generate, make seamless, match the palette,
                                write attempt-N.png, a 2x2 tile preview, a context preview
                                and metrics (JSON on stdout)
  accept ID --attempt N         copy the pick to final/ID.png (+ 256 and 512)
  apply ID                      copy final/ID-512.png into $RED_LINE_APPLY_DIR (client/public/textures of a checkout)
  sheet                         build review.html with every attempt and verdict

Output root: $RED_LINE_TEXTURES_DIR (default /Volumes/Externo Mac SSD/red-line-textures).
"""
import argparse, colorsys, html, json, os, shutil, sys, time, urllib.request
import numpy as np
import yaml
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get("RED_LINE_TEXTURES_DIR", "/Volumes/Externo Mac SSD/red-line-textures")
URL = "http://127.0.0.1:8188"
COMFY_OUT = os.path.expanduser("~/.local/share/comfyui/ComfyUI/output")
MODELS = "/Volumes/Externo Mac SSD/red-line-models"
MASTER = 1024


def load():
    return yaml.safe_load(open(os.path.join(HERE, "textures.yaml")))


def find(cfg, rid):
    for r in cfg["resources"]:
        if r["id"] == rid:
            return r
    sys.exit(f"unknown resource {rid}")


def hex_rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def flux_ready():
    f = os.path.join(MODELS, "unet", "flux1-schnell.safetensors")
    return os.path.exists(f) and os.path.getsize(f) >= 23782506688


def workflow(model, prompt, negative, seed):
    if model == "sdxl":
        return {
            "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "sd_xl_base_1.0.safetensors"}},
            "2": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["1", 1]}},
            "3": {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": ["1", 1]}},
            "4": {"class_type": "EmptyLatentImage", "inputs": {"width": MASTER, "height": MASTER, "batch_size": 1}},
            "5": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "positive": ["2", 0], "negative": ["3", 0],
                  "latent_image": ["4", 0], "seed": seed, "steps": 25, "cfg": 7, "sampler_name": "dpmpp_2m",
                  "scheduler": "karras", "denoise": 1}},
            "6": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["1", 2]}},
            "7": {"class_type": "SaveImage", "inputs": {"images": ["6", 0], "filename_prefix": "tex"}},
        }
    return {  # FLUX.1 schnell: 4 steps, no negative prompt (zeroed conditioning)
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "flux1-schnell.safetensors", "weight_dtype": "default"}},
        "2": {"class_type": "DualCLIPLoader", "inputs": {"clip_name1": "clip_l.safetensors", "clip_name2": "t5xxl_fp16.safetensors", "type": "flux"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "ae.safetensors"}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["2", 0]}},
        "5": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["4", 0]}},
        "6": {"class_type": "EmptySD3LatentImage", "inputs": {"width": MASTER, "height": MASTER, "batch_size": 1}},
        "7": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "positive": ["4", 0], "negative": ["5", 0],
              "latent_image": ["6", 0], "seed": seed, "steps": 4, "cfg": 1, "sampler_name": "euler",
              "scheduler": "simple", "denoise": 1}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["3", 0]}},
        "9": {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": "tex"}},
    }


def run_comfy(wf):
    req = urllib.request.Request(f"{URL}/prompt", json.dumps({"prompt": wf}).encode(), {"Content-Type": "application/json"})
    pid = json.load(urllib.request.urlopen(req))["prompt_id"]
    while True:
        h = json.load(urllib.request.urlopen(f"{URL}/history/{pid}"))
        if pid in h:
            break
        time.sleep(2)
    if h[pid]["status"]["status_str"] != "success":
        sys.exit(f"ComfyUI failed: {json.dumps(h[pid]['status'])[:400]}")
    img = next(iter(h[pid]["outputs"].values()))["images"][0]
    return Image.open(os.path.join(COMFY_OUT, img["subfolder"], img["filename"])).convert("RGB")


def smooth(t):
    return t * t * (3 - 2 * t)


def make_seamless(a):
    """Blend the image with a half-rolled copy so the wrap-around edges match."""
    h, w, _ = a.shape
    rolled = np.roll(a, (h // 2, w // 2), axis=(0, 1))
    wx = smooth(1 - np.abs(np.linspace(-1, 1, w)))
    wy = smooth(1 - np.abs(np.linspace(-1, 1, h)))
    m = (wy[:, None] * wx[None, :])[..., None]
    return a * m + rolled * (1 - m)


def match_palette(a, target, strength=0.85):
    """Move the mean colour toward the game's palette, keep the texture's contrast."""
    mean = a.reshape(-1, 3).mean(0)
    shifted = a + (target - mean)
    return np.clip(a * (1 - strength) + shifted * strength, 0, 255)


def metrics(a, target):
    edge = lambda p, q: float(np.abs(p - q).mean())
    adj = float(np.abs(a[:, 1:] - a[:, :-1]).mean())
    seam = max(edge(a[:, 0], a[:, -1]), edge(a[0], a[-1]))
    lum = a.mean(2)
    blocks = lum.reshape(8, a.shape[0] // 8, 8, a.shape[1] // 8).mean((1, 3))
    return {
        "seam_error": round(seam, 2), "neighbour_pixel_diff": round(adj, 2),
        "mean_rgb": [round(float(x)) for x in a.reshape(-1, 3).mean(0)],
        "target_rgb": [round(float(x)) for x in target],
        "colour_distance": round(float(np.linalg.norm(a.reshape(-1, 3).mean(0) - target)), 1),
        "contrast_std": round(float(lum.std()), 1),
        "large_scale_variation": round(float(blocks.std()), 1),
    }


def tile2(img):
    h = img.size[0] // 2
    small = img.resize((h, h), Image.LANCZOS)
    out = Image.new("RGB", (h * 2, h * 2))
    for x in (0, h):
        for y in (0, h):
            out.paste(small, (x, y))
    return out


def noise_mask(size, seed, cells=6):
    rng = np.random.default_rng(seed)
    g = rng.random((cells + 1, cells + 1)).astype(np.float32)
    g[-1], g[:, -1] = g[0], g[:, 0]
    im = Image.fromarray((g * 255).astype(np.uint8)).resize((size, size), Image.BICUBIC)
    n = np.asarray(im, dtype=np.float32) / 255
    return np.clip((n - 0.45) / 0.2, 0, 1)


def context_preview(rid, res, tex, run):
    """How the candidate looks in the game: over grass (dirt patches, rock block)."""
    base_id = res.get("neighbour_base")
    if not base_id:
        return None
    final = os.path.join(ROOT, "final", f"{base_id}.png")
    size = 1024
    if os.path.exists(final):
        base = np.asarray(Image.open(final).convert("RGB").resize((size // 2, size // 2)), dtype=np.float32)
        base = np.tile(base, (2, 2, 1))
    else:
        base = np.ones((size, size, 3), np.float32) * hex_rgb("#3f6b2a")
    cand = np.tile(np.asarray(Image.fromarray(tex.astype(np.uint8)).resize((size // 2, size // 2)), dtype=np.float32), (2, 2, 1))
    if rid == "rock":
        m = np.zeros((size, size, 1), np.float32)
        m[300:700, 300:700] = 1
    else:
        m = smooth_mask(noise_mask(size, 7))[..., None]
    out = base * (1 - m) + cand * m
    path = os.path.join(run, "context.png")
    Image.fromarray(out.astype(np.uint8)).save(path)
    return path


def smooth_mask(m):
    return smooth(m)


def cmd_generate(a):
    cfg = load()
    res = find(cfg, a.id)
    run = os.path.join(ROOT, "runs", a.id)
    os.makedirs(run, exist_ok=True)
    if not flux_ready():
        sys.exit("FLUX schnell is not fully downloaded yet")
    model = "flux"
    prompt = f"Seamless tileable top-down texture: {res['subject']}. {cfg['style']}. {a.extra}".strip()
    negative = f"{cfg['negative']}, {a.neg_extra}".strip(", ")
    seed = 1000 * (cfg["resources"].index(res) + 1) + a.attempt
    img = run_comfy(workflow(model, prompt, negative, seed))
    arr = np.asarray(img.resize((MASTER, MASTER), Image.LANCZOS), dtype=np.float32)
    arr = make_seamless(arr)
    arr = match_palette(arr, hex_rgb(res["target_mean"]))
    m = metrics(arr, hex_rgb(res["target_mean"]))
    path = os.path.join(run, f"attempt-{a.attempt}.png")
    Image.fromarray(arr.astype(np.uint8)).save(path)
    tile = os.path.join(run, f"attempt-{a.attempt}-tile.png")
    tile2(Image.open(path)).save(tile)
    ctx = context_preview(a.id, res, arr, run)
    if ctx:
        os.replace(ctx, os.path.join(run, f"attempt-{a.attempt}-context.png"))
        ctx = os.path.join(run, f"attempt-{a.attempt}-context.png")
    record = {"id": a.id, "attempt": a.attempt, "model": model, "seed": seed, "prompt": prompt, "negative": negative,
              "image": path, "tile_preview": tile, "context_preview": ctx, "metrics": m}
    json.dump(record, open(os.path.join(run, f"attempt-{a.attempt}.json"), "w"), indent=1)
    print(json.dumps(record, indent=1))


def cmd_accept(a):
    src = os.path.join(ROOT, "runs", a.id, f"attempt-{a.attempt}.png")
    os.makedirs(os.path.join(ROOT, "final"), exist_ok=True)
    img = Image.open(src)
    img.save(os.path.join(ROOT, "final", f"{a.id}.png"))
    for s in (256, 512):
        img.resize((s, s), Image.LANCZOS).save(os.path.join(ROOT, "final", f"{a.id}-{s}.png"))
    print("accepted", a.id, a.attempt)


def cmd_apply(a):
    """Copy the accepted 512 px texture into the game checkout's public folder."""
    dest = os.environ.get("RED_LINE_APPLY_DIR")
    if not dest:
        sys.exit("set RED_LINE_APPLY_DIR to <checkout>/client/public/textures")
    src = os.path.join(ROOT, "final", f"{a.id}-512.png")
    if not os.path.exists(src):
        sys.exit(f"{a.id} is not accepted yet (no {src})")
    os.makedirs(dest, exist_ok=True)
    res = find(load(), a.id)
    if res["kind"] == "material":
        # Model materials multiply the faction's vertex colour: store a detail map (mean 0.9)
        # so the model keeps its colour instead of getting darker (colour x colour).
        arr = np.asarray(Image.open(src).convert("RGB"), dtype=np.float32)
        detail = np.clip(arr / np.maximum(arr.reshape(-1, 3).mean(0), 1.0) * 0.9 * 255, 0, 255)
        Image.fromarray(detail.astype(np.uint8)).save(os.path.join(dest, f"{a.id}.png"))
    else:
        shutil.copy(src, os.path.join(dest, f"{a.id}.png"))
    print("applied", a.id, "->", os.path.join(dest, f"{a.id}.png"))


def cmd_sheet(_):
    cfg = load()
    rows = []
    for r in cfg["resources"]:
        run = os.path.join(ROOT, "runs", r["id"])
        verdict = os.path.join(run, "verdict.json")
        v = json.load(open(verdict)) if os.path.exists(verdict) else {}
        cells = []
        if os.path.isdir(run):
            for f in sorted(os.listdir(run)):
                if f.endswith("-tile.png"):
                    n = f.split("-")[1]
                    note = html.escape(str(v.get("attempts", {}).get(n, "")))
                    cells.append(f"<figure><img src='runs/{r['id']}/{f}'><figcaption>#{n} {note}</figcaption></figure>")
        pick = f"<b>Pick: attempt {v['pick']}</b> — {html.escape(v.get('reason', ''))}" if "pick" in v else "<i>no pick</i>"
        rows.append(f"<section><h2>{r['id']} <small>{r['kind']}</small></h2><p>{html.escape(r['used_by'])}</p><p>{pick}</p><div class='g'>{''.join(cells)}</div></section>")
    open(os.path.join(ROOT, "review.html"), "w").write(
        "<meta charset=utf-8><title>Texture review</title><style>body{background:#111;color:#ddd;font:14px sans-serif;margin:20px}"
        ".g{display:flex;gap:10px;flex-wrap:wrap}img{width:300px;image-rendering:auto}figure{margin:0}small{color:#888}</style>"
        + "".join(rows))
    print(os.path.join(ROOT, "review.html"))


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    s = sub.add_parser("show"); s.add_argument("id")
    g = sub.add_parser("generate"); g.add_argument("id"); g.add_argument("--attempt", type=int, required=True)
    g.add_argument("--extra", default=""); g.add_argument("--neg-extra", default="")
    c = sub.add_parser("accept"); c.add_argument("id"); c.add_argument("--attempt", type=int, required=True)
    ap = sub.add_parser("apply"); ap.add_argument("id")
    sub.add_parser("sheet")
    a = p.parse_args()
    cfg = load()
    if a.cmd == "list":
        for r in cfg["resources"]:
            print(r["id"], r["kind"], "priority", r.get("priority", 1))
    elif a.cmd == "show":
        print(yaml.safe_dump(find(cfg, a.id), sort_keys=False, allow_unicode=True))
    elif a.cmd == "generate":
        cmd_generate(a)
    elif a.cmd == "accept":
        cmd_accept(a)
    elif a.cmd == "apply":
        cmd_apply(a)
    else:
        cmd_sheet(a)


main()
