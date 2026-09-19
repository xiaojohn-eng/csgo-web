#!/usr/bin/env python3
"""Stage one weapon's original composition inputs and pattern textures for the game to serve.

Reads the export `scripts/extract-source-kit-inputs.py` wrote for that weapon — the
weapon's own customization inputs and every pattern-sampling finish's own pattern (and,
where the original has one, normal) texture, each stored losslessly from the original
install's own bytes — copies them into the served tree in one layout per weapon, and
writes the manifest the runtime checks them against.

Nothing is re-encoded here: a byte that differs from the export is refused.

Run: python3 scripts/stage-source-kit-inputs.py weapon_m4a1 [weapon_ak47 ...]
"""
from __future__ import annotations

import hashlib
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "public/source/csgo-12426148/kit-inputs"
MANIFEST = ROOT / "game/source-kit-input-resources.json"
EXPECTED_STATUS = "kit_inputs_extracted"
# Every role the staged catalogue carries for a weapon, and the sampler the original program
# reads each at. The five the style-7 composition samples are 0, 1, 2, 3 and 5; `mask` and
# `osPos` are the two the *other* styles sample - the colour and exponent passes of styles 1, 2,
# 4 and 5 declare `MasksSampler` (slot 4) and styles 3 and 6 also declare `OSPosSampler`
# (slot 7), as the permutations' own constant tables say. `uv` is staged but not sampled: it is
# the paint-space atlas the weapon's model looks its own second UV channel up in, and the
# composition works in paint space already. -1 marks a role the composition does not bind.
ROLE_SAMPLERS = {"ao": 0, "paintWear": 1, "weaponExponent": 2, "weaponAlbedo": 3, "gunGrunge": 5,
                 "mask": 4, "osPos": 7, "surface": 6, "uv": -1}
PATTERN_SAMPLER = 8


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fail(message: str):
    raise SystemExit("stage-source-kit-inputs: " + message)


def stage(weapon: str, source_set: str = "") -> dict:
    source = ROOT / ".reference-assets/source-exports" / source_set / f"{weapon}-kit-inputs"
    receipt_bytes = (source / "inputs.json").read_bytes()
    receipt = json.loads(receipt_bytes)
    if receipt.get("status") != EXPECTED_STATUS:
        fail(f"{weapon}: the export is {receipt.get('status')!r}, not {EXPECTED_STATUS!r}")
    if receipt.get("weapon") != weapon:
        fail(f"{weapon}: the export is for {receipt.get('weapon')!r}")
    textures = receipt.get("textures")
    if not isinstance(textures, list) or not textures:
        fail(f"{weapon}: the export holds no textures")
    # Finishes the original install does not resolve to one pattern are not staged, and
    # they are recorded rather than dropped: the generated finish table only lists the
    # finishes the catalogue resolves uniquely, so a finish with no staged artwork can
    # never be selected, and the resolver refuses one that is asked for anyway.
    refused = receipt.get("refusedFinishes") or []
    roles = receipt.get("roles")
    if not isinstance(roles, dict) or set(roles) != set(ROLE_SAMPLERS):
        fail(f"{weapon}: the export's roles are {sorted(roles or [])}, not {sorted(ROLE_SAMPLERS)}")
    phong = receipt.get("phong")
    for key in ("phongBoost", "phongAlbedoBoost"):
        if not isinstance(phong, dict) or not isinstance(phong.get(key), int):
            fail(f"{weapon}: the export carries no {key}")

    target = TARGET / weapon
    target.mkdir(parents=True, exist_ok=True)
    png_root = source / "png"
    if not png_root.is_dir():
        fail(f"{weapon}: the export holds no png/ tree")

    entries = []
    total = 0
    for texture in textures:
        path = ROOT / texture["png"]
        if not path.is_file():
            fail(f"{weapon}: the export names a missing PNG: {texture['png']}")
        relative = path.relative_to(png_root).as_posix()
        if relative.startswith("..") or ".." in Path(relative).parts:
            fail(f"{weapon}: the export names a PNG outside its own png/ tree: {texture['png']}")
        data = path.read_bytes()
        if digest(data) != texture["pngSha256"]:
            fail(f"{weapon}: the PNG no longer matches the export receipt: {relative}")
        destination = target / "png" / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, destination)
        if digest(destination.read_bytes()) != texture["pngSha256"]:
            fail(f"{weapon}: the staged PNG differs from the export: {relative}")
        field = texture["field"]
        sampler = ROLE_SAMPLERS.get(field, PATTERN_SAMPLER if field == "pattern" else -1 if field == "normal" else None)
        if sampler == -1 and field not in ("uv", "normal"):
            fail(f"{weapon}: {relative} is staged without a sampler but is not the UV atlas")
        if sampler is None:
            fail(f"{weapon}: {relative} has an unknown role {field!r}")
        entries.append({"weapon": weapon, "path": "png/" + relative, "bytes": len(data),
                        "sha256": texture["pngSha256"], "rgba8Sha256": texture["rgba8Sha256"],
                        "role": field, "sampler": sampler, "paintKitIds": texture["paintKitIds"],
                        "width": texture["width"], "height": texture["height"],
                        "vtfFlags": texture["vtfFlags"], "sourceMaterial": texture["path"]})
        total += len(data)

    # The receipt travels with the textures, so the runtime can be told which original
    # material each PNG came from and which Phong values the weapon's own material carries.
    receipt_target = target / "inputs.json"
    shutil.copyfile(source / "inputs.json", receipt_target)
    if digest(receipt_target.read_bytes()) != digest(receipt_bytes):
        fail(f"{weapon}: the staged receipt differs from the export")
    entries.append({"weapon": weapon, "path": "inputs.json", "bytes": len(receipt_bytes),
                    "sha256": digest(receipt_bytes), "rgba8Sha256": "", "role": "receipt", "sampler": -1,
                    "paintKitIds": [], "width": 0, "height": 0, "vtfFlags": 0,
                    "sourceMaterial": "scripts/extract-source-kit-inputs.py"})
    return {"weapon": weapon, "textures": len(textures), "bytes": total, "phong": phong,
            "roles": roles, "refused": refused, "entries": entries}


def main() -> int:
    import argparse
    global TARGET
    parser=argparse.ArgumentParser();parser.add_argument('weapons',nargs='+');parser.add_argument('--source-set',default='')
    parser.add_argument('--target-directory',default='kit-inputs')
    args=parser.parse_args()
    for value in (args.source_set,args.target_directory):
        if value and (Path(value).name!=value or value.startswith('.')):fail('expected a single directory name')
    TARGET=ROOT/'public/source/csgo-12426148'/args.target_directory
    staged = [stage(weapon,args.source_set) for weapon in args.weapons]
    # The manifest is a list of every staged entry across weapons, so the runtime can
    # verify a file by name without knowing which weapon it belongs to.
    #
    # It is merged rather than replaced: staging one weapon adds to what is already there
    # instead of dropping the others. Replacing it would make staging a newly extracted
    # weapon silently withdraw every weapon staged before it, which the finish table would
    # then report as "inputs not staged" -- a weapon quietly disappearing from the menu is
    # exactly the kind of failure that is invisible until someone looks for the skin.
    restaged = {record["weapon"] for record in staged}
    kept = []
    if MANIFEST.exists():
        for entry in json.loads(MANIFEST.read_text()):
            if entry.get("weapon") not in restaged:
                kept.append(entry)
    entries = sorted(kept + [entry for record in staged for entry in record["entries"]],
                     key=lambda entry: (entry["weapon"], entry["path"]))
    MANIFEST.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n")
    print("KIT_INPUTS " + json.dumps({
        "weapons": {record["weapon"]: {"textures": record["textures"], "bytes": record["bytes"],
                                       "refusedFinishes": [entry["paintKitId"] for entry in record["refused"]],
                                       "phong": {k: v for k, v in record["phong"].items()
                                                 if k.startswith("phong")}}
                    for record in staged},
        "keptFromPreviousRuns": sorted({entry["weapon"] for entry in kept}),
        "entries": len(entries),
        "destination": str(TARGET.relative_to(ROOT)),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
