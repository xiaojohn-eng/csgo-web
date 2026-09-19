#!/usr/bin/env python3
"""Copy exact build-12426148 inventory PNGs for the staged weapon/paint-kit pairs.

No networking, image generation, decoding/re-encoding, or generic-image fallback.
The inventory artwork depicts Valve's fixed light-wear example, not the player's
runtime seed/wear. Defaults use their separate original image_inventory entries.
Run from any checkout; --catalogue-root can point at the latest integration tree.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_PREFIX = "/source/csgo-12426148/skin-previews-20260913"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def png_info(data):
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Original preview is not PNG")
    offset, dimensions, idat, ended = 8, None, 0, False
    while offset < len(data):
        size = struct.unpack_from(">I", data, offset)[0]
        tag = data[offset + 4:offset + 8]
        chunk = data[offset + 4:offset + 8 + size]
        expected = struct.unpack_from(">I", data, offset + 8 + size)[0]
        if zlib.crc32(chunk) & 0xffffffff != expected:
            raise ValueError("Original PNG chunk CRC mismatch")
        if tag == b"IHDR":
            dimensions = struct.unpack_from(">II", data, offset + 8)
        if tag == b"IDAT":
            idat += size
        offset += 12 + size
        if tag == b"IEND":
            ended = True
            break
    if not ended or offset != len(data) or not dimensions or min(dimensions) <= 0 or not idat:
        raise ValueError("Original PNG is truncated or has no image payload")
    return {"width": dimensions[0], "height": dimensions[1]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalogue-root", type=Path, default=ROOT)
    parser.add_argument("--output-dir", type=Path,
                        default=ROOT / "output/skin-preview-export/public" / PUBLIC_PREFIX.lstrip("/"))
    args = parser.parse_args()
    source_root, output = args.catalogue_root.absolute(), args.output_dir.absolute()
    game = source_root / ".reference-assets/csgo-legacy/csgo"
    spec = importlib.util.spec_from_file_location("inventory_sources", source_root / "scripts/inventory-source-items.py")
    inventory = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(inventory)
    entries, directory = inventory.directory_index(game / "pak01_dir.vpk")
    catalogue_path = source_root / "public/source/csgo-12426148/skins/paint-kits.json"
    catalogue_bytes = catalogue_path.read_bytes()
    catalogue = json.loads(catalogue_bytes)
    source_catalogue_path = source_root / "research/source-items-catalog.json"
    source_catalogue_bytes = source_catalogue_path.read_bytes()
    source_catalogue = json.loads(source_catalogue_bytes)
    if sha(source_catalogue_bytes) != catalogue["cataloguedFrom"]["catalogueSha256"]:
        raise ValueError("Original relation catalogue differs from the staged catalogue receipt")
    effects_path = source_root / "public/source/csgo-12426148/weapon-effects/effect-map.json"
    effects = json.loads(effects_path.read_bytes())
    if catalogue["cataloguedFrom"]["vpkIndex"]["sha256"] != directory["sha256"]:
        raise ValueError("Installed VPK directory differs from the staged catalogue")
    expected_items = next(row for row in catalogue["cataloguedFrom"]["sourceFilesRead"]
                          if row["path"] == "scripts/items/items_game.txt")
    if sha((game / expected_items["path"]).read_bytes()) != expected_items["sha256"]:
        raise ValueError("Installed item definitions differ from the staged catalogue")
    mapping = {prefab.removesuffix("_prefab"): weapon for weapon, prefab in effects["prefabs"].items()}
    relations = {(row["weapon"], row["paintKitId"]): row for row in source_catalogue["weaponFinishRelations"]}
    source_weapons = {row["name"]: row for row in source_catalogue["weapons"]}
    rows, written = [], set()

    def export(weapon, original, kit_id, name, source, evidence):
        if source not in entries:
            raise ValueError(f"Missing exact original inventory PNG: {source}")
        entry = entries[source]
        # All PNGs in this bounded source set have no preload. Refuse unsupported
        # storage instead of silently losing bytes if a future installation differs.
        if entry["preloadBytes"] or entry["archiveIndex"] == 0x7fff:
            raise ValueError("Unexpected preview VPK storage; inspect new source before export")
        archive = game / f"pak01_{entry['archiveIndex']:03}.vpk"
        with archive.open("rb") as file:
            file.seek(entry["archiveOffset"])
            data = file.read(entry["archiveBytes"])
        if len(data) != entry["bytes"] or f"{zlib.crc32(data) & 0xffffffff:08x}" != entry["crc32"]:
            raise ValueError(f"Original VPK preview size/CRC mismatch: {source}")
        dimensions = png_info(data)
        relative = f"{weapon}/{kit_id}.png"
        if relative in written:
            raise ValueError(f"Duplicate preview key: {relative}")
        written.add(relative)
        dest = output / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        if sha(dest.read_bytes()) != sha(data):
            raise ValueError("Copied preview failed independent output readback")
        rows.append({"weapon": weapon, "sourceWeapon": original, "paintKitId": None if kit_id == "default" else int(kit_id),
                     "paintKitName": name, "variant": "default" if kit_id == "default" else "light",
                     "url": PUBLIC_PREFIX + "/" + relative, "file": relative, **dimensions,
                     "bytes": len(data), "sha256": sha(data), "source": entry, "pairEvidence": evidence})

    for weapon in catalogue["weapons"]:
        original = weapon["weapon"]
        game_weapon = mapping[original]
        definition = source_weapons[original]["resolvedDefinition"]
        image = definition["image_inventory"]
        export(game_weapon, original, "default", "default", "resource/flash/" + image + ".png",
               [f"/items/{source_weapons[original]['id']}/resolvedDefinition/image_inventory={image}"])
        for finish in weapon["finishes"]:
            relation = relations[(original, finish["id"])]
            if relation["paintKitName"] != finish["name"]:
                raise ValueError("Paint-kit id/name relation disagrees with the staged catalogue")
            evidence = [item for item in relation["evidence"]
                        if "/alternate_icons2/weapon_icons/" in item and "/icon_path=" in item and item.endswith("_light")]
            paths = {item.split("/icon_path=", 1)[1] for item in evidence}
            if len(paths) != 1:
                raise ValueError(f"No unique original light-wear inventory icon for {original}:{finish['id']}")
            icon_path = paths.pop()
            export(game_weapon, original, finish["id"], finish["name"],
                   "resource/flash/" + icon_path + "_large.png", evidence)

    expected_finishes = sum(len(weapon["finishes"]) for weapon in catalogue["weapons"])
    if len(rows) != expected_finishes + len(catalogue["weapons"]):
        raise ValueError("Preview coverage is incomplete")
    manifest = {"format": "source-skin-previews-v1", "sourceApp": 740, "build": 12426148,
                "status": "original_inventory_pngs_verified", "publicPrefix": PUBLIC_PREFIX,
                "catalogueSha256": sha(catalogue_bytes), "sourceCatalogueSha256": sha(source_catalogue_bytes),
                "sourceItems": expected_items, "vpkDirectory": directory,
                "summary": {"weapons": len(catalogue["weapons"]), "finishes": expected_finishes,
                            "defaults": len(catalogue["weapons"]), "files": len(rows), "bytes": sum(row["bytes"] for row in rows)},
                "boundaries": ["Original fixed inventory artwork; not a live view of user seed/wear.",
                               "PNG bytes copied exactly from local original VPK; no network or generated substitutes.",
                               "Client actual image-load/render acceptance is separate from archive CRC and PNG chunk validation."],
                "images": rows}
    output.mkdir(parents=True, exist_ok=True)
    (output / "index.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), **manifest["summary"]}))


if __name__ == "__main__":
    main()
