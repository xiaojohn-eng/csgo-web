"""Decode the original grenade throw delta layers (Shoot_GREN1 x run/walk/idle/crouch,
T + CT) through the audited FRAMEANIM chain.

Same decode pattern as export-source-death-sequences.py. The five movement
variants share one structure: single animDesc, 14 frames @30fps, delta flag 4,
groupSize [1,1], no autoLayers, and a 0/1 boneWeights mask that zeroes the leg
chain on the moving variants so the locomotion cycle keeps driving the legs.
Outputs per-team npz frames, metadata, and an audit report.
"""
from __future__ import annotations
import hashlib, json, sys
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools'))
OUT_BASE = ROOT / '.reference-assets/source-exports/character-gren'
sha = lambda b: hashlib.sha256(b).hexdigest()

from SourceIO.library.models.mdl.v49 import MdlV49
from SourceIO.library.shared.app_id import SteamAppId
from SourceIO.library.shared.content_manager import ContentManager
from SourceIO.library.shared.content_manager.providers.vpk_provider import VPKContentProvider
from SourceIO.library.utils import TinyPath, MemoryBuffer

TEAMS = {'t': 'models/player/t_animations.mdl', 'ct': 'models/player/ct_animations.mdl'}
SEQUENCES = {
    829: 'Run_Shoot_GREN1', 830: 'Walk_Shoot_GREN1', 831: 'Idle_Shoot_GREN1',
    832: 'Crouch_Idle_Shoot_GREN1', 833: 'Crouch_Walk_Shoot_GREN1',
}


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
    from SourceIO.library.models.mdl.structs.local_animation import StudioAnimDesc

    summary = {}
    for team, source in TEAMS.items():
        raw = cm.find_file(TinyPath(source)); assert raw is not None
        raw_bytes = raw.read()
        buffer = MemoryBuffer(raw_bytes)
        mdl = MdlV49.from_buffer(buffer)
        ani = _resolve_ani_file(mdl, cm, TinyPath(source)); assert ani is not None
        blocks = _get_block_table(mdl, buffer)

        patch = StudioAnimDesc._read_frame_animations
        StudioAnimDesc._read_frame_animations = decode
        descriptors = []; raw_frames = {}; sequence_records = []; weight_masks = []
        try:
            for seq_index, expected in SEQUENCES.items():
                seq = mdl.sequences[seq_index]
                assert seq.name == expected, (seq_index, seq.name, expected)
                anims = [int(a) for a in seq.anim_desc_indices]
                assert len(anims) == 1, anims
                desc = mdl.anim_descs[anims[0]]
                assert int(desc.flags) & 64, 'This pass accepts FRAMEANIM only'
                assert int(desc.flags) & 4, 'GREN1 variants must be delta layers'
                assert desc.local_hierarchy_count == 0, 'Local hierarchy overrides need a separate audit'
                values = desc.read_animations(buffer, mdl.bones, ani.buffer, blocks); assert values is not None
                positions = np.stack([values[b.name]['pos'] for b in mdl.bones], axis=1).astype(np.float64)
                rotations = np.stack([values[b.name]['rot'] for b in mdl.bones], axis=1).astype(np.float64)
                assert positions.shape == (desc.frame_count, len(mdl.bones), 3)
                assert np.isfinite(positions).all() and np.isfinite(rotations).all()
                lengths = np.linalg.norm(rotations, axis=-1)
                assert np.min(lengths) > .99 and np.max(lengths) < 1.01
                raw_frames[anims[0]] = (positions, rotations / lengths[..., None])
                descriptors.append({'index': anims[0], 'name': desc.name, 'fps': desc.fps, 'frames': desc.frame_count,
                    'flags': int(desc.flags), 'delta': bool(int(desc.flags) & 4),
                    'maxQuaternionNormError': float(np.max(np.abs(lengths - 1))),
                    'ikRules': desc.ikrule_count, 'movements': desc.movement_count,
                    'sections': len(desc.get_sections(buffer))})
                fields = raw_sequence_fields(seq, mdl, buffer)
                assert fields['groupSize'] == [1, 1]
                assert fields['autoLayers'] == []
                weights = fields['boneWeights']
                assert len(weights) == len(mdl.bones) and all(w in (0.0, 1.0) for w in weights)
                zeroed = [mdl.bones[i].name for i, w in enumerate(weights) if w == 0.0]
                weight_masks.append({'sequence': seq.name, 'ones': sum(1 for w in weights if w == 1.0), 'zeros': len(zeroed), 'zeroedBones': zeroed})
                pose_parameters = []
                for i in range(mdl.header.local_pose_paramater_count):
                    start = mdl.header.local_pose_parameter_offset + i * 20
                    with buffer.read_from_offset(start):
                        name_offset, flags, low, high, loop = buffer.read_fmt('iifff')
                    with buffer.read_from_offset(start + name_offset): name = buffer.read_ascii_string()
                    pose_parameters.append({'index': i, 'name': name, 'flags': int(flags), 'start': low, 'end': high, 'loop': loop})
                sequence_records.append({'sourceModel': source, 'index': seq_index, 'name': seq.name,
                    'activityName': seq.activity_name, 'flags': int(seq.flags), 'category': 'grenade-throw',
                    'blendCount': int(seq.blend_count), 'animationIndices': anims,
                    'events': [], 'paramStart': [float(v) for v in seq.param_start], 'paramEnd': [float(v) for v in seq.param_end],
                    'eligibleSimpleAbsolute': False, **fields})
        finally:
            StudioAnimDesc._read_frame_animations = patch

        out = OUT_BASE / team; out.mkdir(parents=True, exist_ok=True)
        packed = {f'anim_{key}_{kind}': data for key, pair in raw_frames.items() for kind, data in zip(('positions', 'quaternions'), pair)}
        npz_path = out / 'gren-frames.npz'
        np.savez_compressed(npz_path, **packed)
        npz_bytes = npz_path.read_bytes()
        metadata = {'sourceModel': source, 'boneNames': [b.name for b in mdl.bones],
            'poseParameters': pose_parameters, 'sequences': sequence_records, 'descriptors': descriptors}
        metadata['frameFile'] = 'gren-frames.npz'
        meta_bytes = (json.dumps(metadata, indent=1) + '\n').encode()
        (out / 'gren-metadata.json').write_bytes(meta_bytes)
        audit = {'status': 'passed_gren_frame_decode', 'team': team, 'sourceModel': source,
            'sourceMdlSha256': sha(raw_bytes), 'sourceMdlBytes': len(raw_bytes),
            'aniResolved': True,
            'sequences': [{'index': r['index'], 'name': r['name'],
                'frames': next(d['frames'] for d in descriptors if d['index'] == r['animationIndices'][0]),
                'fps': next(d['fps'] for d in descriptors if d['index'] == r['animationIndices'][0]),
                'fadeIn': r['fadeIn'], 'fadeOut': r['fadeOut']} for r in sequence_records],
            'descriptors': descriptors, 'bones': len(mdl.bones),
            'frameDecoded': sum(d['frames'] for d in descriptors),
            'weightMasks': weight_masks,
            'npzSha256': sha(npz_bytes), 'npzBytes': len(npz_bytes),
            'metadataSha256': sha(meta_bytes),
            'boundary': 'Data export only. The five Shoot_GREN1 delta layers keep the original 0/1 bone-weight masks (moving variants zero the leg chain so locomotion keeps driving it). Throw playback policy (trigger on throw input, single 0.43s run, overlay on the current ground state) is a documented web port decision; the closed CS:GO client state machine is not reconstructed here.'}
        (out / 'gren-audit.json').write_text(json.dumps(audit, indent=1) + '\n')
        summary[team] = {k: v for k, v in audit.items() if k not in ('descriptors', 'weightMasks')}
        print('GREN_DECODED', team, json.dumps({'sequences': len(sequence_records),
            'frames': audit['frameDecoded'], 'npzBytes': len(npz_bytes)}))
    (OUT_BASE / 'summary.json').write_text(json.dumps(summary, indent=1) + '\n')
    print('ALL_TEAMS_DECODED', len(summary))


if __name__ == '__main__':
    main()
