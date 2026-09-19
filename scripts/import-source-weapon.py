"""Audit one verified App 740 viewmodel; optionally export four checked clips.

Run in project-local, native Blender with --background --factory-startup.
Never reads game files until the explicit completion gate and ACF checks pass.
"""
from __future__ import annotations

import argparse
from collections import defaultdict, deque
from dataclasses import asdict
import hashlib
import json
import math
from pathlib import Path
import platform
import re
import struct
import subprocess
import sys
import time
import traceback

ROOT = Path(__file__).resolve().parents[1]
COMMIT = "cfc2591d096628a35f570aa830ab75cc8665108b"
START = time.perf_counter()
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--install-root", type=Path, default=ROOT / ".reference-assets/csgo-legacy")
parser.add_argument("--confirmed-complete", action="store_true", required=True)
parser.add_argument("--model", help="Verified relative VPK model path; default selects actual AK47 then M4")
parser.add_argument("--export-glb", action="store_true")
parser.add_argument("--arms-model", help="Optional original arms MDL; matched bones retain the arms' own inverse bind")
parser.add_argument("--output-dir", type=Path, default=ROOT / "output/source-weapon")
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
OUT = args.output_dir.resolve()
assert OUT.is_relative_to(ROOT) and not OUT.is_relative_to(ROOT / "public")
OUT.mkdir(parents=True, exist_ok=True)
report = {"status": "running", "scope": "one Source 1 viewmodel, source metadata and checked absolute clips",
          "sourceio_commit": COMMIT, "source_scale": 1.0, "units": "original Source coordinates; physical unit uncalibrated",
          "sourceio_default_scale": 0.01905, "game_public_modified": False,
          "dependencies": {}, "missing_lookup_attempts": [], "clip_checks": {}}


def serial(value):
    if hasattr(value, "tolist"):
        return value.tolist()
    if hasattr(value, "__dataclass_fields__"):
        return asdict(value)
    if isinstance(value, Path):
        return str(value)
    raise TypeError(type(value).__name__)


def save():
    report["elapsed_seconds"] = time.perf_counter() - START
    (OUT / "audit.json").write_text(json.dumps(report, ensure_ascii=False, indent=2, default=serial) + "\n")


def checkpoint(stage):
    report["stage"] = stage
    save()
    print("SOURCE_WEAPON_STAGE", stage, flush=True)


def hash_buffer(buffer):
    position = buffer.tell()
    buffer.seek(0)
    h = hashlib.sha256()
    size = 0
    while buffer.remaining():
        chunk = buffer.read(min(1024 * 1024, buffer.remaining()))
        h.update(chunk)
        size += len(chunk)
    buffer.seek(position)
    return {"bytes": size, "sha256": h.hexdigest()}


def category(sequence):
    name = (sequence.name + " " + sequence.activity_name).lower()
    if any(s in name for s in ("inspect", "lookat")):
        return "inspect"
    if "reload" in name:
        return "reload"
    if any(s in name for s in ("primaryattack", "secondaryattack", "shoot", "fire")):
        return "fire"
    if "idle" in name:
        return "idle"
    return None


def main():
    install = args.install_root.resolve()
    assert install.is_relative_to(ROOT / ".reference-assets"), "Only project reference content may be mounted"
    acf = install / "steamapps/appmanifest_740.acf"
    text = acf.read_text()
    for key, value in (("appid", "740"), ("StateFlags", "4"), ("buildid", "12426148")):
        assert re.search(r'"' + key + r'"\s+"' + value + '"', text, re.I), f"ACF completion gate failed: {key}"
    for manifest in ("1224088799001669801", "6998097922547485721"):
        assert manifest in text, "Unexpected installed depot manifest"
    report["install_receipt"] = {"acf": str(acf), "sha256": hashlib.sha256(acf.read_bytes()).hexdigest(),
                                 "buildid": 12426148, "StateFlags": 4}

    import bpy
    import numpy as np
    from mathutils import Matrix, Quaternion, Vector
    assert bpy.app.background and "--factory-startup" in sys.argv
    assert platform.machine() == "arm64"
    source = ROOT / ".tools/SourceIO"
    assert subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip() == COMMIT
    assert not subprocess.check_output(["git", "-C", str(source), "status", "--porcelain", "--untracked-files=no"], text=True).strip()
    sys.path.insert(0, str(source.parent))
    import SourceIO
    SourceIO.register()
    report["environment"] = {"blender": bpy.app.version_string, "python": platform.python_version(),
                             "machine": platform.machine(), "sourceio": list(SourceIO.bl_info["version"])}
    from SourceIO.library.shared.app_id import SteamAppId
    from SourceIO.library.shared.content_manager import ContentManager
    from SourceIO.library.shared.content_manager.providers.loose_files import LooseFilesContentProvider
    from SourceIO.library.shared.content_manager.providers.vpk_provider import VPKContentProvider
    from SourceIO.library.utils import TinyPath
    from SourceIO.library.models.mdl.v49 import MdlV49
    from SourceIO.library.models.mdl.load_animations import AnimationData, load_animations_from_mdl
    from SourceIO.library.models.mdl.structs.local_animation import StudioAnimDesc, AniBoneFlags, ANIM_DTYPE
    from SourceIO.library.models.mdl.structs.frame_anim import StudioFrameAnim
    from SourceIO.library.models.mdl.structs.compressed_vectors import Quat48, Quat48S
    from SourceIO.library.source1.vmt import VMT
    from SourceIO.blender_bindings.models import import_model
    from SourceIO.blender_bindings.operators.import_settings_base import ModelOptions
    from SourceIO.blender_bindings.models.common import put_into_collections
    from SourceIO.blender_bindings.models.import_animations import import_animations_to_armature
    from SourceIO.blender_bindings.models.prop_animations import _assign_action
    from SourceIO.library.utils.pylib.vtf import load_vtf_texture
    from SourceIO.library.utils.pylib.image import encode_png

    # Narrow process-local adapter for the observed CS:GO FRAMEANIM layout.
    # Pinned SourceIO incorrectly asserts constant and per-frame data are exclusive.
    # Keep its structure/packed-value readers; validate every dynamic frame stride.
    # This is a file-format inference from the original ANI + existing SourceIO types,
    # not a claim that Valve's public Source SDK 2013 contains CS:GO's private decoder.
    report["frame_animation_adapter"] = {"scope": "non-delta FRAMEANIM with constant and/or per-frame channels",
                                         "sourceio_files_modified": False, "observations": []}

    def read_csgo_frame_animation(desc, buffer, bones, frame_count):
        assert not (int(desc.flags) & 4), "Delta FRAMEANIM requires a separate semantic audit"
        start = buffer.tell()
        header = StudioFrameAnim.from_buffer(buffer)
        flags = [AniBoneFlags(buffer.read_uint8()) for _ in bones]
        frames = {}
        for bone in bones:
            data = np.zeros(frame_count, ANIM_DTYPE)
            data["pos"] = bone.position
            data["rot"] = bone.quat
            frames[bone.name] = data
        constant_bytes = 0
        if header.constant_offset:
            buffer.seek(start + header.constant_offset)
            for bone, flag in zip(bones, flags):
                data = frames[bone.name]
                if flag & AniBoneFlags.CONST_ROT2:
                    data["rot"] = Quat48S.read(buffer)
                if flag & AniBoneFlags.RAW_ROT:
                    data["rot"] = Quat48.read(buffer)
                if flag & AniBoneFlags.RAW_POS:
                    data["pos"] = buffer.read_fmt("3e")
                if flag & AniBoneFlags.CONST_POS2:
                    data["pos"] = buffer.read_fmt("3f")
            constant_bytes = buffer.tell() - start - header.constant_offset
        observed_strides = set()
        if header.frame_offset and header.frame_length > 0:
            for index in range(frame_count):
                frame_start = start + header.frame_offset + index * header.frame_length
                buffer.seek(frame_start)
                for bone, flag in zip(bones, flags):
                    data = frames[bone.name]
                    if flag & AniBoneFlags.ANIM_ROT2:
                        data[index]["rot"] = Quat48S.read(buffer)
                    if flag & AniBoneFlags.ANIM_ROT:
                        data[index]["rot"] = Quat48.read(buffer)
                    if flag & AniBoneFlags.ANIM_POS:
                        data[index]["pos"] = buffer.read_fmt("3e")
                    if flag & AniBoneFlags.FULL_ANIM_POS:
                        data[index]["pos"] = buffer.read_fmt("3f")
                consumed = buffer.tell() - frame_start
                observed_strides.add(consumed)
                assert consumed == header.frame_length, f"Unaccounted FRAMEANIM bytes: {consumed} != {header.frame_length}"
        else:
            assert header.frame_length == 0
        report["frame_animation_adapter"]["observations"].append({"animation": desc.name,
            "frames": frame_count, "constant_offset": header.constant_offset, "constant_bytes": constant_bytes,
            "frame_offset": header.frame_offset, "frame_length": header.frame_length,
            "observed_frame_bytes": sorted(observed_strides), "bone_flags": sorted(set(map(int, flags)))})
        return frames

    StudioAnimDesc._read_frame_animations = read_csgo_frame_animation

    cm = ContentManager()
    cm.clean()
    providers = []
    # Deliberately mount only the completed install. Exclude locale/low-violence variants.
    for folder, pak_name in ((install / "csgo", "pak01_dir.vpk"), (install / "platform", "platform_pak01_dir.vpk")):
        if folder.is_dir():
            providers.append(LooseFilesContentProvider(TinyPath(str(folder)), SteamAppId.COUNTER_STRIKE_GO))
            if (folder / pak_name).exists():
                providers.append(VPKContentProvider(TinyPath(str(folder / pak_name)), SteamAppId.COUNTER_STRIKE_GO))
    for provider in providers:
        cm.add_child(provider)
    cm.priority_list = providers[:]
    report["mounts"] = [str(p.filepath) for p in providers]
    raw_find = cm.find_file

    def find(path, do_not_cache=False):
        path = TinyPath(path)
        if path.is_absolute():
            assert Path(str(path)).resolve().is_relative_to(install), "Absolute resource lookup outside verified installation"
        result = raw_find(path, do_not_cache=do_not_cache)
        key = str(path)
        if result is not None and key not in report["dependencies"]:
            report["dependencies"][key] = hash_buffer(result)
        elif result is None and key not in report["missing_lookup_attempts"]:
            report["missing_lookup_attempts"].append(key)
        return result

    cm.find_file = find
    preferred = [args.model] if args.model else ["models/weapons/v_rif_ak47.mdl", "models/weapons/v_rif_m4a1.mdl",
                                               "models/weapons/v_rif_m4a1_s.mdl"]
    available = [p for p in preferred if p and cm.check(TinyPath(p))]
    if not available:
        for pattern in ("models/weapons/*ak47*.mdl", "models/weapons/*m4a1*.mdl"):
            available.extend(str(path) for path, _ in cm.glob(pattern) if str(path).split("/")[-1].startswith("v_"))
    assert available, "No actual preferred viewmodel found in completed content"
    model_path = TinyPath(available[0])
    report["available_candidates"] = sorted(set(available))
    report["selected_model"] = str(model_path)
    checkpoint("verified_mount_and_model")

    parsed = {}
    animation_data = {}
    pending = deque([str(model_path)])
    source_models = []
    sequences = []
    while pending:
        path = pending.popleft()
        if path in parsed:
            continue
        assert len(parsed) < 64, "Unexpectedly large recursive include-model graph"
        buffer = find(TinyPath(path))
        assert buffer is not None, f"Missing include model: {path}"
        buffer.seek(0)
        mdl = MdlV49.from_buffer(buffer)
        parsed[path] = mdl
        pending.extend(mdl.include_models)
        decoded = defaultdict(deque)
        for animation in load_animations_from_mdl(mdl, buffer, cm, TinyPath(path)):
            decoded[animation.name].append(animation)
        descriptors = []
        for index, desc in enumerate(mdl.anim_descs):
            key = f"{path}#{index}"
            data = decoded[desc.name].popleft() if decoded[desc.name] else None
            if data is not None:
                animation_data[key] = data
            descriptors.append({"key": key, "name": desc.name, "fps": desc.fps, "frame_count": desc.frame_count,
                "frame_span_seconds": (desc.frame_count - 1) / desc.fps if desc.fps > 0 else None,
                "flags": int(desc.flags), "loop": bool(int(desc.flags) & 1), "delta": bool(int(desc.flags) & 4),
                "animblock_id": desc.animblock_id, "decoded": data is not None,
                "decoded_bone_count": len(data.frames) if data else 0,
                "decoded_lengths": sorted(set(len(v) for v in data.frames.values())) if data else []})
        for index, seq in enumerate(mdl.sequences):
            mapped = [f"{path}#{i}" for i in seq.anim_desc_indices if 0 <= i < len(mdl.anim_descs)]
            sequences.append({"source_model": path, "sequence_index": index, "name": seq.name,
                "activity_name": seq.activity_name, "activity": seq.activity, "flags": seq.flags,
                "category": category(seq), "blend_count": seq.blend_count, "animation_keys": mapped,
                "anim_desc_indices": seq.anim_desc_indices, "last_frame": seq.last_frame,
                "events": [asdict(e) for e in seq.events], "auto_layers": [asdict(a) for a in seq.auto_layers],
                "fade_in": seq.fade_in_time, "fade_out": seq.fade_out_time,
                "bone_weights": seq.get_bone_weights(buffer, len(mdl.bones)) if seq.weight_offset else [],
                "param_start": seq.param_start, "param_end": seq.param_end})
        source_models.append({"path": path, "version": mdl.header.version, "name": mdl.header.name,
            "checksum": getattr(mdl.header, "checksum", None), "bone_count": len(mdl.bones),
            "include_models": mdl.include_models, "anim_block_name": mdl.header.anim_block_name,
            "materials": [m.name for m in mdl.materials], "material_paths": mdl.materials_paths,
            "attachments": [asdict(a) for a in mdl.attachments], "animations": descriptors})
    primary = parsed[str(model_path)]
    report["source_models"] = source_models
    report["sequences"] = sequences
    report["bones"] = [{"name": b.name, "parent_id": b.parent_id, "position": b.position,
        "quaternion_xyzw": b.quat, "flags": int(b.flags), "pose_to_bone": b.pose_to_bone} for b in primary.bones]
    checkpoint("source_graph_and_sequences")

    materials = []
    for material in primary.materials:
        candidates = [TinyPath("materials") / (material.name + ".vmt")]
        candidates += [TinyPath("materials") / p / (material.name + ".vmt") for p in primary.materials_paths]
        mat_path = next((p for p in candidates if cm.check(p)), None)
        item = {"name": material.name, "path": str(mat_path) if mat_path else None}
        if mat_path:
            vmt = VMT(find(mat_path), str(mat_path), cm)
            item["shader"] = vmt.shader
            item["parameters"] = {k: v for k, v in vmt.data.items() if isinstance(v, (str, int, float))}
            item["textures"] = []
            for k, v in item["parameters"].items():
                if isinstance(v, str) and ("texture" in k or k in ("$bumpmap", "$detail", "$envmapmask", "$phongexponenttexture")):
                    p = TinyPath("materials") / (v.removesuffix(".vtf") + ".vtf")
                    item["textures"].append({"parameter": k, "path": str(p), "exists": cm.check(p)})
        materials.append(item)
    report["materials"] = materials
    assert all(m["path"] for m in materials), "Missing source material dependencies"
    report["raw_texture_exports"] = []
    for material in materials:
        for texture in material.get("textures", []):
            buffer = find(TinyPath(texture["path"]))
            assert buffer is not None
            buffer.seek(0)
            pixels, width, height, is_float = load_vtf_texture(buffer.read())
            assert not is_float, "Float VTF needs a separate non-quantizing export"
            texture_dir = OUT / "textures"
            texture_dir.mkdir(exist_ok=True)
            filename = TinyPath(texture["path"]).stem + "-rgba.png"
            encoded = encode_png(pixels, width, height, 4)
            (texture_dir / filename).write_bytes(encoded)
            texture["raw_png"] = "textures/" + filename
            report["raw_texture_exports"].append({"source": texture["path"], "parameter": texture["parameter"],
                "path": str(texture_dir / filename), "width": width, "height": height, "rgba8_sha256": hashlib.sha256(pixels).hexdigest(),
                "png_sha256": hashlib.sha256(encoded).hexdigest(), "conversion": "native VTF RGBA8 -> lossless PNG; no color or shader conversion"})
    checkpoint("source_materials")

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    options = ModelOptions.default()
    options.scale = 1.0
    options.import_animations = False  # Metadata first; only individually checked absolute clips below.
    options.import_include_animations = False
    options.import_textures = True
    options.load_refpose = False
    options.use_bvlg = False
    container = import_model(model_path, find(model_path), cm, options, SteamAppId.COUNTER_STRIKE_GO)
    assert container and container.armature and container.objects
    put_into_collections(container, model_path.stem, bodygroup_grouping=True)
    armature = container.armature
    bpy.context.view_layer.objects.active = armature
    report["imported"] = {"bones": len(armature.data.bones), "meshes": [{"name": obj.name,
        "vertices": len(obj.data.vertices), "polygons": len(obj.data.polygons),
        "materials": [m.name if m else None for m in obj.data.materials]} for obj in container.objects],
        "images": [{"name": i.name, "size": list(i.size), "channels": i.channels} for i in bpy.data.images if i.size[0] > 0],
        "attachments": [o.name for o in container.attachments]}
    assert len(armature.data.bones) == len(primary.bones), "Imported bone count mismatch"
    assert {b.name for b in armature.data.bones} == {b.name for b in primary.bones}, "Bone names changed"
    for b in primary.bones:
        actual = armature.data.bones[b.name]
        assert (actual.parent.name if actual.parent else None) == (primary.bones[b.parent_id].name if b.parent_id >= 0 else None)
    checkpoint("model_imported")

    # Export source attachment local matrices as real bone children. SourceIO's
    # CHILD_OF constraints would otherwise become static unparented GLB markers.
    for source_attachment, obj in zip(primary.attachments, container.attachments):
        assert source_attachment.flags == 0, "World-aligned attachment requires separate semantics"
        local = Matrix([list(source_attachment.matrix[n:n + 4]) for n in (0, 4, 8)] + [[0, 0, 0, 1]])
        obj.constraints.clear()
        obj.parent = armature
        obj.parent_type = "BONE"
        obj.parent_bone = primary.bones[source_attachment.parent_bone].name
        obj.matrix_parent_inverse = Matrix.Identity(4)
        bone = armature.data.bones[obj.parent_bone]
        obj.matrix_basis = Matrix.Translation((0, -bone.length, 0)) @ local
        obj["source_attachment"] = {"name": source_attachment.name, "bone": obj.parent_bone,
                                    "local_matrix": list(source_attachment.matrix)}

    arms_container = None
    arms_actions = []
    if args.arms_model:
        arms_path = TinyPath(args.arms_model)
        assert not arms_path.is_absolute() and ".." not in str(arms_path).split("/")
        buffer = find(arms_path)
        assert buffer is not None
        buffer.seek(0)
        arms_mdl = MdlV49.from_buffer(buffer)
        arms_container = import_model(arms_path, find(arms_path), cm, options, SteamAppId.COUNTER_STRIKE_GO)
        assert arms_container and arms_container.armature and arms_container.objects
        put_into_collections(arms_container, arms_path.stem, bodygroup_grouping=True)
        arms_armature = arms_container.armature
        mapped = {b.name for b in arms_mdl.bones} & {b.name for b in primary.bones}
        weighted = set()
        for obj in arms_container.objects:
            weighted.update(obj.vertex_groups[g.group].name for v in obj.data.vertices for g in v.groups if g.weight > 0)
        assert weighted <= mapped, f"Weighted arms bones absent from weapon skeleton: {weighted - mapped}"
        inverse_bind_error = 0.0
        bind_difference = 0.0
        for b in arms_mdl.bones:
            raw_inverse = Matrix([list(row) for row in b.pose_to_bone.T] + [[0, 0, 0, 1]])
            inverse = arms_armature.data.bones[b.name].matrix_local.inverted()
            inverse_bind_error = max(inverse_bind_error, max(abs(raw_inverse[i][j] - inverse[i][j]) for i in range(4) for j in range(4)))
            if b.name in mapped:
                weapon_bind = armature.data.bones[b.name].matrix_local
                arms_bind = arms_armature.data.bones[b.name].matrix_local
                bind_difference = max(bind_difference, max(abs(weapon_bind[i][j] - arms_bind[i][j]) for i in range(4) for j in range(4)))
        assert inverse_bind_error < .002, f"Arms inverse bind mismatch: {inverse_bind_error}"
        report["arms"] = {"path": str(arms_path), "armature_name": arms_armature.name, "bone_count": len(arms_mdl.bones),
            "mapped_bones": sorted(mapped), "weighted_bones": sorted(weighted), "unmapped_unweighted_bones": sorted({b.name for b in arms_mdl.bones} - mapped),
            "max_source_inverse_bind_error": inverse_bind_error, "max_weapon_arms_rest_matrix_difference": bind_difference,
            "strategy": "separate original arms skin; copy matched weapon global bone transforms, derive arms-local keys; preserve original arms inverse bind",
            "meshes": [{"name": obj.name, "vertices": len(obj.data.vertices), "polygons": len(obj.data.polygons),
                        "materials": [m.name if m else None for m in obj.data.materials]} for obj in arms_container.objects]}
        checkpoint("arms_imported_and_bind_checked")

    scene = bpy.context.scene
    scene.render.fps = 60
    scene.render.fps_base = 1.0
    selected_actions = []

    def retime(action, fps):
        curves = [curve for layer in action.layers for strip in layer.strips for bag in strip.channelbags for curve in bag.fcurves]
        assert curves
        for curve in curves:
            for point in curve.keyframe_points:
                point.co.x = (point.co.x - 1) * 60 / fps
                point.interpolation = "LINEAR"
            curve.update()

    def source_worlds(frames, index):
        matrices = []
        for bone in primary.bones:
            pos = frames[bone.name][index]["pos"]
            x, y, z, w = frames[bone.name][index]["rot"]
            local = Matrix.LocRotScale(Vector(pos), Quaternion((w, x, y, z)), (1, 1, 1))
            matrices.append(matrices[bone.parent_id] @ local if bone.parent_id >= 0 else local)
        return {b.name: matrices[n] for n, b in enumerate(primary.bones)}

    for kind in ("idle", "fire", "reload", "inspect"):
        candidates = [s for s in sequences if s["category"] == kind]
        eligible = []
        for seq in candidates:
            keys = list(dict.fromkeys(seq["animation_keys"]))
            if len(keys) == 1 and keys[0] in animation_data:
                animation = animation_data[keys[0]]
                if not animation.is_delta and not seq["auto_layers"] and animation.fps > 0 and animation.frame_count > 1:
                    eligible.append((seq, keys[0], animation))
        assert eligible, f"No simple decoded absolute {kind} sequence; do not fabricate a clip"
        eligible.sort(key=lambda v: (v[0]["blend_count"] != 1, len(v[0]["name"]), v[0]["name"]))
        seq, key, original = eligible[0]
        assert all(b in armature.data.bones for b in original.frames), "Animation references bones absent from primary armature"
        frames = {}
        broadcast = []
        for bone, data in original.frames.items():
            if len(data) == 1 and original.frame_count > 1:
                frames[bone] = np.repeat(data, original.frame_count)
                broadcast.append(bone)
            else:
                assert len(data) == original.frame_count, f"Truncated decoded animation: {bone}"
                frames[bone] = data
            assert np.isfinite(frames[bone]["pos"]).all() and np.isfinite(frames[bone]["rot"]).all()
            assert np.min(np.linalg.norm(frames[bone]["rot"], axis=1)) > .9, "Invalid decoded quaternion"
        animation = AnimationData(original.name, original.fps, original.frame_count, original.bone_names,
                                  frames, original.is_looping, original.is_delta)
        for bone in armature.pose.bones:
            bone.matrix_basis = Matrix.Identity(4)
            bone.rotation_mode = "QUATERNION"
        actions = import_animations_to_armature(armature, [animation], 1.0)
        assert len(actions) == 1, f"SourceIO skipped {kind} action"
        action = actions[0]
        action.name = f"{kind}__{seq['name']}"
        action["source_fps"] = original.fps
        action["source_animation_key"] = key
        action["source_sequence"] = seq["name"]
        action["source_loop"] = original.is_looping
        action["source_delta"] = original.is_delta
        _assign_action(armature, action)
        retime(action, original.fps)
        if arms_container:
            arms_frames = {b.name: np.zeros(original.frame_count, ANIM_DTYPE) for b in arms_mdl.bones}
            for index in range(original.frame_count):
                source_matrices = source_worlds(frames, index)
                targets = []
                for b in arms_mdl.bones:
                    x, y, z, w = b.quat
                    local = Matrix.LocRotScale(Vector(b.position), Quaternion((w, x, y, z)), (1, 1, 1))
                    parent = targets[b.parent_id] if b.parent_id >= 0 else Matrix.Identity(4)
                    target = source_matrices[b.name] if b.name in mapped else parent @ local
                    targets.append(target)
                    local = parent.inverted() @ target
                    pos, rot, _ = local.decompose()
                    arms_frames[b.name][index]["pos"] = pos
                    arms_frames[b.name][index]["rot"] = (rot.x, rot.y, rot.z, rot.w)
            arm_anim = AnimationData(action.name + "__arms", original.fps, original.frame_count,
                                     list(arms_frames), arms_frames, original.is_looping, False)
            arm_action = import_animations_to_armature(arms_armature, [arm_anim], 1.0)[0]
            _assign_action(arms_armature, arm_action)
            retime(arm_action, original.fps)
            arms_actions.append((arm_action, action.name))
        indices = sorted(set([0, 1, original.frame_count // 2, original.frame_count - 2, original.frame_count - 1]
                             + [round(e["cycle"] * (original.frame_count - 1)) for e in seq["events"]]))
        samples = []
        max_matrix_error = 0.0
        max_arms_matrix_error = 0.0
        max_arms_vertex_error = 0.0
        max_attachment_error = 0.0
        for index in indices:
            index = max(0, min(original.frame_count - 1, index))
            frame = index * 60 / original.fps
            scene.frame_set(math.floor(frame), subframe=frame - math.floor(frame))
            bpy.context.view_layer.update()
            expected = []
            for bone in primary.bones:
                data = frames.get(bone.name)
                pos = data[index]["pos"] if data is not None else bone.position
                rot = data[index]["rot"] if data is not None else bone.quat
                x, y, z, w = rot
                local = Matrix.LocRotScale(Vector(pos), Quaternion((w, x, y, z)), (1, 1, 1))
                world = expected[bone.parent_id] @ local if bone.parent_id >= 0 else local
                expected.append(world)
                actual = armature.pose.bones[bone.name].matrix
                max_matrix_error = max(max_matrix_error, max(abs(actual[i][j] - world[i][j]) for i in range(4) for j in range(4)))
            samples.append({"source_frame": index, "seconds": index / original.fps,
                "blender_frame": frame, "bone_world_matrices": {b.name: [list(row) for row in armature.pose.bones[b.name].matrix]
                                                               for b in primary.bones}})
            for attachment, obj in zip(primary.attachments, container.attachments):
                local = Matrix([list(attachment.matrix[n:n + 4]) for n in (0, 4, 8)] + [[0, 0, 0, 1]])
                target = expected[attachment.parent_bone] @ local
                max_attachment_error = max(max_attachment_error, max(abs(obj.matrix_world[i][j] - target[i][j]) for i in range(4) for j in range(4)))
            if arms_container:
                source_matrices = {b.name: expected[n] for n, b in enumerate(primary.bones)}
                for name in mapped:
                    actual = arms_armature.pose.bones[name].matrix
                    target = source_matrices[name]
                    max_arms_matrix_error = max(max_arms_matrix_error, max(abs(actual[i][j] - target[i][j]) for i in range(4) for j in range(4)))
                vertex_samples = {}
                for obj in arms_container.objects:
                    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
                    mesh = evaluated.to_mesh()
                    matrices = {}
                    for b in arms_mdl.bones:
                        if b.name in weighted:
                            inverse = Matrix([list(row) for row in b.pose_to_bone.T] + [[0, 0, 0, 1]])
                            matrices[b.name] = source_matrices[b.name] @ inverse
                    points = []
                    for vertex in obj.data.vertices:
                        expected_point = Vector((0, 0, 0))
                        for group in vertex.groups:
                            if group.weight > 0:
                                expected_point += (matrices[obj.vertex_groups[group.group].name] @ vertex.co) * group.weight
                        actual_point = evaluated.matrix_world @ mesh.vertices[vertex.index].co
                        max_arms_vertex_error = max(max_arms_vertex_error, (actual_point - expected_point).length)
                        if vertex.index % 64 == 0 or vertex.index == len(obj.data.vertices) - 1:
                            points.append({"index": vertex.index, "bind_position": list(vertex.co), "source_position": list(expected_point),
                                           "blender_position": list(actual_point)})
                    vertex_samples[obj.name] = points
                    evaluated.to_mesh_clear()
                samples[-1]["arms_vertex_samples"] = vertex_samples
        report["clip_checks"][kind] = {"sequence": seq["name"], "animation_key": key, "animation_name": original.name,
            "fps": original.fps, "frame_count": original.frame_count,
            "duration_seconds": (original.frame_count - 1) / original.fps, "loop": original.is_looping,
            "delta": original.is_delta, "broadcast_constant_bones": broadcast,
            "max_raw_source_to_blender_matrix_error_source_units": max_matrix_error,
            "action_name": action.name, "events": seq["events"], "samples": samples}
        report["clip_checks"][kind].update({"max_attachment_matrix_error": max_attachment_error,
            "max_arms_global_matrix_error": max_arms_matrix_error, "max_arms_source_skinning_vertex_error": max_arms_vertex_error})
        assert max_matrix_error < .002, f"Source-to-Blender matrix mismatch for {kind}: {max_matrix_error}"
        assert max_attachment_error < .002, f"Source attachment parenting mismatch: {max_attachment_error}"
        assert max_arms_matrix_error < .002 and max_arms_vertex_error < .005, f"Arms bone merge or skinning mismatch: {max_arms_matrix_error}/{max_arms_vertex_error}"
        selected_actions.append(action)
        checkpoint(f"checked_{kind}")

    armature.animation_data.action = None
    for bone in armature.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    for action in selected_actions:
        track = armature.animation_data.nla_tracks.new()
        track.name = action.name
        strip = track.strips.new(action.name, 0, action)
        if hasattr(strip, "action_slot"):
            strip.action_slot = next(iter(action.slots))
    if arms_container:
        arms_armature.animation_data.action = None
        for bone in arms_armature.pose.bones:
            bone.matrix_basis = Matrix.Identity(4)
        for action, clip_name in arms_actions:
            track = arms_armature.animation_data.nla_tracks.new()
            track.name = clip_name
            strip = track.strips.new(action.name, 0, action)
            strip.action_slot = next(iter(action.slots))
    scene.frame_set(0)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in [armature, *container.objects, *container.attachments]:
        obj.select_set(True)
    if arms_container:
        for obj in [arms_armature, *arms_container.objects]:
            obj.select_set(True)
    bpy.context.view_layer.objects.active = armature
    if args.export_glb:
        output_glb = OUT / f"{model_path.stem}{'-with-arms' if arms_container else ''}-source-unit.glb"
        properties = bpy.ops.export_scene.gltf.get_rna_type().properties
        desired = {"filepath": str(output_glb), "export_format": "GLB", "use_selection": True,
            "export_animations": True, "export_animation_mode": "ACTIONS", "export_frame_range": False,
            "export_force_sampling": False, "export_optimize_animation_size": False, "export_skins": True,
            "export_all_influences": True, "export_def_bones": False, "export_extras": True, "export_tangents": True}
        if arms_container:
            desired.update({"export_merge_animation": "NLA_TRACK", "export_anim_single_armature": False})
        kwargs = {k: v for k, v in desired.items() if k in properties}
        assert {"export_animation_mode", "export_force_sampling", "export_animations"} <= kwargs.keys()
        assert bpy.ops.export_scene.gltf(**kwargs) == {"FINISHED"}
        payload = output_glb.read_bytes()
        length, kind = struct.unpack_from("<II", payload, 12)
        assert kind == 0x4E4F534A
        gltf = json.loads(payload[20:20 + length])
        report["glb"] = {"path": str(output_glb), "bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest(),
            "animations": [a.get("name") for a in gltf.get("animations", [])], "skins": len(gltf.get("skins", [])),
            "joints": [len(s["joints"]) for s in gltf.get("skins", [])], "materials": len(gltf.get("materials", [])),
            "images": len(gltf.get("images", [])), "export_parameters": kwargs}
        assert len(gltf.get("animations", [])) == 4 and gltf.get("skins"), "Export omitted expected animation/skin"
        (OUT / "gltf-structure.json").write_text(json.dumps(gltf, ensure_ascii=False, indent=2) + "\n")
    report["status"] = "passed_source_and_blender_checks"
    report["limitations"] = ["No original client visual comparison", "Physical metres not calibrated; source units preserved",
        "GLB structural readback only; independent playback comparison is a separate gate",
        "Only chosen simple absolute sequence per category; delta/multi-blend/auto-layer sequences are inventoried, not exported",
        "SourceIO VMT conversion does not prove original Source shader equivalence"]
    SourceIO.unregister()


try:
    main()
except Exception:
    report["status"] = "failed"
    report["error"] = traceback.format_exc()
    raise
finally:
    save()
    print("SOURCE_WEAPON_RESULT", report["status"], str(OUT / "audit.json"), flush=True)
