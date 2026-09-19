"""Decode original jump_lower sequences (T + CT) through the audited FRAMEANIM chain.

Reuses the exact decoder pattern from scripts/source-character-animation.py
(StudioAnimDesc._read_frame_animations monkey-patch: constant + dynamic
channels, per-bone rest defaults) without modifying SourceIO or that script.
Outputs per-team npz frames, sequence metadata, and an audit report.
"""
from __future__ import annotations
import hashlib, json, sys
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools'))
OUT_BASE = ROOT / '.reference-assets/source-exports/character-jump'
sha = lambda b: hashlib.sha256(b).hexdigest()

from SourceIO.library.models.mdl.v49 import MdlV49
from SourceIO.library.shared.app_id import SteamAppId
from SourceIO.library.shared.content_manager import ContentManager
from SourceIO.library.shared.content_manager.providers.vpk_provider import VPKContentProvider
from SourceIO.library.utils import TinyPath, MemoryBuffer

TEAMS = {'t': 'models/player/t_animations.mdl', 'ct': 'models/player/ct_animations.mdl'}
SEQUENCE_INDEX = 6
JUMP_DESCRIPTOR_INDICES = [35, 34, 33, 36, 38, 32, 37, 30, 31]  # jump_lower's own animationIndices order


def decode(desc, data, bones, count):
    from SourceIO.library.models.mdl.structs.local_animation import AniBoneFlags, ANIM_DTYPE
    from SourceIO.library.models.mdl.structs.frame_anim import StudioFrameAnim
    from SourceIO.library.models.mdl.structs.compressed_vectors import Quat48, Quat48S
    start = data.tell(); header = StudioFrameAnim.from_buffer(data)
    flags = [AniBoneFlags(data.read_uint8()) for _ in bones]
    frames = {}
    for bone in bones:
        values = np.zeros(count, ANIM_DTYPE)
        values['rot'] = (0, 0, 0, 1) if int(desc.flags) & 4 else bone.quat
        if not int(desc.flags) & 4: values['pos'] = bone.position
        frames[bone.name] = values
    if header.constant_offset:
        data.seek(start + header.constant_offset)
        for bone, flag in zip(bones, flags):
            values = frames[bone.name]
            if flag & AniBoneFlags.CONST_ROT2: values['rot'] = Quat48S.read(data)
            if flag & AniBoneFlags.RAW_ROT: values['rot'] = Quat48.read(data)
            if flag & AniBoneFlags.RAW_POS: values['pos'] = data.read_fmt('3e')
            if flag & AniBoneFlags.CONST_POS2: values['pos'] = data.read_fmt('3f')
    if header.frame_offset and header.frame_length:
        for i in range(count):
            frame_start = start + header.frame_offset + i * header.frame_length
            data.seek(frame_start)
            for bone, flag in zip(bones, flags):
                values = frames[bone.name]
                if flag & AniBoneFlags.ANIM_ROT2: values[i]['rot'] = Quat48S.read(data)
                if flag & AniBoneFlags.ANIM_ROT: values[i]['rot'] = Quat48.read(data)
                if flag & AniBoneFlags.ANIM_POS: values[i]['pos'] = data.read_fmt('3e')
                if flag & AniBoneFlags.FULL_ANIM_POS: values[i]['pos'] = data.read_fmt('3f')
            assert data.tell() - frame_start == header.frame_length, 'Unaccounted dynamic channel bytes'
    else:
        assert not header.frame_length
    return frames


def raw_sequence_fields(seq, mdl, buffer):
    with buffer.read_from_offset(seq._entry_offset + 68): group_size = list(buffer.read_fmt('2I'))
    with buffer.read_from_offset(seq._entry_offset + 148): count, offset = buffer.read_fmt('2I')
    assert count == len(seq.auto_layers)
    assert group_size[0] * group_size[1] == len(seq.anim_desc_indices)
    layers = []
    with buffer.read_from_offset(seq._entry_offset + offset):
        for _ in range(count):
            sequence, pose, flags = buffer.read_fmt('hhI')
            start, peak, tail, end = buffer.read_fmt('4f')
            assert 0 <= sequence < len(mdl.sequences) and all(np.isfinite(v) for v in (start, peak, tail, end))
            layers.append({'sequence_id': sequence, 'sequence_name': mdl.sequences[sequence].name, 'pose_id': pose,
                           'flags': flags, 'start': start, 'peak': peak, 'tail': tail, 'end': end})
    return {'groupSize': group_size, 'parameterIndices': list(seq.param_offset), 'poseKeys': list(seq.pose_keys),
            'autoLayers': layers, 'boneWeights': list(seq.get_bone_weights(buffer, len(mdl.bones))) if seq.weight_offset else [],
            'activity': int(seq.activity), 'activityWeight': int(seq.activity_weight),
            'fadeIn': float(seq.fade_in_time), 'fadeOut': float(seq.fade_out_time), 'cyclePoseIndex': seq.cycle_pose_offset}


def main():
    cm = ContentManager(); cm.clean()
    provider = VPKContentProvider(TinyPath(str(ROOT / '.reference-assets/csgo-legacy/csgo/pak01_dir.vpk')), SteamAppId.COUNTER_STRIKE_GO)
    cm.add_child(provider); cm.priority_list = [provider]
    from SourceIO.library.models.mdl.load_animations import _resolve_ani_file, _get_block_table

    summary = {}
    for team, source in TEAMS.items():
        raw = cm.find_file(TinyPath(source)); assert raw is not None
        raw_bytes = raw.read()
        buffer = MemoryBuffer(raw_bytes)
        mdl = MdlV49.from_buffer(buffer)
        seq = mdl.sequences[SEQUENCE_INDEX]
        assert seq.name == 'jump_lower'
        ani = _resolve_ani_file(mdl, cm, TinyPath(source)); assert ani is not None
        blocks = _get_block_table(mdl, buffer)
        ani_bytes = ani.buffer.read() if hasattr(ani.buffer, 'read') else bytes(ani.buffer)

        # Frame decode through the audited chain
        StudioAnimDesc_patch = None
        from SourceIO.library.models.mdl.structs.local_animation import StudioAnimDesc
        StudioAnimDesc_patch = StudioAnimDesc._read_frame_animations
        StudioAnimDesc._read_frame_animations = decode

        bone_count = len(mdl.bones)
        descriptors = []; raw_frames = {}; observations = []
        try:
            for key in sorted(set(JUMP_DESCRIPTOR_INDICES)):
                assert key in JUMP_DESCRIPTOR_INDICES
                desc = mdl.anim_descs[key]
                assert int(desc.flags) & 64, 'This pass accepts FRAMEANIM only'
                assert desc.local_hierarchy_count == 0, 'Local hierarchy overrides need a separate audit'
                values = desc.read_animations(buffer, mdl.bones, ani.buffer, blocks); assert values is not None
                positions = np.stack([values[b.name]['pos'] for b in mdl.bones], axis=1).astype(np.float64)
                rotations = np.stack([values[b.name]['rot'] for b in mdl.bones], axis=1).astype(np.float64)
                assert positions.shape == (desc.frame_count, bone_count, 3) and desc.frame_count == 26
                assert np.isfinite(positions).all() and np.isfinite(rotations).all()
                lengths = np.linalg.norm(rotations, axis=-1)
                assert np.min(lengths) > .99 and np.max(lengths) < 1.01
                raw_frames[key] = (positions, rotations / lengths[..., None])
                descriptors.append({'index': key, 'name': desc.name, 'fps': desc.fps, 'frames': desc.frame_count,
                    'flags': int(desc.flags), 'delta': bool(int(desc.flags) & 4),
                    'maxQuaternionNormError': float(np.max(np.abs(lengths - 1))),
                    'ikRules': desc.ikrule_count, 'movements': desc.movement_count,
                    'sections': len(desc.get_sections(buffer))})
                observations.append({'index': key, 'name': desc.name, 'delta': False, 'frames': desc.frame_count})
        finally:
            StudioAnimDesc._read_frame_animations = StudioAnimDesc_patch

        # Sequence record in the same schema as production pose-data.json
        fields = raw_sequence_fields(seq, mdl, buffer)
        assert fields['groupSize'] == [3, 3] and fields['parameterIndices'] == [3, 4]
        assert fields['poseKeys'] == [-1.0, 0.0, 1.0, 1.0, 0.0, -1.0]
        assert fields['autoLayers'] == []
        assert len(fields['boneWeights']) == bone_count and all(w == 1.0 for w in fields['boneWeights'])
        pose_parameters = []
        for i in range(mdl.header.local_pose_paramater_count):
            start = mdl.header.local_pose_parameter_offset + i * 20
            with buffer.read_from_offset(start):
                name_offset, flags, low, high, loop = buffer.read_fmt('iifff')
            with buffer.read_from_offset(start + name_offset): name = buffer.read_ascii_string()
            pose_parameters.append({'index': i, 'name': name, 'flags': int(flags), 'start': low, 'end': high, 'loop': loop})
        sequence_record = {'sourceModel': source, 'index': SEQUENCE_INDEX, 'name': seq.name,
            'activityName': seq.activity_name, 'flags': int(seq.flags), 'category': 'jump',
            'blendCount': int(seq.blend_count), 'animationIndices': [int(a) for a in seq.anim_desc_indices],
            'events': [], 'paramStart': [float(v) for v in seq.param_start], 'paramEnd': [float(v) for v in seq.param_end],
            'eligibleSimpleAbsolute': False, **fields}

        # Bounded 9-way corner verification with the audited Python sampler
        sampler_spec = __import__('importlib.util', fromlist=['util'])
        import importlib.util
        spec = importlib.util.spec_from_file_location('source_pose_reference', ROOT / 'scripts/source-character-animation.py')
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        from types import SimpleNamespace
        sampler_mdl = SimpleNamespace(bones=[SimpleNamespace(position=b.position, quat=b.quat,
            flags=b.flags, q_alignment=b.q_alignment) for b in mdl.bones])
        metadata = {'sourceModel': source, 'boneNames': [b.name for b in mdl.bones],
            'poseParameters': pose_parameters, 'sequences': [sequence_record], 'descriptors': descriptors}
        engine = module.PoseSampler(sampler_mdl, metadata, raw_frames)
        corner_pos = corner_rot = 0.0; corners = 0
        xkeys, ykeys = sequence_record['poseKeys'][:3], sequence_record['poseKeys'][3:]
        for y, yvalue in enumerate(ykeys):
            for x, xvalue in enumerate(xkeys):
                params = {'move_y': xvalue, 'move_x': yvalue}
                for cycle in (0, .23, .51, .97):
                    expected = engine.frame(sequence_record['animationIndices'][x + y * 3], cycle)
                    for mode in ('sdk-3way', 'sdk-bilinear'):
                        actual = engine.calc(sequence_record, cycle, params, mode)
                        corner_pos = max(corner_pos, float(np.max(np.abs(actual[0] - expected[0]))))
                        corner_rot = max(corner_rot, float(np.max(1 - np.abs(np.sum(actual[1] * expected[1], axis=1)))))
                        corners += 1
        assert corner_pos < 1e-10 and corner_rot < 1e-10, (corner_pos, corner_rot)

        # Root-motion observation for the record (movements are NOT applied at runtime)
        root_index = next(i for i, b in enumerate(mdl.bones) if b.parent_id < 0)
        root_min = np.min(np.stack([raw_frames[k][0][:, root_index] for k in JUMP_DESCRIPTOR_INDICES]), axis=0)
        root_max = np.max(np.stack([raw_frames[k][0][:, root_index] for k in JUMP_DESCRIPTOR_INDICES]), axis=0)

        out = OUT_BASE / team; out.mkdir(parents=True, exist_ok=True)
        packed = {f'anim_{key}_{kind}': data for key, pair in raw_frames.items() for kind, data in zip(('positions', 'quaternions'), pair)}
        npz_path = out / 'jump-frames.npz'
        np.savez_compressed(npz_path, **packed)
        npz_bytes = npz_path.read_bytes()
        metadata['frameFile'] = 'jump-frames.npz'
        meta_bytes = (json.dumps(metadata, indent=1) + '\n').encode()
        (out / 'jump-metadata.json').write_bytes(meta_bytes)
        audit = {'status': 'passed_jump_frame_decode', 'team': team, 'sourceModel': source,
            'sourceMdlSha256': sha(raw_bytes), 'sourceMdlBytes': len(raw_bytes),
            'aniResolved': True, 'aniBytes': len(ani_bytes), 'aniSha256': sha(ani_bytes),
            'sequence': {'index': SEQUENCE_INDEX, 'name': 'jump_lower', 'flags': int(seq.flags),
                'groupSize': fields['groupSize'], 'parameterIndices': fields['parameterIndices'],
                'parameterNames': [pose_parameters[p]['name'] for p in fields['parameterIndices']],
                'poseKeys': fields['poseKeys'], 'autoLayers': fields['autoLayers'],
                'boneWeightsAllOne': True, 'activityName': seq.activity_name,
                'fadeIn': fields['fadeIn'], 'fadeOut': fields['fadeOut']},
            'descriptors': descriptors, 'bones': bone_count,
            'frameDecoded': sum(d['frames'] for d in descriptors),
            'cornerVerification': {'corners': corners, 'maxCornerPositionError': corner_pos,
                'maxCornerQuaternionDotError': corner_rot},
            'rootPositionRange': {'min': root_min.tolist(), 'max': root_max.tolist(),
                'note': 'Encoded root motion preserved; movement records not applied at runtime (same policy as locomotion states).'},
            'npzSha256': sha(npz_bytes), 'npzBytes': len(npz_bytes),
            'metadataSha256': sha(meta_bytes),
            'boundary': 'Data export only. Playback of jump_lower as the airborne lower body is a documented web port decision; the closed CS:GO client state machine is not reconstructed here.'}
        (out / 'jump-audit.json').write_text(json.dumps(audit, indent=1) + '\n')
        summary[team] = {k: v for k, v in audit.items() if k not in ('descriptors',)}
        print('JUMP_DECODED', team, json.dumps({'descriptors': len(descriptors),
            'frames': audit['frameDecoded'], 'corners': corners,
            'maxCornerPositionError': corner_pos, 'maxCornerQuaternionDotError': corner_rot,
            'npzSha256': audit['npzSha256']}))

    print(json.dumps(summary, indent=1))


if __name__ == '__main__':
    main()
