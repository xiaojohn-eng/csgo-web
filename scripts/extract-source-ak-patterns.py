"""Extract the original pattern textures of every AK-47 paint kit whose style samples one.

The staged original paint-kit catalogue already names the pattern texture — and, where
the original has one, the normal texture — that each finish resolves to. This script
reads those textures out of the original install's own bytes and stores each one
losslessly as PNG, so the finishes beyond the Redline can be composed from their own
artwork rather than from a stand-in.

Which styles it reads from is derived from the exported program data rather than written
here: the styles whose programs declare the pattern sampler. That is the style this port
compiled first (7, the Redline) plus 2 and 5, and it excludes 1 and 4, which read their
colour from their own palette constants and sample no pattern at all.

Nothing is synthesised. A texture this script cannot store losslessly (a float texture,
or one the original stores as several frames) is refused and recorded, not converted.

Run: blender --background --factory-startup --python scripts/extract-source-ak-patterns.py
"""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import re
import runpy
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
CATALOGUE = ROOT / "public/source/csgo-12426148/skins/paint-kits.json"
OUT = ROOT / ".reference-assets/source-exports/ak47-pattern-inputs"
WEAPON = "weapon_ak47"
# The one program this port compiled from the original's own tokens and checked against them.
VERIFIED_STYLE = 7
# The sampler the original's permutations read a finish's own pattern at.
PATTERN_SAMPLER = 8
PROGRAM_DATA = ROOT / "game/source-customweapon-program-data.ts"
PROGRAM_RECEIPT = ROOT / ".reference-assets/source-exports/customweapon-style-programs/evidence.json"

OUT.mkdir(parents=True, exist_ok=True)
(OUT / "inputs.json").write_text(json.dumps({
    "status": "running", "startedAt": datetime.now(timezone.utc).isoformat()}) + "\n")

helpers = runpy.run_path(str(ROOT / "scripts/inventory-source-items.py"))
environment = helpers["initialize"]()
source = helpers["Sources"]()
from SourceIO.library.utils.pylib.vtf import load_vtf_texture
from SourceIO.library.utils.pylib.image import encode_png
import numpy as np


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fail(message: str):
    raise SystemExit("extract-source-ak-patterns: " + message)


catalogue_bytes = CATALOGUE.read_bytes()
catalogue = json.loads(catalogue_bytes)
weapon = next((entry for entry in catalogue["weapons"] if entry["weapon"] == WEAPON), None)
if weapon is None:
    fail(f"the staged catalogue carries no {WEAPON}")

# The finishes this pass is for: those of the styles whose programs read the finish's own
# pattern. That set comes from the exported program data and its receipt, so a style whose
# program cannot be built does not have its artwork staged for nothing.
if not PROGRAM_RECEIPT.exists():
    fail("the customweapon program receipt is not exported")
_evidence = json.loads(PROGRAM_RECEIPT.read_text())
_declared = json.loads(re.search(r"SOURCE_CUSTOMWEAPON_PROGRAM_STYLES = (\[[^\]]*\])",
                                 PROGRAM_DATA.read_text()).group(1))
STYLES = frozenset(
    [VERIFIED_STYLE]
    + [int(style) for style in _declared
       if any(PATTERN_SAMPLER in (row.get("declaredSamplers") or [])
              for row in _evidence["styles"].get(str(style), {}).values() if row.get("present"))])
finishes = [finish for finish in weapon["finishes"] if finish["style"] in STYLES]
if not finishes:
    fail(f"the staged catalogue carries no {WEAPON} finish of styles {sorted(STYLES)}")

# Every texture any of them names, resolved through the original's own verdict. A
# reference the original does not resolve uniquely is refused here rather than guessed.
wanted: dict[str, dict] = {}
refused: list[dict] = []
plan: list[dict] = []
for finish in finishes:
    entry = {"paintKitId": finish["id"], "name": finish["name"],
             "englishName": finish["englishName"], "chineseName": finish["chineseName"]}
    for field in ("pattern", "normal"):
        matches = [reference for reference in finish["textureReferences"] if reference["field"] == field]
        if not matches:
            if field == "pattern":
                refused.append({"paintKitId": finish["id"], "reason": "no original pattern reference"})
            entry[field] = None
            continue
        if len(matches) != 1:
            refused.append({"paintKitId": finish["id"], "reason": f"{len(matches)} original {field} references"})
            entry[field] = None
            continue
        reference = matches[0]
        if reference["resolution"] != "unique" or len(reference["candidates"]) != 1:
            refused.append({"paintKitId": finish["id"],
                            "reason": f"original {field} reference is {reference['resolution']}"})
            entry[field] = None
            continue
        path = reference["candidates"][0]
        if not path.startswith("materials/") or not path.endswith(".vtf"):
            fail(f"paint kit {finish['id']} names a {field} texture that is not an original material: {path}")
        wanted.setdefault(path, {"path": path, "field": field, "paintKitIds": []})
        wanted[path]["paintKitIds"].append(finish["id"])
        entry[field] = path
    plan.append(entry)

if not wanted:
    fail("no original pattern texture was resolved")

# This pass reads exactly the set it has just enumerated, so it declares a bound derived
# from that set rather than the catalogue pass's default. Both are bounds; this one is
# the smaller claim because the list above cannot grow while the pass runs.
enumerated = 0
for path in sorted(wanted):
    metadata = source.metadata(path)
    if metadata.get("missing"):
        fail("the original install does not hold " + path)
    if not isinstance(metadata.get("bytes"), int):
        fail("the VPK index records no size for " + path)
    enumerated += metadata["bytes"]
declared_budget = enumerated + 32_000_000
source.read_budget = declared_budget

textures = []
for path in sorted(wanted):
    record = wanted[path]
    if not source.exists(path):
        fail("the original install does not hold " + path)
    data = source.read(path)
    if data[:4] != b"VTF\0":
        fail(path + " does not start with a VTF signature")
    width, height = struct.unpack_from("<HH", data, 16)
    frames = struct.unpack_from("<H", data, 24)[0]
    if (width, height) != struct.unpack_from("<HH", data, 16) or width < 1 or height < 1:
        fail(path + " does not declare usable dimensions")
    if frames != 1:
        fail(f"{path} stores {frames} frames; a multi-frame texture needs its own export")
    pixels, decoded_width, decoded_height, is_float = load_vtf_texture(data)
    if is_float:
        fail(path + " is a float texture and needs a lossless export of its own")
    if (decoded_width, decoded_height) != (width, height):
        fail(f"{path} decodes to {decoded_width}x{decoded_height} but declares {width}x{height}")
    png = encode_png(pixels, decoded_width, decoded_height, 4)
    target = OUT / "png" / Path(path).relative_to("materials").with_suffix(".png")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(png)
    rgba = np.frombuffer(pixels, np.uint8).reshape(decoded_height, decoded_width, 4)
    textures.append({
        "path": path, "field": record["field"], "paintKitIds": record["paintKitIds"],
        "bytes": len(data), "sha256": digest(data),
        "png": str(target.relative_to(ROOT)), "pngSha256": digest(png),
        "rgba8Sha256": digest(pixels), "width": width, "height": height,
        "vtfVersion": list(struct.unpack_from("<II", data, 4)),
        "vtfHeaderBytes": struct.unpack_from("<I", data, 12)[0],
        "vtfFlags": struct.unpack_from("<I", data, 20)[0],
        "vtfFrameCount": frames,
        "vtfHighResFormat": struct.unpack_from("<i", data, 52)[0],
        "vtfMipCount": data[56],
        "channels": {name: {"min": int(rgba[:, :, index].min()), "max": int(rgba[:, :, index].max()),
                            "uniqueValues": int(len(np.unique(rgba[:, :, index]))),
                            "mean": float(rgba[:, :, index].mean())}
                     for index, name in enumerate("RGBA")},
    })

report = {
    "status": "pattern_inputs_extracted",
    "completedAt": datetime.now(timezone.utc).isoformat(),
    "environment": environment,
    "scriptSha256": digest(Path(__file__).read_bytes()),
    "helperSha256": digest((ROOT / "scripts/inventory-source-items.py").read_bytes()),
    "catalogueSha256": digest(catalogue_bytes),
    "vpk": source.index_info,
    "weapon": WEAPON,
    "styles": sorted(STYLES),
    "finishCount": len(finishes),
    "finishes": plan,
    "refusedFinishes": refused,
    "textures": textures,
    "sourceReads": source.reads,
    "sourceReadBytes": source.total_read_bytes,
    "enumeratedBytes": enumerated,
    "declaredReadBudget": declared_budget,
    "boundaries": [
        "Original native VTF decoded and re-encoded losslessly to PNG; no finish synthesis and no colour conversion.",
        "Every texture is the one the original paint kit names and the original install resolves uniquely; a reference the original leaves ambiguous or unresolved is recorded as refused rather than guessed.",
    ],
}
(OUT / "inputs.json").write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n")
print("AK_PATTERN_INPUTS " + json.dumps({
    "finishes": len(finishes),
    "textures": len(textures),
    "refused": len(refused),
    "bytesRead": source.total_read_bytes,
    "output": str(OUT.relative_to(ROOT)),
}, ensure_ascii=False))
