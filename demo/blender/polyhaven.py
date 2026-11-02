import json
import urllib.request
from pathlib import Path

TEXTURE_DIR = Path(__file__).resolve().parent.parent / "assets" / "textures"
API = "https://api.polyhaven.com"
# api.polyhaven.com answers 403 to urllib's default User-Agent.
HEADERS = {"User-Agent": "evac-layer-demo/0.1 (+https://github.com/rettuce/evac-layer)"}
MAPS = {"diffuse": "Diffuse", "rough": "Rough", "normal": "nor_gl"}


def _get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS)) as response:
        return response.read()


def fetch_texture(asset_id, resolution="2k"):
    folder = TEXTURE_DIR / asset_id
    meta_path = folder / "meta.json"
    if meta_path.exists():
        meta = json.loads(meta_path.read_text())
    else:
        folder.mkdir(parents=True, exist_ok=True)
        files = json.loads(_get(f"{API}/files/{asset_id}"))
        info = json.loads(_get(f"{API}/info/{asset_id}"))
        maps = {}
        for key, api_key in MAPS.items():
            url = files[api_key][resolution]["jpg"]["url"]
            target = folder / Path(url).name
            target.write_bytes(_get(url))
            maps[key] = target.name
        width_mm, height_mm = info["dimensions"]
        meta = {
            "id": asset_id,
            "authors": sorted(info["authors"]),
            "size_m": [width_mm / 1000, height_mm / 1000],
            "maps": maps,
            "license": "CC0",
        }
        meta_path.write_text(json.dumps(meta, indent=2))
    meta["paths"] = {key: folder / name for key, name in meta["maps"].items()}
    return meta
