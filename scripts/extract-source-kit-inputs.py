"""Extract one weapon's original composition inputs and pattern textures.

The AK-47's inputs were extracted for the Redline specifically. This script does the same
work for any weapon the staged paint-kit catalogue covers, discovering the weapon's own
customization materials from the original install's own directory index rather than from
a hand-written list, and writing each one out losslessly as PNG beside a receipt.

The finishes it reads the pattern textures of are those of the styles whose programs
sample the finish's own pattern - styles 2, 5 and 7 - which is read from the exported
program data rather than written here. A style that samples no pattern (1 and 4) reads its
colour from its own palette constants and needs no artwork at all.

Nothing is synthesised: a texture whose original form cannot be stored losslessly is
refused and recorded, and a role the install does not hold is a refusal rather than a
substitution.

Run: blender --background --factory-startup --python scripts/extract-source-kit-inputs.py -- weapon_m4a1
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
ITEM_CATALOGUE = ROOT / "research/source-items-catalog.json"
# The one program this port compiled from the original's own tokens and checked against them.
VERIFIED_STYLE = 7
# The sampler the original's permutations read a finish's own pattern at.
PATTERN_SAMPLER = 8
PROGRAM_DATA = ROOT / "game/source-customweapon-program-data.ts"
PROGRAM_RECEIPT = ROOT / ".reference-assets/source-exports/customweapon-style-programs/evidence.json"

import argparse
parser=argparse.ArgumentParser()
parser.add_argument('weapon')
parser.add_argument('--output-set',default='')
parser.add_argument('--catalogue',type=Path,default=CATALOGUE)
parser.add_argument('--all-source-styles',action='store_true')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--'in sys.argv else [])
WEAPON=args.weapon
CATALOGUE=args.catalogue
if args.output_set and (Path(args.output_set).name!=args.output_set or args.output_set.startswith('.')):
    raise SystemExit('The output set must be a single named export directory')
OUT=ROOT/'.reference-assets/source-exports'/args.output_set/f'{WEAPON}-kit-inputs'

OUT.mkdir(parents=True, exist_ok=True)
(OUT / "inputs.json").write_text(json.dumps({
    "status": "running", "weapon": WEAPON, "startedAt": datetime.now(timezone.utc).isoformat()}) + "\n")

helpers = runpy.run_path(str(ROOT / "scripts/inventory-source-items.py"))
environment = helpers["initialize"]()
source = helpers["Sources"]()
from SourceIO.library.utils.pylib.vtf import load_vtf_texture
from SourceIO.library.utils.pylib.image import encode_png
import numpy as np


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fail(message: str):
    raise SystemExit("extract-source-kit-inputs: " + message)


catalogue_bytes = CATALOGUE.read_bytes()
catalogue = json.loads(catalogue_bytes)
weapon = next((entry for entry in catalogue["weapons"] if entry["weapon"] == WEAPON), None)
if weapon is None:
    fail(f"the staged catalogue carries no {WEAPON}")

# Which styles need a pattern at all: the ones whose programs declare the pattern sampler,
# read from the exported program data and the receipt that names each permutation's own
# sampler list. A style the program data does not carry has no program this port can build,
# so its artwork would be staged for nothing and is not extracted.
if not PROGRAM_RECEIPT.exists():
    fail("the customweapon program receipt is not exported")
_evidence = json.loads(PROGRAM_RECEIPT.read_text())
_declared = json.loads(re.search(r"SOURCE_CUSTOMWEAPON_PROGRAM_STYLES = (\[[^\]]*\])",
                                 PROGRAM_DATA.read_text()).group(1))
PATTERN_STYLES = frozenset(
    [VERIFIED_STYLE]
    + [int(style) for style in _declared
       if any(PATTERN_SAMPLER in (row.get("declaredSamplers") or [])
              for row in _evidence["styles"].get(str(style), {}).values() if row.get("present"))])
if args.all_source_styles:
    PATTERN_STYLES=frozenset(range(1,10))
finishes = [finish for finish in weapon["finishes"] if finish["style"] in PATTERN_STYLES]
if not finishes:
    fail(f"the staged catalogue carries no {WEAPON} finish of styles {sorted(PATTERN_STYLES)}")

asset = WEAPON.replace("weapon_", "")
entries = sorted(source.entries)
print(f"KIT_INPUTS_DISCOVERY {json.dumps({'weapon': WEAPON, 'asset': asset,
                                          'patternStyles': sorted(PATTERN_STYLES),
                                          'finishes': len(finishes)})}")


# What the install actually holds, so a role that cannot be found can be read against the
# names that are there rather than guessed at.
customization_prefix = "materials/models/weapons/customization/"


def find(predicate, what: str) -> str:
    """One original path matching the predicate, or a refusal naming what was wanted."""
    matches = [path for path in entries if predicate(path)]
    if len(matches) != 1:
        fail(f"the install holds {len(matches)} candidates for {what}: {matches[:4]}")
    return matches[0]


# The weapon's own customization directory, found by the shape every weapon in this
# install follows: a directory holding both `<dir>.vmt` and `<dir>_ao.vtf`. Matching on
# that rather than on the weapon's name keeps `rif_m4a1` and `rif_m4a1_s` — whose names
# both contain this weapon's — apart.
roots = sorted({path.split("/")[4] for path in entries
                if path.startswith(customization_prefix)
                and len(path.split("/")) == 6
                and path.split("/")[5] == path.split("/")[4] + ".vmt"
                and f"{customization_prefix}{path.split('/')[4]}/{path.split('/')[4]}_ao.vtf" in set(entries)})
print("KIT_INPUTS_ROOTS " + json.dumps({"candidates": len(roots), "first": roots[:6]}))
if not roots:
    fail("the install holds no customization root of the shape <dir>/<dir>.vmt + <dir>_ao.vtf")


# The root this weapon uses. The original's own item definition lists the materials the
# weapon's models reference, and those name its customization directory — which is what
# tells `rif_m4a1` from `rif_m4a1_s`, instead of this script guessing from the name.
# The item catalogue is the one that records what each weapon's models reference.
items_bytes = ITEM_CATALOGUE.read_bytes()
items = json.loads(items_bytes)
weapon_entry = next((entry for entry in items["weapons"] if entry.get("name") == WEAPON), None)
if weapon_entry is None:
    fail(f"the item catalogue carries no {WEAPON}")
referenced = [record["path"] for record in weapon_entry["referencedModelMaterialFiles"]]
from_catalogue = sorted({path.split("/")[4] for path in referenced
                         if path.startswith(customization_prefix) and "_decal_" in path})
print("KIT_INPUTS_ROOT_TIE " + json.dumps({"fromCatalogue": from_catalogue}))
if len(from_catalogue) != 1:
    fail(f"the item definition names {len(from_catalogue)} customization directories: {from_catalogue}")
asset = from_catalogue[0]
if asset not in roots:
    fail(f"the customization directory {asset} is not of the expected shape")

# The weapon's own customization inputs. The roles are the ones the programs sample; each is
# found by the original's own naming inside that root. `mask` and `osPos` are the two the
# styles other than 7 sample - the client reads them from these very paths (the filler that
# builds a finish's material block formats `customization/<folder>/<folder>_masks.vtf` and
# `_pos.vtf` into the fields the block then names as `$maskstexture` and `$postexture`), and
# the permutations that declare `MasksSampler` and `OSPosSampler` are styles 1, 2, 4 and 5
# for the mask and 3 and 6 for either.
customization = f"{customization_prefix}{asset}/"
roles = {
    "ao": f"{customization}{asset}_ao.vtf",
    "mask": f"{customization}{asset}_masks.vtf",
    "osPos": f"{customization}{asset}_pos.vtf",
    "surface": f"{customization}{asset}_surface.vtf",
    "weaponExponent": find(lambda p: p.startswith(f"materials/models/weapons/v_models/{asset}/")
                           and p.endswith("_exponent.vtf"), f"{asset} weapon exponent"),
    "weaponAlbedo": find(lambda p: p.startswith(f"materials/models/weapons/v_models/{asset}/")
                         and p.endswith(".vtf") and "_exponent" not in p,
                         f"{asset} weapon albedo"),
    # The UV atlas is named after the weapon rather than after its customization
    # directory, and lives in the shared `uvs` directory.
    "uv": f"{customization_prefix}uvs/{WEAPON}.vtf",
    "paintWear": "materials/models/weapons/customization/shared/paint_wear.vtf",
    "gunGrunge": "materials/models/weapons/customization/shared/gun_grunge.vtf",
}
for role, path in roles.items():
    if not source.exists(path):
        fail(f"the install does not hold {path} for role {role}")

# The weapon's own material, which carries the Phong values the composition preserves.
material_paths = [find(lambda p: p.startswith(f"materials/models/weapons/v_models/{asset}/")
                       and p.endswith(".vmt") and "_decal_" not in p and "_exponent" not in p,
                       f"{asset} view-model material"),
                  "materials/models/weapons/customization/paints/paint.vmt"]
materials = {}
for path in material_paths:
    data = source.read(path)
    materials[path] = {"text": data.decode("utf-8-sig"), "sha256": digest(data)}


def material_value(text: str, key: str) -> str:
    """One original material parameter, read from the material's own text."""
    match = re.search(r'"\$?' + key + r'"\s*"([^"]*)"', text, re.I)
    if not match:
        fail(f"the original material carries no {key}")
    return match.group(1)


# The weapon-level Phong values the composition preserves. They belong to the weapon, not
# to a finish, and they differ between weapons — which is why they are read here rather
# than written into the compositor.
view_model = materials[material_paths[0]]["text"]
# `$phongfresnelranges "[.83 .83 1]"` — the three Fresnel stops the Phong term mixes
# between. Also the weapon's own, and also not the same for every weapon, so it is read
# here rather than assumed.
fresnel = material_value(view_model, "phongfresnelranges").strip()
fresnel_match = re.fullmatch(r"\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]", fresnel)
if not fresnel_match:
    fail(f"the material's phong Fresnel ranges are {fresnel!r}, not three numbers")
phong = {
    "phongBoost": int(material_value(view_model, "phongboost")),
    "phongAlbedoBoost": int(material_value(view_model, "phongalbedoboost")),
    "phongFresnelRanges": [float(value) for value in fresnel_match.groups()],
    "baseTexture": material_value(view_model, "basetexture"),
    "exponentTexture": material_value(view_model, "phongexponenttexture"),
}
# The two paths the material names must be the two this pass discovered, or the roles are
# not what they claim to be.
expected = {"baseTexture": roles["weaponAlbedo"], "exponentTexture": roles["weaponExponent"]}
for key, path in expected.items():
    original = path[len("materials/"):].rsplit(".", 1)[0].replace("/", "\\")
    if phong[key].replace("/", "\\").casefold() != original.casefold():
        fail(f"the material's {key} is {phong[key]}, not the discovered {original}")
if phong["phongBoost"] < 1:
    fail(f"the material's phong boost is {phong['phongBoost']}")
print("KIT_INPUTS_PHONG " + json.dumps({"weapon": WEAPON, **{k: v for k, v in phong.items()
                                                             if k.startswith("phong")}}))

# The finishes' own pattern textures, resolved the way the original resolves them.
wanted: dict[str, dict] = {}
plan = []
refused = []
for finish in finishes:
    entry = {"paintKitId": finish["id"], "name": finish["name"], "englishName": finish["englishName"],
             "chineseName": finish["chineseName"]}
    for field in ("pattern", "normal"):
        matches = [reference for reference in finish["textureReferences"] if reference["field"] == field]
        if not matches:
            # Original solid/anodized styles have no pattern input.
            if field == "pattern" and finish['style'] not in (1,4):
                refused.append({"paintKitId": finish["id"], "reason": "no original pattern reference"})
            entry[field] = None
            continue
        reference = matches[0]
        if reference["resolution"] != "unique" or len(reference["candidates"]) != 1:
            refused.append({"paintKitId": finish["id"],
                            "reason": f"original {field} reference is {reference['resolution']}"})
            entry[field] = None
            continue
        path = reference["candidates"][0]
        wanted.setdefault(path, {"path": path, "field": field, "paintKitIds": []})
        wanted[path]["paintKitIds"].append(finish["id"])
        entry[field] = path
    plan.append(entry)
if not wanted:
    fail("no original pattern texture was resolved")

# This pass reads a set it has just enumerated, so it declares its own bound and records
# how much that set is, rather than relying on the catalogue probe's default.
enumerated = 0
for path in sorted(list(wanted) + list(roles.values())):
    metadata = source.metadata(path)
    if metadata.get("missing") or not isinstance(metadata.get("bytes"), int):
        fail("the install holds no sized entry for " + path)
    enumerated += metadata["bytes"]
source.read_budget = enumerated + 64_000_000


def store(path: str, field: str) -> dict:
    data = source.read(path)
    if data[:4] != b"VTF\0":
        fail(path + " does not start with a VTF signature")
    width, height = struct.unpack_from("<HH", data, 16)
    frames = struct.unpack_from("<H", data, 24)[0]
    if width < 1 or height < 1:
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
    return {
        "path": path, "field": field, "paintKitIds": wanted.get(path, {}).get("paintKitIds", []),
        "bytes": len(data), "sha256": digest(data),
        "png": str(target.relative_to(ROOT)), "pngSha256": digest(png),
        "rgba8Sha256": digest(pixels), "width": width, "height": height,
        "vtfFlags": struct.unpack_from("<I", data, 20)[0],
        "vtfHighResFormat": struct.unpack_from("<i", data, 52)[0],
        "channels": {name: {"min": int(rgba[:, :, index].min()), "max": int(rgba[:, :, index].max()),
                            "uniqueValues": int(len(np.unique(rgba[:, :, index]))),
                            "mean": float(rgba[:, :, index].mean())}
                     for index, name in enumerate("RGBA")},
    }


textures = [store(path, "role") for path in sorted(roles.values())]
role_of = {path: role for role, path in roles.items()}
for record in textures:
    record["role"] = role_of[record["path"]]
textures += [store(path, wanted[path]["field"]) for path in sorted(wanted)]
recorded = {record["path"]: record for record in textures}
for record in textures:
    if record["field"] == "role":
        record["field"] = record.pop("role")

report = {
    "status": "kit_inputs_extracted",
    "weapon": WEAPON,
    "styles": sorted(PATTERN_STYLES),
    "completedAt": datetime.now(timezone.utc).isoformat(),
    "environment": environment,
    "scriptSha256": digest(Path(__file__).read_bytes()),
    "helperSha256": digest((ROOT / "scripts/inventory-source-items.py").read_bytes()),
    "catalogueSha256": digest(catalogue_bytes),
    "itemCatalogueSha256": digest(items_bytes),
    "vpk": source.index_info,
    "roles": roles,
    "materials": materials,
    "phong": phong,
    "finishes": len(finishes),
    "plan": plan,
    "refusedFinishes": refused,
    "textures": textures,
    "sourceReadBytes": source.total_read_bytes,
    "enumeratedBytes": enumerated,
    "declaredReadBudget": source.read_budget,
    "boundaries": [
        "Original native VTF decoded and re-encoded losslessly to PNG; no finish synthesis and no colour conversion.",
        "Every path is discovered from the original install's own directory index; a role the install does not hold exactly once is refused.",
    ],
}
(OUT / "inputs.json").write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n")
print("KIT_INPUTS " + json.dumps({
    "weapon": WEAPON, "finishes": len(finishes), "textures": len(textures),
    "refused": len(refused), "bytesRead": source.total_read_bytes,
    "roles": {role: path.split("/")[-1] for role, path in roles.items()},
    "output": str(OUT.relative_to(ROOT)),
}, ensure_ascii=False))
print("KIT_INPUTS_MATERIALS " + json.dumps(sorted(materials)))
