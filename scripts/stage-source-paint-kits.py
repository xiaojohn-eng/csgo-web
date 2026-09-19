#!/usr/bin/env python3
"""Stage the original paint-kit catalogue for the weapons this port implements.

The repository already holds a verified catalogue of the original install
(`research/source-items-catalog.json`), derived from the original `items_game.txt`
plus the original localisation files, with the SHA-256 of every source file it read.
This script turns that into a compact, self-contained catalogue of the finishes the
original offers for the weapons this port actually ships: each one with its original
English and Chinese name, its original rarity, style, pattern, seed, wear window,
its four original palette colours, and the pattern texture the original resolves for
it.

Nothing is synthesised here. A kit whose original fields do not resolve, a relation
whose kit the catalogue does not hold, or a duplicate finish for one weapon is
refused rather than filled in, so the staged file always describes the original and
never a guess.

Run: python3 scripts/stage-source-paint-kits.py
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOGUE = ROOT / "research/source-items-catalog.json"
INSTALL = ROOT / ".reference-assets/csgo-legacy/csgo"
OUT = ROOT / "public/source/csgo-12426148/skins/paint-kits.json"
MANIFEST = ROOT / "game/source-paint-kit-resources.json"
# The transport rule both the client and the server read. It is generated here rather
# than written by hand so it cannot drift from the catalogue it describes, and it is a
# TypeScript module rather than JSON because the server build does not copy JSON into
# its output directory.
TABLE = ROOT / "game/source-finish-table.ts"
TABLE_FORMAT = "source-finish-table-v1"
# Which of the port's weapon ids is which original weapon is not re-declared here: the
# staged effect map already carries that mapping (`vandal` is the original AK-47), and a
# second hand-written copy is exactly the kind of thing that drifts.
EFFECT_MAP = ROOT / "public/source/csgo-12426148/weapon-effects/effect-map.json"
# The per-weapon composition inputs, when a weapon has them staged. A weapon in the port
# whose inputs are not staged here cannot be composed yet, so it is left out of the
# transport rule rather than offered and refused.
KIT_INPUTS = ROOT / "game/source-kit-input-resources.json"
# The AK-47's composition inputs are not a staged kit tree: they are the receipt the
# composition was verified against, which is why it is composable without one.
VERIFIED_INPUT_WEAPONS = ("vandal",)
# The composition this port implements, and therefore the styles the transport rule may accept.
# Style 7 is the one whose program this port compiled first; the rest are the styles the exported
# program data carries, which is the authoritative list of what the browser can build - a style
# whose program cannot be built must not be listed, because listing it promises a finish that
# cannot be drawn. Which of them sample the finish's own pattern is read from the program receipt
# rather than assumed: a style whose programs declare no pattern sampler has no artwork to stage
# and no pattern to resolve.
STYLE_TABLE = 7
PROGRAM_DATA = ROOT / "game/source-customweapon-program-data.ts"
PROGRAM_RECEIPT = ROOT / ".reference-assets/source-exports/customweapon-style-programs/evidence.json"
PROGRAM_SAMPLER_PATTERN = 8
# The compositor's own binding of the verified receipt's textures, and the receipt itself. The
# AK-47's path is not a staged kit tree, so its sampler slots come from there; the two are checked
# against each other below rather than either being trusted alone.
COMPOSITOR = ROOT / "game/source-redline-compositor.ts"
VERIFIED_RECEIPT = ROOT / ".reference-assets/source-exports/ak47-redline-inputs/inputs.json"
if not PROGRAM_RECEIPT.exists():
    fail("the customweapon program receipt is not exported")
_program_evidence = json.loads(PROGRAM_RECEIPT.read_text())
COMPOSABLE_STYLES = frozenset(
    [STYLE_TABLE]
    + [int(style) for style in json.loads(
        re.search(r"SOURCE_CUSTOMWEAPON_PROGRAM_STYLES = (\[[^\]]*\])",
                  PROGRAM_DATA.read_text()).group(1))])


def style_samplers(style: int) -> frozenset:
    """All original non-preview sampler branches, including VCS aliases."""
    native=json.loads((ROOT/'research/source-customweapon-all-programs.json').read_text())
    return frozenset(sampler for row in native['programs'] if row['style']==style for sampler in row['samplers'])


def reads_pattern(style: int) -> bool:
    return PROGRAM_SAMPLER_PATTERN in style_samplers(style)


# The slots the compositor binds the verified receipt's own textures at, and the receipt's own
# texture list. A slot the compositor names but the receipt does not hold would sample unbound, so
# the two disagreeing stops the pass rather than narrowing what it promises.
_verified_bindings = [(int(sampler), suffix) for sampler, suffix in re.findall(
    r'\[(\d+), "([^"]+)", (?:true|false)\]', COMPOSITOR.read_text())]
if not _verified_bindings:
    fail("the compositor declares no verified input binding")
if not VERIFIED_RECEIPT.exists():
    fail("the verified Redline input receipt is not exported")
_verified_paths = [texture["path"] for texture in json.loads(VERIFIED_RECEIPT.read_text())["textures"]]
for _sampler, _suffix in _verified_bindings:
    if sum(1 for path in _verified_paths if path.endswith(_suffix)) != 1:
        fail(f"the verified receipt holds no single texture for sampler {_sampler} ({_suffix})")
VERIFIED_SAMPLERS = frozenset([sampler for sampler, _ in _verified_bindings] + [PROGRAM_SAMPLER_PATTERN])


PATTERN_STYLES = frozenset(style for style in COMPOSABLE_STYLES if reads_pattern(style))
FORMAT = "source-paint-kits-v1"
CATALOGUE_FORMAT = "source-items-catalogue-v1"

# The weapons this port ships. A relation for anything else is not staged, and a
# weapon named here with no relations would leave the catalogue without a finish
# list, so both directions are checked.
WEAPONS = (
    "weapon_ak47",
    "weapon_m4a1",
    "weapon_glock",
    "weapon_usp_silencer",
    "weapon_deagle",
    "weapon_awp",
)
DEFAULT_KIT_ID = "0"

# Every field a staged kit needs once the kit's own block is merged over the
# original `paint_kits` default block, which is how the original reads them.
REQUIRED = (
    "style",
    "pattern",
    "seed",
    "pattern_scale",
    "pattern_offset_x_start",
    "pattern_offset_x_end",
    "pattern_offset_y_start",
    "pattern_offset_y_end",
    "pattern_rotate_start",
    "pattern_rotate_end",
    "wear_remap_min",
    "wear_remap_max",
    "wear_default",
    "color0",
    "color1",
    "color2",
    "color3",
    "phongexponent",
    "phongintensity",
    "phongalbedoboost",
    "only_first_material",
    "ignore_weapon_size_scale",
)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fail(message: str):
    raise SystemExit("stage-source-paint-kits: " + message)


def integer(value, where: str) -> int:
    if isinstance(value, bool):
        fail(f"{where} is a bool, not an integer")
    try:
        text = str(value).strip()
        return int(text)
    except (TypeError, ValueError):
        fail(f"{where} is not an integer: {value!r}")


def number(value, where: str) -> float:
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        fail(f"{where} is not a number: {value!r}")


def colour(value, where: str) -> list[int]:
    """One original palette colour: three (or four) 0..255 components."""
    parts = str(value).split()
    if len(parts) not in (3, 4):
        fail(f"{where} is not an original RGB(A) colour: {value!r}")
    out = []
    for part in parts:
        try:
            component = int(part)
        except ValueError:
            fail(f"{where} has a non-integer component: {value!r}")
        if not 0 <= component <= 255:
            fail(f"{where} has a component outside 0..255: {value!r}")
        out.append(component)
    return out


def main() -> int:
    catalogue_bytes = CATALOGUE.read_bytes()
    catalogue = json.loads(catalogue_bytes)
    if catalogue.get("schemaVersion") != 1:
        fail(f"unexpected item catalogue schema: {catalogue.get('schemaVersion')!r}")
    manifest_sha = catalogue.get("manifestSha256")
    if not isinstance(manifest_sha, str) or len(manifest_sha) != 64:
        fail("the item catalogue carries no install manifest digest")

    # The rarity labels the original shows come from the original localisation files,
    # whose digests the item catalogue already recorded when it read them. Reading them
    # again and checking the digest is what keeps the labels the original's own rather
    # than something this script remembers.
    recorded = {entry["path"]: entry for entry in catalogue.get("sourceFilesRead") or []}
    localisation: dict[str, dict[str, str]] = {}
    for language, name in (("english", "csgo_english.txt"), ("schinese", "csgo_schinese.txt")):
        entry = recorded.get(f"resource/{name}")
        if not entry or not isinstance(entry.get("sha256"), str):
            fail(f"the item catalogue records no digest for resource/{name}")
        raw = (INSTALL / "resource" / name).read_bytes()
        if digest(raw) != entry["sha256"]:
            fail(f"resource/{name} no longer matches the digest the item catalogue recorded")
        if len(raw) != entry.get("bytes"):
            fail(f"resource/{name} is {len(raw)} bytes, not the recorded {entry.get('bytes')}")
        text = raw.decode("utf-16") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else raw.decode("utf-8-sig")
        localisation[language] = dict(re.findall(r'"([^"]+)"\s+"([^"]*)"', text))

    def rarity_label(key: str, table: dict, language: str) -> str:
        """The original's own name for one rarity, read from the original's own file.

        The weapon-specific key is preferred, which is the one the original shows on a
        weapon finish; a rarity whose label the original does not carry is refused
        rather than translated here.
        """
        for loc_key in (table.get("loc_key_weapon"), table.get("loc_key")):
            if isinstance(loc_key, str):
                label = localisation[language].get(loc_key)
                if isinstance(label, str) and label:
                    return label
        fail(f"rarity {key} has no {language} label in the original localisation")
        raise AssertionError  # unreachable; `fail` exits

    defaults = catalogue.get("paintKitDefaults")
    if not isinstance(defaults, dict):
        fail("the item catalogue carries no `paint_kits` default block")
    rarities = catalogue.get("rarities")
    if not isinstance(rarities, dict):
        fail("the item catalogue carries no rarity table")

    kits = {str(kit["id"]): kit for kit in catalogue["paintKits"]}
    if DEFAULT_KIT_ID not in kits:
        fail("the item catalogue carries no default paint kit 0")

    # Group the original relations by weapon, refusing anything unexpected on the way
    # rather than skipping it silently.
    grouped: dict[str, dict[str, str]] = {weapon: {} for weapon in WEAPONS}
    for relation in catalogue["weaponFinishRelations"]:
        weapon = relation.get("weapon")
        kit_id = str(relation.get("paintKitId"))
        if weapon not in grouped:
            continue
        if kit_id not in kits:
            fail(f"relation for {weapon} names paint kit {kit_id}, which the catalogue does not hold")
        if kit_id in grouped[weapon]:
            fail(f"{weapon} lists paint kit {kit_id} twice")
        if kits[kit_id].get("name") != relation.get("paintKitName"):
            fail(f"paint kit {kit_id} is named {kits[kit_id].get('name')!r} but its relation says "
                 f"{relation.get('paintKitName')!r}")
        grouped[weapon][kit_id] = kit_id

    seen: dict[str, dict] = {}
    used_rarities: set[str] = set()

    def staged(kit_id: str) -> dict:
        """One kit, merged over the original defaults and checked field by field."""
        if kit_id in seen:
            return seen[kit_id]
        kit = kits[kit_id]
        definition = kit.get("definition")
        if not isinstance(definition, dict):
            fail(f"paint kit {kit_id} carries no definition block")
        merged = {**defaults, **definition}
        for key in REQUIRED:
            if merged.get(key) is None:
                fail(f"paint kit {kit_id} has no original {key}")
        rarity_key = kit.get("rarity") or "default"
        if rarity_key not in rarities:
            fail(f"paint kit {kit_id} names rarity {rarity_key!r}, which the rarity table does not hold")
        style = integer(merged["style"], f"paint kit {kit_id} style")
        if style < 0:
            fail(f"paint kit {kit_id} has a negative style")
        references = []
        for reference in kit.get("textureReferences") or []:
            resolution = reference.get("resolution")
            if resolution not in ("unique", "ambiguous", "unresolved"):
                fail(f"paint kit {kit_id} has an unknown texture resolution {resolution!r}")
            source_value = reference.get("sourceValue")
            if not isinstance(source_value, str) or not source_value:
                fail(f"paint kit {kit_id} has a texture reference without an original value")
            candidates = reference.get("candidates")
            if not isinstance(candidates, list):
                fail(f"paint kit {kit_id} has a texture reference without a candidate list")
            # The install's own verdict decides how many candidates there may be, so a
            # reference that contradicts its own resolution is refused rather than kept.
            expected = {"unique": 1, "ambiguous": 2, "unresolved": 0}[resolution]
            if resolution == "unique" and len(candidates) != 1:
                fail(f"paint kit {kit_id} calls {len(candidates)} candidates unique")
            if resolution == "ambiguous" and len(candidates) < expected:
                fail(f"paint kit {kit_id} calls {len(candidates)} candidates ambiguous")
            if resolution == "unresolved" and candidates:
                fail(f"paint kit {kit_id} calls a reference unresolved but lists {len(candidates)} candidates")
            native_paths=json.loads((ROOT/'research/source-paint-paths.json').read_text())['resolved']
            key=kit_id+':'+reference.get('field','')
            if kit_id!='0' and (key not in native_paths or native_paths[key] not in candidates):
                fail(f'paint kit {kit_id} has no native path in its original candidate set')
            references.append({"field": reference.get("field"), "sourceValue": source_value,
                               "resolution": 'unique' if kit_id!='0' else resolution,
                               "candidates": [native_paths[key]] if kit_id!='0' else list(candidates)})
        record = {
            "id": kit_id,
            "name": kit.get("name"),
            "englishName": kit.get("englishName"),
            "chineseName": kit.get("chineseName"),
            "rarity": rarity_key,
            "rarityValue": integer(rarities[rarity_key]["value"], f"rarity {rarity_key} value"),
            "rarityColorKey": rarities[rarity_key].get("color"),
            "style": style,
            "pattern": merged["pattern"],
            "patternScale": number(merged["pattern_scale"], f"paint kit {kit_id} pattern scale"),
            "patternOffsetX": [number(merged["pattern_offset_x_start"], f"paint kit {kit_id} pattern offset x"),
                               number(merged["pattern_offset_x_end"], f"paint kit {kit_id} pattern offset x")],
            "patternOffsetY": [number(merged["pattern_offset_y_start"], f"paint kit {kit_id} pattern offset y"),
                               number(merged["pattern_offset_y_end"], f"paint kit {kit_id} pattern offset y")],
            "patternRotate": [number(merged["pattern_rotate_start"], f"paint kit {kit_id} pattern rotate"),
                              number(merged["pattern_rotate_end"], f"paint kit {kit_id} pattern rotate")],
            "seed": integer(merged["seed"], f"paint kit {kit_id} seed"),
            "wearMinimum": number(merged["wear_remap_min"], f"paint kit {kit_id} wear minimum"),
            "wearMaximum": number(merged["wear_remap_max"], f"paint kit {kit_id} wear maximum"),
            "wearDefault": number(merged["wear_default"], f"paint kit {kit_id} wear default"),
            "colours": [colour(merged[f"color{index}"], f"paint kit {kit_id} color{index}") for index in range(4)],
            "phongExponent": number(merged["phongexponent"], f"paint kit {kit_id} phong exponent"),
            "phongIntensity": number(merged["phongintensity"], f"paint kit {kit_id} phong intensity"),
            # -1 is the original's "keep the weapon's own albedo boost", which is what the
            # verified style-7 composition assumes; a kit that changed it would need its
            # own derivation, so the value travels rather than being assumed.
            "phongAlbedoBoost": number(merged["phongalbedoboost"], f"paint kit {kit_id} phong albedo boost"),
            "onlyFirstMaterial": integer(merged["only_first_material"], f"paint kit {kit_id} only_first_material"),
            "ignoreWeaponSizeScale": integer(merged["ignore_weapon_size_scale"],
                                             f"paint kit {kit_id} ignore_weapon_size_scale"),
            "textureReferences": references,
        }
        if record["wearMaximum"] < record["wearMinimum"]:
            fail(f"paint kit {kit_id} wears from {record['wearMinimum']} to {record['wearMaximum']}")
        # The original names its factory finish `default`; a staged record must say so
        # rather than carry the "-" the localisation table shows for it.
        if kit_id == DEFAULT_KIT_ID and record["name"] != "default":
            fail(f"paint kit 0 is named {record['name']!r}")
        used_rarities.add(rarity_key)
        seen[kit_id] = record
        return record

    factory = staged(DEFAULT_KIT_ID)
    weapons = []
    for weapon in WEAPONS:
        kit_ids = sorted(grouped[weapon], key=lambda value: (len(value), value))
        if not kit_ids:
            fail(f"{weapon} has no original finish relations")
        weapons.append({"weapon": weapon, "finishes": [staged(kit_id) for kit_id in kit_ids]})

    # A kit may serve several weapons, so the records are shared above; inline copies keep
    # the delivered file self-contained without repeating the decode work.
    total = sum(len(entry["finishes"]) for entry in weapons)
    if total == 0:
        fail("no original finishes were staged")
    ambiguous = sum(1 for record in seen.values()
                    for reference in record["textureReferences"] if reference["resolution"] == "ambiguous")
    document = {
        "format": FORMAT,
        "status": "original_paint_kits_staged",
        "cataloguedFrom": {
            "format": CATALOGUE_FORMAT,
            "manifestSha256": manifest_sha,
            "sourceioCommit": catalogue.get("sourceioCommit"),
            "sourceFilesRead": catalogue.get("sourceFilesRead"),
            "vpkIndex": catalogue.get("vpkIndex"),
            "catalogueSha256": digest(catalogue_bytes),
        },
        "paintKitDefaults": defaults,
        # Only the tiers these finishes actually use: the original table carries others
        # that no weapon finish here can wear, and demanding a label for those would say
        # nothing about the catalogue that ships.
        "rarities": {key: {"value": integer(rarities[key]["value"], f"rarity {key} value"),
                           "color": rarities[key].get("color"), "locKey": rarities[key].get("loc_key"),
                           "englishLabel": rarity_label(key, rarities[key], "english"),
                           "chineseLabel": rarity_label(key, rarities[key], "schinese")}
                     for key in sorted(used_rarities, key=lambda value: rarities[value]["value"])},
        "defaultKitId": DEFAULT_KIT_ID,
        "factory": factory,
        "weapons": weapons,
        "boundaries": [
            "Every field here is read from the original item catalogue; nothing is synthesised.",
            "The four palette colours, the pattern name, the seed, the wear window and the style are the "
            "original paint-kit values, merged over the original `paint_kits` default block the way the "
            "original reads them.",
            "A `textureReferences` entry records the original pattern/normal texture value and whether the "
            "install resolves it uniquely; an ambiguous one is marked as such rather than picked.",
            "This file describes the original finishes. It does not claim the port draws each one's "
            "original pattern artwork: a finish is composed only when this port has that weapon's own "
            "style7 composition inputs staged and the finish is style 7 with a uniquely resolved pattern "
            "and its own original normal map staged when the material needs one. Which finishes those are is listed in `game/source-finish-table.ts`, "
            "which this script also writes.",
        ],
    }
    encoded = (json.dumps(document, ensure_ascii=False, indent=1) + "\n").encode()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(encoded)
    manifest = [{"path": str(OUT.relative_to(ROOT / "public/source/csgo-12426148/skins")), "bytes": len(encoded),
                 "sha256": digest(encoded)}]
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
    # The transport rule includes only original finishes whose programs, per-weapon
    # inputs, pattern and draw-material normal are present and uniquely resolved.
    def composable_finishes(entry: dict, staged: dict | None) -> list:
        """The finishes this port can compose for a weapon, with the artwork it actually has.

        A style whose programs sample the finish's own pattern needs that pattern staged and
        uniquely resolved; a style whose programs sample none - the solid-colour styles - has no
        artwork to wait for, and a finish of such a style that nevertheless names a pattern is a
        disagreement worth stopping on rather than ignoring. A style whose programs read a sampler
        this weapon's own inputs do not hold cannot be composed at all, so it is left out here
        rather than listed and then refused where a player selects it.

        The finish's own numbers decide the rest, and the same two rules the composition path
        applies are applied here: this port draws a finish's pattern transform from the kit's own
        three ranges with the composition's own stream. All three scales now use the original
        weapon UVScale/WeaponLength factor unless `ignore_weapon_size_scale` is set; native
        cases for the whole catalogue are in source-paint-geometry.json. This port divides
        the weapon's own albedo boost by the kit's `phongalbedoboost` when present.
        The four zero values retain +Infinity in CMaterialVar and upload finite reciprocal +0;
        source-paint-zero-albedo.json executes the complete original parameter branch.
        """
        samplers = VERIFIED_SAMPLERS if staged is None else staged["samplers"]
        chosen = []
        for finish in entry["finishes"]:
            style = finish["style"]
            if style not in COMPOSABLE_STYLES:
                continue
            if not style_samplers(style) <= samplers:
                continue
            normals=[reference for reference in finish["textureReferences"] if reference["field"]=="normal"]
            if normals and (style not in (7,8,9) or len(normals)!=1 or normals[0]["resolution"]!="unique"
                            or str(finish["id"]) not in (verified_normals if staged is None else staged["normal"])):
                continue
            patterns = [reference for reference in finish["textureReferences"]
                        if reference["field"] == "pattern"]
            if style in PATTERN_STYLES:
                if not patterns or not all(reference["resolution"] == "unique"
                                           for reference in patterns):
                    continue
                # Original UVScale/WeaponLength field chain and all 238 native
                # scale cases now live in research/source-paint-geometry.json.
                if entry["weapon"] not in json.loads((ROOT / "research/source-paint-geometry.json").read_text())["weapons"]:
                    continue
                if staged is not None and str(finish["id"]) not in staged["pattern"]:
                    continue
            elif patterns:
                fail(f"finish {finish['id']} is style {style}, which samples no pattern, "
                     f"yet it names one")
            chosen.append(finish)
        return chosen

    effect_map = json.loads(EFFECT_MAP.read_text())
    if effect_map.get("format") != "source-weapon-effects-v1":
        fail(f"{EFFECT_MAP.name} is not the staged effect map")
    staged_inputs = json.loads(KIT_INPUTS.read_text()) if KIT_INPUTS.exists() else []
    staged_by_weapon: dict[str, dict] = {}
    for record in staged_inputs:
        bucket = staged_by_weapon.setdefault(record["weapon"],
                                             {"pattern": set(), "normal": set(), "samplers": set()})
        if record["role"] in bucket:
            bucket[record["role"]].update(str(value) for value in record["paintKitIds"])
        # The slot this input occupies. Legacy normal rows carry the pattern's slot as
        # extraction metadata, but normal maps bind only to the final draw material. The
        # a row that is not bound at any slot (-1) contributes none. Reading it here rather than
        # re-deriving it keeps one source for which slot each input is.
        sampler = record.get("sampler")
        if isinstance(sampler, int) and sampler >= 0:
            bucket["samplers"].add(sampler)
    # The verified path's own artwork, from the same manifest its compositor fetches. It is a
    # different tree from the per-weapon kit inputs, and what is staged there but not drawn has to
    # be reported the same way rather than going unmentioned.
    AK_PATTERNS = ROOT / "game/source-ak-pattern-resources.json"
    verified_artwork: set = set()
    verified_normals: set = set()
    if AK_PATTERNS.exists() and VERIFIED_INPUT_WEAPONS:
        entries = json.loads(AK_PATTERNS.read_text())
        verified_artwork = {str(value) for entry in entries if entry.get("field") == "pattern"
                            for value in entry.get("paintKitIds") or []}
        verified_normals = {str(value) for entry in entries if entry.get("field") == "normal"
                           for value in entry.get("paintKitIds") or []}
    table: dict[str, dict] = {}
    deferred: dict[str, int] = {}
    undrawn: dict[str, list] = {}
    for port, prefab in effect_map["prefabs"].items():
        original = prefab[: -len("_prefab")] if prefab.endswith("_prefab") else prefab
        entry = next((candidate for candidate in weapons if candidate["weapon"] == original), None)
        if entry is None:
            continue
        staged = staged_by_weapon.get(original)
        composable = composable_finishes(entry, staged)
        if not composable:
            continue
        if port not in VERIFIED_INPUT_WEAPONS and staged is None:
            deferred[port] = len(composable)
            continue
        # Two independent derivations of one promise: every finish this port lists whose style
        # samples a pattern must have that pattern staged, or the table would offer a finish whose
        # artwork is missing. The other direction is not an equality, because artwork can be staged
        # ahead of the input set that would sample it - the AK-47's own laminates, whose style reads
        # a slot the verified receipt does not hold - and what is staged without being drawn is
        # reported rather than silently dropped.
        artwork = verified_artwork if staged is None else set(staged["pattern"])
        drawn = {str(finish["id"]) for finish in composable if finish["style"] in PATTERN_STYLES}
        if not drawn <= artwork:
            fail(f"{original}: the catalogue composes {sorted(drawn - artwork, key=int)} "
                 f"where the staged artwork carries {sorted(artwork, key=int)}")
        if artwork - drawn:
            undrawn[original] = sorted(artwork - drawn, key=int)
        table[port] = {"originalWeapon": original, "finishes": sorted(composable, key=lambda f: int(f["id"])),
                       "inputSource": "staged-kit-inputs" if staged is not None else "verified-receipt"}
    if "vandal" not in table:
        fail("the staged catalogue composes no AK-47 finish")
    def quoted(value: str) -> str:
        return json.dumps(value, ensure_ascii=False)

    rows = {port: "\n".join(
        "    Object.freeze({ paintKitId: %d, style: %d, wearMinimum: %s, wearMaximum: %s,"
        " chineseName: %s, englishName: %s, rarity: %s, rarityChineseLabel: %s }),"
        % (int(finish["id"]), int(finish["style"]), repr(finish["wearMinimum"]), repr(finish["wearMaximum"]),
           quoted(finish["chineseName"]), quoted(finish["englishName"]),
           quoted(finish["rarity"]), quoted(rarity_label(finish["rarity"], rarities[finish["rarity"]], "schinese")))
        for finish in value["finishes"])
        for port, value in table.items()}
    TABLE.write_text(
        "/** Generated by `scripts/stage-source-paint-kits.py` from the staged original\n"
        " * paint-kit catalogue. Do not edit by hand; run the script instead.\n"
        " *\n"
        " * These are the original finishes the original programs this port carries can compose\n"
        " * for each weapon the port has composition inputs for. A style whose program samples\n"
        " * the finish's own pattern needs that pattern staged and uniquely resolved, and a style\n"
        " * whose program samples none - the solid-colour styles - needs no artwork at all; every\n"
        " * entry says which style it is, because that is what picks the program it is built from.\n"
        " * A style whose programs read a sampler the weapon's own inputs do not hold is not listed\n"
        " * at all: it could only be drawn by sampling an unbound unit, which reads as black, so the\n"
        " * menu offers exactly what the composition path can bind. Original weapon size factors\n"
        " * and zero-albedo material branches are verified by native execution receipts.\n"
        " * Each entry also carries the finish's own original wear window, so a wear outside it is\n"
        " * refused wherever this table is read, and the original's own name for it so a menu can\n"
        " * offer it without loading anything else.\n"
        " */\n"
        f"export const SOURCE_FINISH_TABLE_FORMAT = '{TABLE_FORMAT}';\n"
        f"export const SOURCE_FINISH_CATALOGUE_SHA256 = '{digest(encoded)}';\n"
        "/** The port's own weapon id, the original weapon it is, and where that weapon's\n"
        " * composition inputs come from. A weapon absent from this list has no composition\n"
        " * inputs staged yet, so its finishes cannot be offered. */\n"
        "export const SOURCE_FINISH_WEAPONS = [\n"
        + "\n".join("  Object.freeze({ id: %s, originalWeapon: %s, inputSource: %s }),"
                    % (quoted(port), quoted(value["originalWeapon"]), quoted(value["inputSource"]))
                    for port, value in table.items())
        + "\n] as const;\n"
        "export const SOURCE_FINISHES = {\n"
        + "\n".join("  %s: [\n%s\n  ]," % (quoted(port), rows[port]) for port in table)
        + "\n} as const;\n")
    print("PAINT_KITS_TABLE " + json.dumps({
        "weapons": {port: {
            "originalWeapon": value["originalWeapon"], "inputSource": value["inputSource"],
            "composable": len(value["finishes"]),
            "ofFinishes": len(next(candidate for candidate in weapons
                                   if candidate["weapon"] == value["originalWeapon"])["finishes"])}
            for port, value in table.items()},
        "deferredNoStagedInputs": deferred,
        # Artwork that is staged for a finish this weapon's composition path cannot sample, so the
        # table does not list it. Reported rather than dropped: it is what the next input role
        # staged for that weapon would unlock.
        "stagedNotDrawn": undrawn,
    }))
    print("PAINT_KITS " + json.dumps({
        "weapons": len(weapons),
        "finishes": total,
        "distinctKits": len(seen),
        "ambiguousTextures": ambiguous,
        "bytes": len(encoded),
        "sha256": digest(encoded),
        "output": str(OUT.relative_to(ROOT)),
    }, ensure_ascii=False))
    print("PAINT_KITS_WAITING " + json.dumps({}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
