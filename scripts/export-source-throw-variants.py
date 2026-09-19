"""Decode the remaining original grenade throw graph through the audited
FRAMEANIM chain: the pin-pull preparation layers (Upper_GREN x 5 locomotion
variants with their original Aim_GREN + HandPos_GREN auto-layers) and the two
extra release variants (Shoot_GREN2 medium / Shoot_GREN3 underhand x 5).

Same decode pattern as export-source-gren-sequences.py. Structure per family
(audited by scripts/probe-source-throw-variants.py):
- Upper_GREN: 1 animDesc, non-delta FRAMEANIM (flags 0/64), groupSize [1,1],
  21/33/61/61/25 frames @30fps, exactly 2 auto-layers (Aim_GREN + HandPos_GREN
  of the same locomotion prefix, flags 0, start=peak=tail=end=0) and a 0/1
  bone-weight mask whose only two ones are the weapon_bone_*Hand grenade bones.
- Aim_GREN: 9 animDesc 3x3 blend (flags 1044/68), 1 frame each @30fps, delta,
  pose axes [body_yaw, body_pitch] with keys [-60,0,60] / [-70,0,70].
- HandPos_GREN: 1 animDesc, non-delta (flags 1026/64), 1 frame @30fps.
- Shoot_GREN2 / Shoot_GREN3: 1 animDesc delta layer (flags 20/68), 19 frames
  @30fps, no auto-layers, 0/1 bone masks like Shoot_GREN1.
Outputs per-team npz frames, metadata, and an audit report under
.reference-assets/source-exports/character-gren/ (throw-variant-* files).
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
VARIANT_ORDER = ['Idle', 'Walk', 'Run', 'Crouch_Idle', 'Crouch_Walk']
# MDL index -> name, grouped per family (indices audited by the probe script;
# T and CT animation MDLs share the same sequence layout).
FAMILIES = {
    'prep-upper': {826: 'Idle_Upper_GREN', 825: 'Walk_Upper_GREN', 824: 'Run_Upper_GREN',
                   827: 'Crouch_Idle_Upper_GREN', 828: 'Crouch_Walk_Upper_GREN'},
    'prep-aim': {816: 'Idle_Aim_GREN', 815: 'Walk_Aim_GREN', 814: 'Run_Aim_GREN',
                 817: 'Crouch_Idle_Aim_GREN', 818: 'Crouch_Walk_Aim_GREN'},
    'prep-handpos': {821: 'Idle_HandPos_GREN', 820: 'Walk_HandPos_GREN', 819: 'Run_HandPos_GREN',
                     822: 'Crouch_Idle_HandPos_GREN', 823: 'Crouch_Walk_HandPos_GREN'},
    'throw-medium': {836: 'Idle_Shoot_GREN2', 835: 'Walk_Shoot_GREN2', 834: 'Run_Shoot_GREN2',
                     837: 'Crouch_Idle_Shoot_GREN2', 838: 'Crouch_Walk_Shoot_GREN2'},
    'throw-underhand': {933: 'Idle_Shoot_GREN3', 932: 'Walk_Shoot_GREN3', 931: 'Run_Shoot_GREN3',
                        934: 'Crouch_Idle_Shoot_GREN3', 935: 'Crouch_Walk_Shoot_GREN3'},
}
FAMILY_FRAMES = {'prep-upper': {'Idle': 61, 'Walk': 33, 'Run': 21, 'Crouch_Idle': 61, 'Crouch_Walk': 25},
                 'prep-aim': {v: 1 for v in VARIANT_ORDER}, 'prep-handpos': {v: 1 for v in VARIANT_ORDER},
                 'throw-medium': {v: 19 for v in VARIANT_ORDER}, 'throw-underhand': {v: 19 for v in VARIANT_ORDER}}


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

        pose_parameters = []
        for i in range(mdl.header.local_pose_paramater_count):
            start = mdl.header.local_pose_parameter_offset + i * 20
            with buffer.read_from_offset(start):
                name_offset, flags, low, high, loop = buffer.read_fmt('iifff')
            with buffer.read_from_offset(start + name_offset): name = buffer.read_ascii_string()
            pose_parameters.append({'index': i, 'name': name, 'flags': int(flags), 'start': low, 'end': high, 'loop': loop})
        # Aim_GREN blends the same body_yaw/body_pitch axes as the merged weapon aim layers.
        assert pose_parameters[2]['name'] == 'body_yaw' and pose_parameters[1]['name'] == 'body_pitch', \
            f'{team}: unexpected pose parameter table order'

        patch = StudioAnimDesc._read_frame_animations
        StudioAnimDesc._read_frame_animations = decode
        descriptors = []; raw_frames = {}; sequence_records = []; family_report = {}
        try:
            for family, members in FAMILIES.items():
                records = []; frame_total = 0
                for variant in VARIANT_ORDER:
                    seq_index = next(i for i, name in members.items() if name.startswith(variant))
                    expected = members[seq_index]
                    seq = mdl.sequences[seq_index]
                    assert seq.name == expected, (seq_index, seq.name, expected)
                    anims = [int(a) for a in seq.anim_desc_indices]
                    desc = mdl.anim_descs[anims[0]]
                    assert int(desc.flags) & 64, 'This pass accepts FRAMEANIM only'
                    assert desc.local_hierarchy_count == 0, 'Local hierarchy overrides need a separate audit'
                    fields = raw_sequence_fields(seq, mdl, buffer)
                    weights = fields['boneWeights']
                    assert len(weights) == len(mdl.bones) and all(w in (0.0, 1.0) for w in weights)
                    ones = [mdl.bones[i].name for i, w in enumerate(weights) if w == 1.0]
                    if family == 'prep-upper':
                        assert int(seq.flags) == 0 and not (int(desc.flags) & 4) and fields['groupSize'] == [1, 1]
                        assert len(anims) == 1 and len(fields['autoLayers']) == 2
                        prefix = variant if variant != 'Idle' else 'Idle'
                        assert {l['sequence_name'] for l in fields['autoLayers']} == {f'{prefix}_Aim_GREN', f'{prefix}_HandPos_GREN'}
                        assert all(l['flags'] == 0 and (l['start'], l['peak'], l['tail'], l['end']) == (0.0, 0.0, 0.0, 0.0) for l in fields['autoLayers'])
                        assert ones == ['ValveBiped.weapon_bone_RHand', 'ValveBiped.weapon_bone_LHand'], ones
                    elif family == 'prep-aim':
                        assert int(seq.flags) == 1044 and int(desc.flags) & 4 and fields['groupSize'] == [3, 3]
                        assert len(anims) == 9 and all(mdl.anim_descs[a].frame_count == 1 for a in anims)
                        assert fields['parameterIndices'] == [2, 1] and fields['poseKeys'] == [-60.0, 0.0, 60.0, -70.0, 0.0, 70.0]
                        assert fields['autoLayers'] == []
                    elif family == 'prep-handpos':
                        assert int(seq.flags) == 1026 and not (int(desc.flags) & 4) and fields['groupSize'] == [1, 1]
                        assert len(anims) == 1 and desc.frame_count == 1 and fields['autoLayers'] == []
                        assert fields['parameterIndices'] == [-1, -1] and not fields['poseKeys']
                    else:
                        assert int(seq.flags) == 20 and int(desc.flags) & 4 and fields['groupSize'] == [1, 1]
                        assert len(anims) == 1 and fields['autoLayers'] == []
                        assert fields['parameterIndices'] == [-1, -1] and not fields['poseKeys']
                    for key in anims:
                        single = mdl.anim_descs[key]
                        assert single.frame_count == FAMILY_FRAMES[family][variant] and single.fps == 30.0, \
                            (family, variant, single.frame_count)
                        values = single.read_animations(buffer, mdl.bones, ani.buffer, blocks); assert values is not None
                        positions = np.stack([values[b.name]['pos'] for b in mdl.bones], axis=1).astype(np.float64)
                        rotations = np.stack([values[b.name]['rot'] for b in mdl.bones], axis=1).astype(np.float64)
                        assert positions.shape == (single.frame_count, len(mdl.bones), 3)
                        assert np.isfinite(positions).all() and np.isfinite(rotations).all()
                        lengths = np.linalg.norm(rotations, axis=-1)
                        assert np.min(lengths) > .99 and np.max(lengths) < 1.01
                        raw_frames[key] = (positions, rotations / lengths[..., None])
                        frame_total += single.frame_count
                        # Every blend cell keeps its own descriptor record: the
                        # merge consumes one frame block per animationIndices entry.
                        descriptors.append({'index': key, 'name': single.name, 'fps': single.fps, 'frames': single.frame_count,
                            'flags': int(single.flags), 'delta': bool(int(single.flags) & 4),
                            'maxQuaternionNormError': float(np.max(np.abs(lengths - 1))),
                            'ikRules': single.ikrule_count, 'movements': single.movement_count,
                            'sections': len(single.get_sections(buffer))})
                    records.append({'sourceModel': source, 'index': seq_index, 'name': seq.name,
                        'activityName': seq.activity_name, 'flags': int(seq.flags), 'category': f'grenade-{family}',
                        'blendCount': int(seq.blend_count), 'animationIndices': anims,
                        'events': [], 'paramStart': [float(v) for v in seq.param_start], 'paramEnd': [float(v) for v in seq.param_end],
                        'eligibleSimpleAbsolute': False, **fields,
                        'weightOnes': len(ones), 'weightZeroed': len(weights) - len(ones)})
                assert len(records) == 5
                family_report[family] = {'sequences': len(records), 'frames': frame_total,
                    'weightOnes': sorted({r['weightOnes'] for r in records})}
                sequence_records.extend(records)
        finally:
            StudioAnimDesc._read_frame_animations = patch

        out = OUT_BASE / team; out.mkdir(parents=True, exist_ok=True)
        packed = {f'anim_{key}_{kind}': data for key, pair in raw_frames.items() for kind, data in zip(('positions', 'quaternions'), pair)}
        npz_path = out / 'throw-variant-frames.npz'
        np.savez_compressed(npz_path, **packed)
        npz_bytes = npz_path.read_bytes()
        metadata = {'sourceModel': source, 'boneNames': [b.name for b in mdl.bones],
            'poseParameters': pose_parameters, 'sequences': sequence_records, 'descriptors': descriptors}
        metadata['frameFile'] = 'throw-variant-frames.npz'
        meta_bytes = (json.dumps(metadata, indent=1) + '\n').encode()
        (out / 'throw-variant-metadata.json').write_bytes(meta_bytes)
        audit = {'status': 'passed_throw_variant_frame_decode', 'team': team, 'sourceModel': source,
            'sourceMdlSha256': sha(raw_bytes), 'sourceMdlBytes': len(raw_bytes),
            'aniResolved': True,
            'families': family_report,
            'sequences': [{'index': r['index'], 'name': r['name'], 'family': r['category'],
                'frames': next(d['frames'] for d in descriptors if d['index'] == r['animationIndices'][0]),
                'anims': len(r['animationIndices']), 'fadeIn': r['fadeIn'], 'fadeOut': r['fadeOut']} for r in sequence_records],
            'descriptors': descriptors, 'bones': len(mdl.bones),
            'frameDecoded': sum(d['frames'] for d in descriptors),
            'npzSha256': sha(npz_bytes), 'npzBytes': len(npz_bytes),
            'metadataSha256': sha(meta_bytes),
            'boundary': 'Data export only. The pin-pull preparation keeps the original Upper_GREN non-delta overlay with its Aim_GREN (body_yaw/body_pitch 3x3) + HandPos_GREN auto-layers and the weapon_bone_*Hand-only bone mask; Shoot_GREN2/3 keep the Shoot_GREN1 delta-layer shape (0/1 leg-chain masks on moving variants). When each layer plays (press/hold/release, throw-strength selection) is a documented web port decision; the closed CS:GO client state machine is not reconstructed here.'}
        (out / 'throw-variant-audit.json').write_text(json.dumps(audit, indent=1) + '\n')
        summary[team] = {k: v for k, v in audit.items() if k not in ('descriptors', 'sequences')}
        print('THROW_VARIANTS_DECODED', team, json.dumps({'families': family_report,
            'frames': audit['frameDecoded'], 'npzBytes': len(npz_bytes)}))
    (OUT_BASE / 'throw-variant-summary.json').write_text(json.dumps(summary, indent=1) + '\n')
    print('ALL_TEAMS_DECODED', len(summary))


if __name__ == '__main__':
    main()
