#!/usr/bin/env python3
"""Read-only catalog of installed CS:GO legacy weapon, finish and sound sources.

Uses a bounded raw VPK DIRECTORY index and SourceIO's native API for selected payloads;
never calls glob('*'), decodes unfinished installs, modifies assets, or saves preferences.
Run via Blender --background --factory-startup --python this_file.py -- [--probe].
"""
from __future__ import annotations

from collections import Counter
import hashlib
import io
import json
from pathlib import Path
import re
import struct
import subprocess
import sys
import zlib
import wave

ROOT = Path(__file__).resolve().parent.parent
GAME = ROOT / ".reference-assets/csgo-legacy/csgo"
SOURCEIO = ROOT / ".tools/SourceIO"
COMMIT = "cfc2591d096628a35f570aa830ab75cc8665108b"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def json_kv(pairs):
    """Preserve duplicate keys and conditions; do not evaluate Win32/OSX branches."""
    result = {}
    for key, value in pairs:
        if isinstance(value, list):
            value = json_kv(value)
        elif isinstance(value, tuple):
            inner, condition = value
            value = {"condition": condition, "value": json_kv(inner) if isinstance(inner, list) else inner}
        if key in result:
            old = result[key]
            result[key] = old + [value] if isinstance(old, list) else [old, value]
        else:
            result[key] = value
    return result


def parse_kv(data, name):
    from SourceIO.library.utils.kv_parser import ValveKeyValueParser
    text = data.decode("utf-16") if data.startswith((b"\xff\xfe", b"\xfe\xff")) else data.decode("utf-8-sig")
    parser = ValveKeyValueParser(buffer_and_name=(text, name), self_recover=False)
    parser.parse()
    return json_kv(parser.tree.data)


def localization_tokens(data):
    # SourceIO's lexer rejects valid in-string Source chat color bytes (e.g. BEL).
    # Read only quoted single-line token/value pairs for display labels, retaining
    # original Unicode and escapes; do not alter the source or patch SourceIO.
    text = data.decode("utf-16") if data.startswith((b"\xff\xfe", b"\xfe\xff")) else data.decode("utf-8-sig")
    pairs = re.findall(r'^[ \t]*"((?:[^"\\\n]|\\.)*)"[ \t]+"((?:[^"\\\n]|\\.)*)"', text, re.MULTILINE)
    return {key.lower(): re.sub(r'\\(["\\])', r'\1', value) for key, value in pairs}


def directory_index(path):
    """Read only the 15 MB directory, not the 32 GB archive payload set."""
    raw = path.read_bytes()
    signature, version, tree_size = struct.unpack_from("<III", raw)
    if signature != 0x55AA1234 or version not in (1, 2):
        raise ValueError("Unexpected installed VPK format")
    offset = header_size = 28 if version == 2 else 12
    end = offset + tree_size
    entries = {}

    def word():
        nonlocal offset
        stop = raw.index(0, offset, end)
        value = raw[offset:stop].decode("utf-8")
        offset = stop + 1
        return value

    while extension := word():
        while folder := word():
            while name := word():
                crc, preload, archive, start, size, terminator = struct.unpack_from("<IHHIIH", raw, offset)
                if terminator != 0xFFFF:
                    raise ValueError("VPK directory entry terminator mismatch")
                offset += 18 + preload
                key = ((folder + "/") if folder != " " else "") + name + (("." + extension) if extension != " " else "")
                entries[key] = {"path": key, "bytes": preload + size, "crc32": f"{crc:08x}",
                    "preloadBytes": preload, "archiveIndex": archive, "archiveOffset": start, "archiveBytes": size}
    if offset != end:
        raise ValueError("VPK directory parse did not consume the complete tree")
    return entries, {"path": str(path.relative_to(ROOT)), "sha256": digest(raw),
                     "bytes": len(raw), "entries": len(entries), "version": version, "treeBytes": tree_size, "headerBytes": header_size}


class Sources:
    # A catalogue pass reads whatever it meets, so it is capped. A pass that reads a set
    # it has already enumerated and printed may declare its own bound instead, which is
    # what `read_budget` is for; the default is unchanged.
    default_read_budget = 96_000_000

    def __init__(self):
        from SourceIO.library.utils import TinyPath
        from SourceIO.library.utils.pylib import VPKFile
        self.TinyPath = TinyPath
        self.entries, self.index_info = directory_index(GAME / "pak01_dir.vpk")
        self.canonical_names = {p.casefold(): p for p in self.entries}
        if len(self.canonical_names) != len(self.entries):
            raise ValueError("Ambiguous case-insensitive VPK asset paths")
        self.archive = VPKFile(TinyPath(GAME / "pak01_dir.vpk"))
        self.reads = {}
        self.total_read_bytes = 0
        self.read_budget = self.default_read_budget

    def exists(self, relative):
        return (GAME / relative).is_file() or relative.casefold() in self.canonical_names

    def metadata(self, relative):
        if (GAME / relative).is_file():
            return {"path": relative, "container": "loose", "bytes": (GAME / relative).stat().st_size}
        canonical = self.canonical_names.get(relative.casefold())
        if canonical:
            return {**self.entries[canonical], "container": "pak01", **({"sourceSpelling": relative} if canonical != relative else {})}
        return {"path": relative, "missing": True}

    def read(self, relative):
        if not relative or ".." in Path(relative).parts or Path(relative).is_absolute():
            raise ValueError("Invalid relative source path")
        file = GAME / relative
        if file.is_file():
            data = file.read_bytes()
        else:
            relative = self.canonical_names.get(relative.casefold(), relative)
            data = self.archive.find_file(self.TinyPath(relative))
            if not isinstance(data, bytes):
                raise TypeError(f"SourceIO VPK payload is not bytes: {relative}, {type(data)}")
            entry = self.entries[relative]
            if len(data) != entry["bytes"] or f"{zlib.crc32(data):08x}" != entry["crc32"]:
                raise ValueError(f"Native SourceIO read differs from VPK index CRC/size: {relative}")
        self.reads[relative] = {**self.metadata(relative), "sha256": digest(data)}
        self.total_read_bytes += len(data)
        if self.total_read_bytes > self.read_budget:
            raise ValueError("Catalog selected-payload read budget exceeded")
        return data


def initialize():
    import bpy
    if not bpy.app.background or "--factory-startup" not in sys.argv:
        raise ValueError("Use an isolated background factory-startup Blender process")
    commit = subprocess.check_output(["git", "-C", str(SOURCEIO), "rev-parse", "HEAD"], text=True).strip()
    if commit != COMMIT:
        raise ValueError("Unreviewed SourceIO commit")
    sys.path.insert(0, str(SOURCEIO.parent))
    import SourceIO  # noqa: F401; no register/preferences mutation required.
    acf_path = GAME.parent / "steamapps/appmanifest_740.acf"
    acf = parse_kv(acf_path.read_bytes(), acf_path.name)["appstate"]
    if acf["stateflags"] != "4" or acf["updateresult"] != "0" or acf["bytestodownload"] != acf["bytesdownloaded"]:
        raise ValueError("App 740 install has not reached the successful complete state")
    installation = {key: acf[key] for key in ("appid", "name", "stateflags", "updateresult", "buildid", "installeddepots", "sizeondisk")}
    return {"installation": installation, "manifestSha256": digest(acf_path.read_bytes()),
            "sourceioCommit": commit, "blenderVersion": bpy.app.version_string}


def extract_ak_audio(sources, context):
    catalog = json.loads((ROOT / "research/source-items-catalog.json").read_text())
    destination = ROOT / ".reference-assets/source-exports/ak47/sounds"
    destination.mkdir(parents=True, exist_ok=True)
    entries = []
    for name in ("single", "clipout", "clipin", "boltpull", "draw"):
        event = catalog["soundEvents"]["weapon_ak47." + name]
        if len(event["waves"]) != 1:
            raise ValueError("Unexpected AK event variants; choose explicitly")
        original = event["waves"][0]
        relative = original["file"]["path"]
        data = sources.read(relative)
        with wave.open(io.BytesIO(data), "rb") as audio:
            description = {"container": "RIFF/WAVE", "compression": audio.getcomptype(),
                "channels": audio.getnchannels(), "sampleRate": audio.getframerate(),
                "sampleWidthBytes": audio.getsampwidth(), "frames": audio.getnframes(),
                "durationSeconds": audio.getnframes() / audio.getframerate()}
        path = destination / Path(relative).name
        if path.exists() and path.read_bytes() != data:
            raise ValueError("Existing private sound differs from source; refusing overwrite")
        path.write_bytes(data)
        if path.read_bytes() != data:
            raise ValueError("Extracted WAV readback differs from source")
        entries.append({"event": "Weapon_AK47." + {"single": "Single", "clipout": "Clipout", "clipin": "Clipin", "boltpull": "BoltPull", "draw": "Draw"}[name],
            "file": path.name, "sourceWaveSpecification": original["sourceWave"],
            "source": sources.metadata(relative), "bytes": len(data), "sha256": digest(data),
            "crc32": f"{zlib.crc32(data):08x}", **description, "byteIdenticalToOriginal": True})
    report = {"schemaVersion": 1, **context, "sounds": entries, "conversion": "none; original bytes extracted and CRC/SHA/readback verified"}
    (destination / "manifest.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print("AK_AUDIO_EXTRACTED", json.dumps(entries))


def merge_sections(items):
    """Repeated top-level econ sections append disjoint keyed records in this build."""
    report = {}
    for key, value in list(items.items()):
        if isinstance(value, list) and all(isinstance(block, dict) for block in value):
            merged, identical = {}, []
            for block in value:
                overlap = set(merged) & set(block)
                different = [name for name in overlap if merged[name] != block[name]]
                if different:
                    raise ValueError(f"Ambiguous conflicting econ section keys: {key} {sorted(different)[:5]}")
                identical.extend(sorted(overlap))
                merged.update(block)
            items[key] = merged
            report[key] = {"blocks": len(value), "records": len(merged), "conflictingRecordKeys": 0,
                           "repeatedIdenticalRecordKeys": identical}
    return report


def deep_merge(a, b):
    result = dict(a)
    for key, value in b.items():
        result[key] = deep_merge(result[key], value) if isinstance(result.get(key), dict) and isinstance(value, dict) else value
    return result


def combine_repeated_blocks(value):
    """Build a usable view of repeated nested KV blocks without choosing between
    conflicting scalar values. Raw source definitions are retained separately."""
    if isinstance(value, dict):
        return {k: combine_repeated_blocks(v) for k, v in value.items()}
    if isinstance(value, list) and all(isinstance(v, dict) for v in value):
        result = {}
        for block in value:
            for key, child in combine_repeated_blocks(block).items():
                if key not in result:
                    result[key] = child
                elif result[key] != child:
                    if isinstance(result[key], dict) and isinstance(child, dict):
                        result[key] = combine_repeated_blocks([result[key], child])
                    else:
                        old = result[key] if isinstance(result[key], list) else [result[key]]
                        result[key] = old + (child if isinstance(child, list) else [child])
        return result
    return value


def walk(value, path=()):
    if isinstance(value, dict):
        for key, child in value.items():
            yield path + (key,), child
            yield from walk(child, path + (key,))
    elif isinstance(value, list):
        for i, child in enumerate(value):
            yield from walk(child, path + (str(i),))


def scalar_values(value):
    """Flatten duplicate and conditional wave values, retaining conditions in raw KV."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for child in value:
            yield from scalar_values(child)
    elif isinstance(value, dict) and "value" in value and "condition" in value:
        yield from scalar_values(value["value"])


def wave_reference(spec, sources):
    candidate = re.sub(r"^[^A-Za-z0-9_./]+", "", spec).replace("\\", "/")
    if not candidate.startswith("sound/"):
        candidate = "sound/" + candidate
    return {"sourceWave": spec, "file": sources.metadata(candidate)}


def asset_reference(path, sources):
    metadata = sources.metadata(path)
    if metadata.get("missing") and not Path(path).suffix:
        # Source texture fields can omit materials/ and the VTF extension.
        stem = path if path.startswith("materials/") else "materials/" + path
        candidates = [sources.metadata(stem + suffix) for suffix in (".vtf", ".vmt") if sources.exists(stem + suffix)]
        if len(candidates) == 1:
            return {**candidates[0], "sourceValue": path, "referenceKind": "extensionless-material-resource"}
        if candidates:
            return {"path": path, "sourceValue": path, "referenceKind": "extensionless-material-resource",
                    "resolution": "ambiguous", "candidates": candidates}
    return metadata


def build_catalog(context, sources, items, sections):
    prefabs = items["prefabs"]
    prefab_cache = {}
    multi_parent = []
    unresolved_nonweapon = []

    class MissingPrefab(ValueError):
        pass

    def resolve(definition, ancestry=()):
        definition = combine_repeated_blocks(definition)
        names = definition.get("prefab", "").split()
        if len(names) > 1:
            multi_parent.append({"at": list(ancestry), "parents": names})
        output, trace = {}, []
        for name in names:
            if name in ancestry:
                raise ValueError(f"Cyclic source prefab: {name}")
            if name not in prefabs:
                raise MissingPrefab(f"Prefab not defined in this local items_game: {name}")
            if name not in prefab_cache:
                prefab_cache[name] = resolve(prefabs[name], ancestry + (name,))
            inherited, upstream = prefab_cache[name]
            output = deep_merge(output, inherited)
            trace.extend(upstream + [name])
        return deep_merge(output, definition), list(dict.fromkeys(trace))

    locales = {}
    for language in ("english", "schinese"):
        path = f"resource/csgo_{language}.txt"
        locales[language] = localization_tokens(sources.read(path))

    def label(token, language):
        return locales[language].get(str(token).lstrip("#").lower())

    weapons = []
    for identifier, raw in items["items"].items():
        if identifier == "default":
            continue
        # Resolve all definitions so weapon identity comes from original class,
        # not names, inferred prices, a modern CS2 list, or the Workbench package.
        try:
            resolved, chain = resolve(raw)
        except MissingPrefab as error:
            if str(raw.get("name", "")).startswith("weapon_"):
                raise
            unresolved_nonweapon.append({"id": identifier, "name": raw.get("name"), "prefab": raw.get("prefab"), "reason": str(error)})
            continue
        if not str(resolved.get("item_class", "")).startswith("weapon_"):
            continue
        paths = sorted({v for _, v in walk(resolved) if isinstance(v, str) and
                        (v.startswith("models/") or v.startswith("materials/"))})
        weapons.append({"id": identifier, "name": resolved.get("name"), "itemClass": resolved["item_class"],
            "englishName": label(resolved.get("item_name", ""), "english"),
            "chineseName": label(resolved.get("item_name", ""), "schinese"),
            "weaponType": resolved.get("visuals", {}).get("weapon_type"),
            "prefabChain": chain, "rawItem": raw, "resolvedDefinition": resolved,
            "referencedModelMaterialFiles": [asset_reference(p, sources) for p in paths]})
    weapons.sort(key=lambda w: int(w["id"]))
    weapon_names = {w["name"] for w in weapons}

    # Read the weapon event definitions through the real SourceIO VPK API.
    sound_path = "scripts/game_sounds_weapons.txt"
    events = parse_kv(sources.read(sound_path), sound_path)
    source_wave_specs, sound_events = set(), {}
    def add_event(event, definition, source):
        specs = []
        for path, value in walk(definition):
            if path[-1].lower() != "wave":
                continue
            specs.extend(scalar_values(value))
        waves = []
        for spec in sorted(set(v for v in specs if isinstance(v, str))):
            source_wave_specs.add(spec)
            waves.append(wave_reference(spec, sources))
        sound_events[event] = {"source": source, "definition": definition, "waves": waves}
    for event, definition in events.items():
        add_event(event, definition, sound_path)
    referenced_events = set()
    for weapon in weapons:
        refs = sorted({value for path, value in walk(weapon["resolvedDefinition"])
            if isinstance(value, str) and (path[-1].startswith("sound_") or path[-1].endswith("_sound"))})
        named = [ref for ref in refs if not ref.lower().endswith((".wav", ".mp3"))]
        weapon["directSoundFileReferences"] = [wave_reference(ref, sources) for ref in refs if ref not in named]
        weapon["soundEventReferences"] = [{"name": ref, "foundInWeaponSoundScript": ref.lower() in sound_events} for ref in named]
        referenced_events.update(ref.lower() for ref in named)
    # Only load two bounded shared event tables for names actually referenced by weapons.
    for supplemental in ("scripts/game_sounds.txt", "scripts/game_sounds_survival.txt"):
        if referenced_events <= sound_events.keys():
            break
        for event, definition in parse_kv(sources.read(supplemental), supplemental).items():
            if event in referenced_events and event not in sound_events:
                add_event(event, definition, supplemental)
    for weapon in weapons:
        for ref in weapon["soundEventReferences"]:
            event = sound_events.get(ref["name"].lower())
            ref["resolvedSource"] = event["source"] if event else None

    resource_paths = sorted(sources.entries)
    paint_paths = [p for p in resource_paths if p.startswith("materials/models/weapons/customization/paints")]
    base_material_paths = [p for p in resource_paths if p.startswith(("materials/models/weapons/v_models/", "materials/models/weapons/w_models/"))
                           and p.endswith((".vtf", ".vmt"))]
    audio_paths = [p for p in resource_paths if p.startswith("sound/weapons/")]
    paint_kits = []
    paint_by_name = {p["name"]: identifier for identifier, p in items["paint_kits"].items()}
    for identifier, definition in items["paint_kits"].items():
        texture_refs = []
        for key, value in definition.items():
            if key not in ("pattern", "normal", "logo_material", "wear_gradient", "vmt_path") and not any(word in key for word in ("texture", "material")):
                continue
            if not isinstance(value, str) or value in ("none", "", "0", "1"):
                continue
            normalized = value.replace("\\", "/").lower()
            suffixes = [normalized] if normalized.endswith((".vtf", ".vmt")) else [normalized + ".vtf", normalized + ".vmt"]
            matches = [p for p in paint_paths if any(p.lower() == s or p.lower().endswith("/" + s) for s in suffixes)]
            # Wear/logo helpers can live outside the paint-pattern subdirectory.
            if not matches:
                matches = [p for p in resource_paths if p.startswith("materials/") and any(p.lower() == s or p.lower().endswith("/" + s) for s in suffixes)]
            texture_refs.append({"field": key, "sourceValue": value, "candidates": matches,
                                 "resolution": "unique" if len(matches) == 1 else "ambiguous" if matches else "unresolved"})
        paint_kits.append({"id": identifier, "name": definition["name"],
            "englishName": label(definition.get("description_tag", ""), "english"),
            "chineseName": label(definition.get("description_tag", ""), "schinese"),
            "rarity": items["paint_kits_rarity"].get(definition["name"]),
            "definition": definition, "textureReferences": texture_refs})
    paint_kits.sort(key=lambda p: int(p["id"]))

    relations = {}
    for path, value in walk(items):
        for token in (path[-1], value if isinstance(value, str) else ""):
            match = re.fullmatch(r"\[([^\]]+)\](weapon_[a-zA-Z0-9_]+)", token)
            if not match:
                continue
            finish, weapon = match.groups()
            if finish not in paint_by_name or weapon not in weapon_names:
                continue
            pair = (weapon, finish)
            record = relations.setdefault(pair, {"weapon": weapon, "paintKitName": finish,
                "paintKitId": paint_by_name[finish], "evidence": []})
            source = "/" + "/".join(path)
            if source not in record["evidence"]:
                record["evidence"].append(source)
    # Econ generated icons give additional explicit knife/weapon finish pairings.
    icon_relations = 0
    icon_table = items["alternate_icons2"].get("weapon_icons", {})
    for icon_key, icon in icon_table.items():
        icon_path = icon.get("icon_path", "")
        base = icon_path.rsplit("/", 1)[-1]
        for weapon in sorted(weapon_names, key=len, reverse=True):
            if not base.startswith(weapon + "_"):
                continue
            suffix = base[len(weapon) + 1:]
            finish, _, variant = suffix.rpartition("_")
            if finish in paint_by_name and variant in ("light", "medium", "heavy"):
                record = relations.setdefault((weapon, finish), {"weapon": weapon, "paintKitName": finish,
                    "paintKitId": paint_by_name[finish], "evidence": []})
                record["evidence"].append(f"/alternate_icons2/weapon_icons/{icon_key}/icon_path={icon_path}")
                icon_relations += 1
            break

    missing_files = sorted({entry["path"] for w in weapons for entry in w["referencedModelMaterialFiles"] if entry.get("missing")})
    unresolved_events = sorted(referenced_events - sound_events.keys())
    missing_waves = sorted({wave["file"]["path"] for event in sound_events.values() for wave in event["waves"] if wave["file"].get("missing")})
    missing_direct_waves = sorted({wave["file"]["path"] for weapon in weapons for wave in weapon["directSoundFileReferences"] if wave["file"].get("missing")})
    # Preserve exact source enums and all prefab/attribute records, not just chosen headline stats.
    report = {"schemaVersion": 1, **context, "vpkIndex": sources.index_info,
        "sourceSections": sections, "weapons": weapons, "prefabs": prefabs,
        "attributeDefinitions": items["attributes"], "paintKits": paint_kits,
        "paintKitDefaults": items["paint_kits"]["0"], "rarities": items["rarities"], "qualities": items["qualities"],
        "weaponFinishRelations": sorted(relations.values(), key=lambda r: (r["weapon"], int(r["paintKitId"]))),
        "soundEvents": sound_events, "paintResources": [sources.metadata(p) for p in paint_paths],
        "baseWeaponMaterialResources": [sources.metadata(p) for p in base_material_paths],
        "weaponAudioResources": [sources.metadata(p) for p in audio_paths],
        "sourceFilesRead": list(sources.reads.values()),
        "summary": {"weaponItemDefinitions": len(weapons), "weaponTypes": dict(Counter(w["weaponType"] or "unspecified" for w in weapons)),
            "paintKits": len(paint_kits), "paintStyles": dict(Counter(p["definition"].get("style", "unspecified") for p in paint_kits)),
            "weaponFinishRelations": len(relations), "matchedIconEvidence": icon_relations,
            "weaponSoundEvents": len(events), "supplementalReferencedSoundEvents": len(sound_events) - len(events), "distinctWaveSpecifications": len(source_wave_specs),
            "weaponAudioFiles": len(audio_paths), "paintResourceFiles": len(paint_paths), "baseWeaponMaterialFiles": len(base_material_paths),
            "payloadBytesRead": sources.total_read_bytes},
        "review": {"missingReferencedModelMaterialPaths": missing_files,
            "unresolvedNamedSoundEvents": unresolved_events, "missingWavePaths": missing_waves, "missingDirectWavePaths": missing_direct_waves,
            "multiplePrefabParents": multi_parent,
            "unresolvedNonWeaponItems": unresolved_nonweapon,
            "textureReferenceResolution": dict(Counter(r["resolution"] for p in paint_kits for r in p["textureReferences"]))},
        "boundaries": ["Frozen App740 build data, not current CS2 rules or an engine implementation.",
            "Raw numeric strings and duplicate scalar definitions are retained. Duplicate scalar precedence is not guessed.",
            "Prefab preview uses recursive parent-first deep merge, then item override; raw records and chains remain available.",
            "Pattern suffix candidates are explicitly unique/ambiguous/unresolved; no invented shader/style path rule.",
            "VPK asset metadata is indexed, not decoded texture/audio content. Selected source text payloads are CRC/SHA verified.",
            "No first-person animation, recoil algorithm, hit simulation, shader, sound scheduling or public asset integration implemented."]}
    return report


def write_report(report):
    research = ROOT / "research"
    research.mkdir(exist_ok=True)
    (research / "source-items-catalog.json").write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    summary, review = report["summary"], report["review"]
    lines = ["# CS:GO legacy 原版武器、涂装与音效来源目录", "", "本报告由 `scripts/inventory-source-items.py` 从已完成安装的 App740 原文件生成。数值属于固定 build 12426148，不代表当前 CS2 规则。", "",
        "## 已验证的输入与读取边界", "", f"- AppID 740；StateFlags=4、UpdateResult=0、下载字节相等。Depot731 manifest=1224088799001669801；Depot740 manifest=6998097922547485721。",
        f"- SourceIO commit `{COMMIT}`，Blender {report['blenderVersion']}；仅进程内 import，没有 register 或保存偏好。",
        f"- pak01_dir.vpk 索引 {report['vpkIndex']['entries']:,} 条。只读取约 15 MB 目录，未用 `glob('*')` 展开全部内容。",
        f"- 累计读取必要原始文本 {summary['payloadBytesRead']:,} bytes；VPK 文本通过真实 SourceIO `find_file(TinyPath)` 读取并校验 CRC/字节数。源 SHA 在 JSON 的 sourceFilesRead。",
        "- 输出 JSON 保留全部武器 resolvedDefinition、rawItem、prefabChain、完整 prefabs、attributeDefinitions、paintKits、具名音效定义与文件索引。没有修改游戏资产、game 或 public。", "",
        "## 数据规模", "", "| 项目 | 数量 |", "| --- | ---: |"]
    for key in ("weaponItemDefinitions", "paintKits", "weaponFinishRelations", "weaponSoundEvents", "distinctWaveSpecifications", "weaponAudioFiles", "paintResourceFiles", "baseWeaponMaterialFiles"):
        lines.append(f"| {key} | {summary[key]:,} |")
    lines += ["", "`weaponItemDefinitions` 包括原文件中的枪械、刀具、投掷物和其他 weapon_ 类装备，不把它宣传成同样数量的枪。paintKits 包含 default、workshop 和手套等条目；配对只依据原集合/掉落表或明确生成图标记录。", "",
        "## 全部武器定义的主要数值", "", "原值保持字符串；空白表示该解析定义没有给出，不用经验值补齐。完整字段见 JSON。M4A4 的内部名为 weapon_m4a1，M4A1-S 是 weapon_m4a1_silencer；二者不能按 item_class 合并。", "",
        "| ID | 名称 | 内部 name | 类型 | 价格 | 弹匣 | 备用弹 | damage | cycletime | max speed |", "| ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for weapon in report["weapons"]:
        attrs = weapon["resolvedDefinition"].get("attributes", {})
        values = [weapon["id"], weapon["chineseName"] or weapon["englishName"] or "", weapon["name"], weapon["weaponType"] or ""]
        values += [str(attrs.get(k, "")) for k in ("in game price", "primary clip size", "primary reserve ammo max", "damage", "cycletime", "max player speed")]
        lines.append("| " + " | ".join(values) + " |")
    lines += ["", "## 参数和同名区块处理", "", "核心来源是 loose `scripts/items/items_game.txt`。本安装的 VPK/loose scripts 中没有独立 weapon_*.txt 参数表；武器属性位于 item → weapon prefab → 分类 prefab 继承链。保留原始 prefabs 与 item 覆盖，派生预览按父项再子项深合并。", "",
        "该文件会重复出现同名顶层区块，不能用普通字典直接覆盖，也不能只读取第一个。脚本合并的是没有重复 ID 的分块记录：", ""]
    for section in ("items", "prefabs", "paint_kits", "paint_kits_rarity", "item_sets"):
        data = report["sourceSections"].get(section)
        if data:
            lines.append(f"- {section}: {data['blocks']} 块、{data['records']} 条、0 冲突；原样相同重复键 {len(data['repeatedIdenticalRecordKeys'])} 个。")
    lines += ["", "FAMAS 的两个 attributes 区块在派生视图中合并，rawItem/prefabs 仍保留原区块。重复标量另行保留为数组，例如 M4A1-S 的 addon scale；不能擅自声称某个值就是引擎最终行为。所有武器继承均已解析，另有 76 个非武器经济条目引用本文件未定义的内建 valve prefab，明确记录并跳过。多个父 prefab 的情况和源条件保存在 JSON；本目录不替代 Source 引擎加载规则。", "",
        "本地化仅作名称标签：原文本存在合法的内嵌聊天颜色控制字节，当前 SourceIO KV lexer 不接受。因此标签单独读取每行带引号的 token/value 对，保留 Unicode，只反转义引号与反斜杠；不改原文本，不用该简化解析器读取经济规则。", "",
        "## 涂装到原文件", "", "每个 paintKit 保存原 style、pattern、颜色、wear、phong 等字段，默认条目另存。textureReferences 给出原字段与真实 VPK 路径候选；仅一个匹配时标 unique，多个标 ambiguous，没有标 unresolved。不会按现代 CS2 材质规则拼造目录。", "",
        f"当前纹理引用解析计数：`{review['textureReferenceResolution']}`。paintResources/baseWeaponMaterialResources 保留 VPK 中路径、字节数、CRC、分卷与偏移。这里没有解码 VTF 或宣称已还原原 shader。", "",
        "weaponFinishRelations 每一配对都有 items_game 的路径证据，来自 item_sets/client_loot_lists 等 `[paintkit]weapon_name` 条目或 alternate_icons2 的明确组合图标。定义存在不等于当前可购买/可掉落；本目录没有补造皮肤。", "",
        "## 具名音效到实际路径", "", "`scripts/game_sounds_weapons.txt` 的每个事件完整保存在 soundEvents；wave/rndwave 中每条原规格都保留前缀，并匹配真实 `sound/` 文件。源事件的 channel、volume、pitch、soundlevel、operator 等字段未丢弃。每把武器另列 visuals/zoom 引用的事件名；直接 WAV 引用另列 directSoundFileReferences，避免误当缺失事件。VPK 大小写匹配保留真实路径和原始拼写。", "",
        f"- 额外从共同事件表解析 {summary['supplementalReferencedSoundEvents']} 个武器引用事件；仍未解析的具名事件：`{review['unresolvedNamedSoundEvents']}`。",
        f"- 未找到实际文件的 wave 路径数量：{len(review['missingWavePaths'])}；完整清单见 JSON review.missingWavePaths。",
        f"- 武器定义直接 WAV 引用中未找到：`{review['missingDirectWavePaths']}`。保留原引用，不自动纠正拼写。",
        f"- 原定义引用、但当前 loose/pak01 没找到的模型/材质路径数量：{len(review['missingReferencedModelMaterialPaths'])}；保留原引用，不生成替代路径。这些旧 inventory icon VTF 引用不能等同于角色/枪械 MDL 缺失；实际清单见 JSON。省略 materials/ 和扩展名的贴图引用只在单一真实文件匹配时解析。", "",
        "## 验收边界与使用入口", "", "本次交付是可复核的数据目录，不是游戏内武器实现。recoil seed/幅度/方差、spread/inaccuracy、damage/range 等原参数已经保留，但原始算法、单位解释、穿透/命中、动画事件与音频调度仍需独立对接。武器几何/动画和地图转换由其他任务处理。", "",
        "```sh", "/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/inventory-source-items.py", "```", "",
        "其他任务可直接 import 本脚本的 `directory_index(Path(...pak01_dir.vpk))`，无需启动 Blender 或加载 SourceIO；它只读目录元数据。禁止使用 VPK glob('*') 来枚举，因为那个 API 同时读取每条 payload。", ""]
    (research / "source-items-catalog.md").write_text("\n".join(lines))


def main():
    context = initialize()
    sources = Sources()
    if "--extract-ak-audio" in sys.argv:
        extract_ak_audio(sources, context)
        return
    items = parse_kv(sources.read("scripts/items/items_game.txt"), "items_game.txt")["items_game"]
    if "--probe" in sys.argv:
        print("ITEM_SECTIONS", {key: len(value) if isinstance(value, dict) else str(value)[:100] for key, value in items.items()})
        for key in ("items", "paint_kits", "prefabs", "item_sets", "alternate_icons2"):
            value = items[key]
            if isinstance(value, list):
                merged = {}; collisions = []
                for block in value:
                    collisions.extend(set(merged) & set(block)); merged.update(block)
                print("DUPLICATE_SECTION", key, "blocks", len(value), "lengths", [len(b) for b in value], "collisions", collisions[:30])
                items[key] = merged
        prefabs = items["prefabs"]
        print("PREFAB_WEAPON_NAMES", [name for name in prefabs if "weapon_ak47" in name or "weapon_m4a" in name or "weapon_awp" in name])
        for key in ("7", "9", "16", "60"):
            print("ITEM", key, json.dumps(items["items"].get(key), ensure_ascii=False))
        for name in [n for n in prefabs if "weapon_ak47" in n or "weapon_m4a" in n or "weapon_awp" in n]:
            print("PREFAB", name, json.dumps(prefabs[name], ensure_ascii=False)[:12000])
        print("PAINTKITS", list(items["paint_kits"].items())[:2])
        print("WEAPON_SCRIPT_PATHS", [name for name in sources.entries if name.startswith("scripts/") and ("weapon" in name or "paint" in name)])
        print("PAINT_TEXTURE_PATHS", [(name, meta["bytes"]) for name, meta in sources.entries.items() if "customization/paints" in name][:30])
        print("WEAPON_SOUNDS_HEAD", sources.read("scripts/game_sounds_weapons.txt")[:3000].decode())
        print("CONTEXT", json.dumps(context))
        return
    sections = merge_sections(items)
    report = build_catalog(context, sources, items, sections)
    write_report(report)
    print("SOURCE_ITEMS_CATALOG", json.dumps(report["summary"]))


if __name__ == "__main__":
    main()
