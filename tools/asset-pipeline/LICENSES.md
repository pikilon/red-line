# Licences of the local asset tools (D-07)

Generated assets must be redistributable under CC BY-SA. Record the licence of
every tool and model here when it is installed.

| Tool or model | Licence | Notes |
|---|---|---|
| ComfyUI v0.39.0 | GPL-3.0 | Tool only; it is not distributed with the game. |
| SDXL base 1.0 (`sd_xl_base_1.0.safetensors`) | CreativeML OpenRAIL++-M | Generated images may be used and redistributed; the licence's use restrictions (no harmful uses) must be passed on. |
| FLUX.1 schnell (`flux1-schnell.safetensors`, Comfy-Org mirror) | Apache-2.0 | Clean for CC BY-SA outputs. |
| FLUX `ae.safetensors` (VAE) | Apache-2.0 | From the FLUX.1 schnell release. |
| `clip_l.safetensors`, `t5xxl_fp16.safetensors` | MIT, Apache-2.0 | Text encoders used by FLUX. |

ComfyUI is installed machine-wide (`~/.local/share/comfyui`, command `comfyui`). Weights live outside the repository (`RED_LINE_MODELS_DIR`, an external disk) and are never committed.

## Third-party source assets (outside the repository)

The asset library lives in `~/Pictures/c&c assets`, never in the repository. Its
inventory is regenerated with `99_research/asset-sourcing/record.py`, which writes
`MANIFEST.md` and `manifest.json` (per-file SHA-256 for the CC0 archives, git
commit for 0 A.D.).

| Source | Licence | Notes |
|---|---|---|
| 0 A.D. art (`0ad/0ad`, sparse checkout) | CC-BY-SA-3.0 | Copyright (C) 2009 Wildfire Games. Terrain textures (temperate, steppe), terrain definitions, actors/materials metadata, gaia props. Attribution and share-alike required. Some bundled textures derive from CGTextures under special permission. |
| Poly Haven textures and models | CC0-1.0 | Public domain: no attribution, redistribution and commercial use permitted. Fetched through the public API, which requires a user-agent identifying the tool. |
| Kenney 3D kits | CC0-1.0 | Low-poly game kits; they ship `.glb`, directly loadable by Three.js. |

### Assets shipped from the library

| Game file | Source (library path) | Licence |
|---|---|---|
| `client/public/textures/ru-wall.webp`, `ua-wall.webp` | `04_CC0_Public_Domain/polyhaven/models/modular_factory_facade/textures/modular_factory_facade_brick_diff_1k.jpg` (Poly Haven "Modular Factory Facade") | CC0-1.0 |
| `client/public/textures/ru-roof.webp`, `ua-roof.webp` | `04_CC0_Public_Domain/polyhaven/models/modular_factory_facade/textures/modular_factory_facade_garage_diff_1k.jpg` (rows 442..732) | CC0-1.0 |

Recoloured and cropped by `tools/asset-pipeline/facades.py` (spec 16 §2).

### Do not use EA art

EA's GPL-3.0 releases (`01_EA_GPL_Source_Releases`) contain source code, `.map`
files, XML data, shaders and one map-preview `.tga` per map. They contain **no**
unit or building meshes, no unit textures or sprites and none of the Remastered
Collection's 4K artwork, which EA never released. OpenRA repackages EA material
and its Tiberian Dawn HD mod reads Remastered assets out of the player's own
purchase for the same reason.

The freeware CDs (`03_Freeware_Original_Game_CDs`) and OpenRA's bundled content
(`02_OpenRA`) are therefore study/play-only: freeware is not a licence to reuse
assets in another game, and EA's modding guidelines cover mods *of those games*.
Shipping any of it would break D-01 and D-02 and make the game
non-redistributable. `01` stays fair game to study for behaviour, which D-02
already allows.
