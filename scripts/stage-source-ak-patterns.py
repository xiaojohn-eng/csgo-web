#!/usr/bin/env python3
"""Stage the extracted AK-47 pattern textures for the game to serve.

Reads the export `scripts/extract-source-ak-patterns.py` wrote — the original pattern
(and, where the original has one, normal) texture of every AK-47 paint kit whose style
samples one, each stored losslessly from the original install's own bytes — copies the
PNGs into the served tree, and writes the manifest the runtime checks them against.

Nothing is re-encoded here: a byte that differs from the export is refused.

Run: python3 scripts/stage-source-ak-patterns.py
"""
from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / ".reference-assets/source-exports/ak47-pattern-inputs"
TARGET = ROOT / "public/source/csgo-12426148/ak-patterns"
MANIFEST = ROOT / "game/source-ak-pattern-resources.json"
EXPECTED_STATUS = "pattern_inputs_extracted"


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fail(message: str):
    raise SystemExit("stage-source-ak-patterns: " + message)


receipt_bytes = (SOURCE / "inputs.json").read_bytes()
receipt = json.loads(receipt_bytes)
if receipt.get("status") != EXPECTED_STATUS:
    fail(f"the export is {receipt.get('status')!r}, not {EXPECTED_STATUS!r}")
textures = receipt.get("textures")
if not isinstance(textures, list) or not textures:
    fail("the export holds no textures")
if receipt.get("refusedFinishes"):
    # A finish the original install does not resolve to one pattern is not staged, and the
    # generated finish table does not list it either: the two are derived independently and
    # checked against each other, so a refusal here is a finish no one can select rather
    # than a hole in a finish that is offered.
    print("AK_PATTERNS_REFUSED " + json.dumps(receipt["refusedFinishes"], ensure_ascii=False))

TARGET.mkdir(parents=True, exist_ok=True)
png_root = SOURCE / "png"
if not png_root.is_dir():
    fail("the export holds no png/ tree")

entries = []
total = 0
for texture in textures:
    source = ROOT / texture["png"]
    if not source.is_file():
        fail("the export names a missing PNG: " + texture["png"])
    relative = source.relative_to(png_root).as_posix()
    if relative.startswith("..") or ".." in Path(relative).parts:
        fail("the export names a PNG outside its own png/ tree: " + texture["png"])
    data = source.read_bytes()
    if digest(data) != texture["pngSha256"]:
        fail("the PNG no longer matches the export receipt: " + relative)
    if len(data) != source.stat().st_size:
        fail("the PNG changed size while being staged: " + relative)
    destination = TARGET / "png" / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)
    if digest(destination.read_bytes()) != texture["pngSha256"]:
        fail("the staged PNG differs from the export: " + relative)
    entries.append({
        "path": "png/" + relative,
        "bytes": len(data),
        "sha256": texture["pngSha256"],
        # The kit each texture belongs to, so the runtime can go from a selected finish
        # to its own artwork without re-deriving anything from a path.
        "paintKitIds": texture["paintKitIds"],
        "field": texture["field"],
        "width": texture["width"],
        "height": texture["height"],
        "sourceMaterial": texture["path"],
        # The original's own VTF flags carry the address modes the composition samples
        # with, and the decoded-pixel digest lets the compositor check that the GPU read
        # back the same bytes the original decoder produced.
        "vtfFlags": texture["vtfFlags"],
        "rgba8Sha256": texture["rgba8Sha256"],
    })
    total += len(data)

# The receipt travels with the textures: the runtime is told which original material each
# PNG came from, and the digests of the VTF it was decoded from.
receipt_target = TARGET / "inputs.json"
shutil.copyfile(SOURCE / "inputs.json", receipt_target)
if digest(receipt_target.read_bytes()) != digest(receipt_bytes):
    fail("the staged receipt differs from the export")
entries.append({"path": "inputs.json", "bytes": len(receipt_bytes), "sha256": digest(receipt_bytes),
                "paintKitIds": [], "field": "receipt", "width": 0, "height": 0,
                "vtfFlags": 0, "rgba8Sha256": "",
                "sourceMaterial": "scripts/extract-source-ak-patterns.py"})

MANIFEST.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n")
print("AK_PATTERNS " + json.dumps({
    "textures": len(textures),
    "finishes": receipt.get("finishCount"),
    "bytes": total,
    "destination": str(TARGET.relative_to(ROOT)),
}, ensure_ascii=False))
