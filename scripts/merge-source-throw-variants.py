"""Merge the decoded pin-pull preparation graph and the two extra release
variants into every production character pose dataset.

Appends per team (scripts/export-source-throw-variants.py order, five
locomotion variants per family):
- prep-aim      5 sequences, 9 single-frame 3x3 blend descriptors each
                (body_yaw/body_pitch keys -60/0/60 / -70/0/70, flags 1044),
- prep-handpos  5 sequences, one single-frame non-delta descriptor each
                (flags 1026),
- prep-upper    5 sequences, one 21/33/61/61/25-frame non-delta descriptor
                each (flags 0) with the original two auto-layers pointing at
                the matching Aim_GREN/HandPos_GREN sequences and the
                weapon_bone_*Hand-only 0/1 bone mask,
- throw-medium  5 Shoot_GREN2 delta layers, 19 frames @30fps (flags 20),
- throw-underhand 5 Shoot_GREN3 delta layers, 19 frames @30fps (flags 20).

No states entry is added: like Shoot_GREN1 these are overlay layers the pose
driver selects per live locomotion state. Existing descriptors keep their
offsets (contiguous append), so every independently verified sample stays
byte-identical. Run after scripts/export-source-throw-variants.py.
"""
from __future__ import annotations
import gzip, hashlib, json
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public/source/csgo-12426148'
GREN = ROOT / '.reference-assets/source-exports/character-gren'
sha = lambda b: hashlib.sha256(b).hexdigest()

VARIANTS = ['Idle', 'Walk', 'Run', 'Crouch_Idle', 'Crouch_Walk']
FAMILY_ORDER = ['prep-aim', 'prep-handpos', 'prep-upper', 'throw-medium', 'throw-underhand']
FAMILY_FRAMES = {'prep-upper': {'Idle': 61, 'Walk': 33, 'Run': 21, 'Crouch_Idle': 61, 'Crouch_Walk': 25},
                 'prep-aim': {v: 1 for v in VARIANTS}, 'prep-handpos': {v: 1 for v in VARIANTS},
                 'throw-medium': {v: 19 for v in VARIANTS}, 'throw-underhand': {v: 19 for v in VARIANTS}}
FAMILY_SUFFIX = {'prep-aim': 'Aim_GREN', 'prep-handpos': 'HandPos_GREN', 'prep-upper': 'Upper_GREN',
                 'throw-medium': 'Shoot_GREN2', 'throw-underhand': 'Shoot_GREN3'}
FAMILY_SEQ_FLAGS = {'prep-aim': 1044, 'prep-handpos': 1026, 'prep-upper': 0,
                    'throw-medium': 20, 'throw-underhand': 20}
FAMILY_DESC_DELTA = {'prep-aim': True, 'prep-handpos': False, 'prep-upper': False,
                     'throw-medium': True, 'throw-underhand': True}
FAMILY_ANIMS = {'prep-aim': 9, 'prep-handpos': 1, 'prep-upper': 1, 'throw-medium': 1, 'throw-underhand': 1}
FAMILY_GROUP = {'prep-aim': [3, 3], 'prep-handpos': [1, 1], 'prep-upper': [1, 1],
                'throw-medium': [1, 1], 'throw-underhand': [1, 1]}

TARGETS = [
    ('character-ak', 'pose-data.json', 'frames.f64.bin', 'frames.f64.bin.gz', 'rifle'),
    ('character-ct-ak', 'pose-data.json', 'frames.f64.bin', 'frames.f64.bin.gz', 'rifle'),
    ('character-t-m4', 'pose-data.json', 'frames.f64.bin', 'frames.f64.bin.gz', 'rifle'),
    ('character-ct-m4', 'pose-data.json', 'frames.f64.bin', 'frames.f64.bin.gz', 'rifle'),
    ('character-t-glock', 'body-pose-data.json', 'body-frames.f64.bin', None, 'pistol'),
    ('character-ct-glock', 'body-pose-data.json', 'body-frames.f64.bin', None, 'pistol'),
    ('character-t-usp', 'body-pose-data.json', 'body-frames.f64.bin', None, 'pistol'),
    ('character-ct-usp', 'body-pose-data.json', 'body-frames.f64.bin', None, 'pistol'),
    ('character-t-deagle', 'body-pose-data.json', 'body-frames.f64.bin', None, 'deagle'),
    ('character-ct-deagle', 'body-pose-data.json', 'body-frames.f64.bin', None, 'deagle'),
    ('character-t-awp', 'body-pose-data.json', 'body-frames.f64.bin', None, 'awp'),
    ('character-ct-awp', 'body-pose-data.json', 'body-frames.f64.bin', None, 'awp'),
]

throw = {}
for team in ('t', 'ct'):
    meta = json.loads((GREN / team / 'throw-variant-metadata.json').read_text())
    frames = np.load(GREN / team / 'throw-variant-frames.npz')
    seqs = {}
    for family in FAMILY_ORDER:
        for variant in VARIANTS:
            name = f'{variant}_{FAMILY_SUFFIX[family]}'
            seq = next(s for s in meta['sequences'] if s['name'] == name)
            assert seq['flags'] == FAMILY_SEQ_FLAGS[family], (name, seq['flags'])
            assert seq['groupSize'] == FAMILY_GROUP[family] and len(seq['animationIndices']) == FAMILY_ANIMS[family]
            weights = seq['boneWeights']
            assert all(w in (0.0, 1.0) for w in weights)
            if family == 'prep-upper':
                assert len(seq['autoLayers']) == 2
                assert {l['sequence_name'] for l in seq['autoLayers']} == {f'{variant}_Aim_GREN', f'{variant}_HandPos_GREN'}
                ones = [meta['boneNames'][i] for i, w in enumerate(weights) if w == 1.0]
                assert ones == ['ValveBiped.weapon_bone_RHand', 'ValveBiped.weapon_bone_LHand'], ones
            else:
                assert seq['autoLayers'] == []
            if family == 'prep-aim':
                assert seq['parameterIndices'] == [2, 1] and seq['poseKeys'] == [-60.0, 0.0, 60.0, -70.0, 0.0, 70.0]
            else:
                assert seq['parameterIndices'] == [-1, -1] and not seq['poseKeys']
            for key in seq['animationIndices']:
                desc = next(d for d in meta['descriptors'] if d['index'] == key)
                assert desc['frames'] == FAMILY_FRAMES[family][variant] and desc['fps'] == 30.0
                assert desc['delta'] == FAMILY_DESC_DELTA[family]
            seqs[name] = seq
    assert len(meta['boneNames']) == (71 if team == 't' else 70)
    throw[team] = {'meta': meta, 'frames': frames, 'seqs': seqs}

report = []
for folder, pose_file, frames_file, gz_file, kind in TARGETS:
    base = PUBLIC / folder
    pose_bytes = (base / pose_file).read_bytes()
    pose = json.loads(pose_bytes)
    frames_bytes = (base / frames_file).read_bytes()
    assert len(frames_bytes) == pose['frames']['byteLength'] and len(frames_bytes) % 8 == 0

    team = 't' if pose['animationModel'].endswith('/t_animations.mdl') else 'ct'
    assert pose['animationModel'].endswith(f'/{team}_animations.mdl'), f'{folder}: unexpected animation model {pose["animationModel"]}'
    source = throw[team]
    meta, frames = source['meta'], source['frames']
    bone_count = len(meta['boneNames'])
    assert [b['name'] for b in pose['animationBones']] == meta['boneNames'], f'{folder}: animation bone table differs from throw-variant source MDL'
    # Aim_GREN samples poseParameters[2]/[1]; both axes must keep their names.
    assert [p['name'] for p in pose['poseParameters'][1:3]] == ['body_pitch', 'body_yaw'], f'{folder}: unexpected pose parameter order'

    used_seq = {s['index'] for s in pose['sequences']}
    used_desc = {d['index'] for d in pose['descriptors']}
    for family in FAMILY_ORDER:
        for variant in VARIANTS:
            name = f'{variant}_{FAMILY_SUFFIX[family]}'
            assert name not in {s['name'] for s in pose['sequences']}, f'{folder}: already merged'
            seq = source['seqs'][name]
            assert seq['index'] not in used_seq, f'{folder}: sequence slot {seq["index"]} occupied'
            for key in seq['animationIndices']:
                assert key not in used_desc, f'{folder}: throw-variant descriptor slot {key} occupied'

    ranges = sorted((d['positionsOffset'], d['positionsOffset'] + d['positionsCount']) for d in pose['descriptors']) + \
             sorted((d['quaternionsOffset'], d['quaternionsOffset'] + d['quaternionsCount']) for d in pose['descriptors'])
    ranges.sort()
    consumed = 0
    for lo, hi in ranges:
        assert lo == consumed, f'{folder}: existing frame ranges are not contiguous'
        consumed = hi
    total_floats = len(frames_bytes) // 8
    assert consumed == total_floats, f'{folder}: unmapped frame suffix'

    payload = bytearray()
    new_sequences = []
    new_descriptors = []
    family_report = {}
    for family in FAMILY_ORDER:
        appended_frames = 0
        for variant in VARIANTS:
            name = f'{variant}_{FAMILY_SUFFIX[family]}'
            seq = source['seqs'][name]
            for key in seq['animationIndices']:
                desc = next(d for d in meta['descriptors'] if d['index'] == key)
                positions = np.ascontiguousarray(frames[f'anim_{key}_positions'], dtype='<f8')
                quaternions = np.ascontiguousarray(frames[f'anim_{key}_quaternions'], dtype='<f8')
                assert positions.shape == (desc['frames'], bone_count, 3) and quaternions.shape == (desc['frames'], bone_count, 4)
                assert np.isfinite(positions).all() and np.isfinite(quaternions).all()
                norms = np.linalg.norm(quaternions.reshape(-1, 4), axis=1)
                assert np.max(np.abs(norms - 1)) < 1e-6
                payload.extend(positions.tobytes(order='C'))
                payload.extend(quaternions.tobytes(order='C'))
                record = dict(desc)
                record['positionsOffset'] = total_floats
                record['positionsCount'] = int(positions.size)
                record['quaternionsOffset'] = total_floats + int(positions.size)
                record['quaternionsCount'] = int(quaternions.size)
                total_floats += int(positions.size) + int(quaternions.size)
                new_descriptors.append(record)
                appended_frames += desc['frames']
            new_sequences.append(seq)
        family_report[family] = {'sequences': 5, 'descriptors': sum(len(source['seqs'][f"{v}_{FAMILY_SUFFIX[family]}"]['animationIndices']) for v in VARIANTS),
                                 'frames': appended_frames}

    # Every auto-layer target must exist in the merged dataset.
    appended_seq_ids = {s['index'] for s in new_sequences}
    for seq in new_sequences:
        for layer in seq['autoLayers']:
            assert layer['sequence_id'] in appended_seq_ids, f'{folder}: auto-layer target {layer["sequence_id"]} missing'

    new_frames = frames_bytes + bytes(payload)
    pose['descriptors'].extend(new_descriptors)
    pose['sequences'].extend(new_sequences)
    pose['frames']['byteLength'] = len(new_frames)
    pose['frames']['sha256'] = sha(new_frames)

    new_pose_bytes = (json.dumps(pose, separators=(',', ':'), allow_nan=False) + '\n').encode()
    (base / pose_file).write_bytes(new_pose_bytes)
    (base / frames_file).write_bytes(new_frames)
    if gz_file:
        (base / gz_file).write_bytes(gzip.compress(new_frames, mtime=0))

    manifest_bytes = (base / 'manifest.json').read_bytes()
    manifest = json.loads(manifest_bytes)
    old_pose_version = manifest['poseVersion']
    prefix = manifest['poseVersion'].split(':')[0] + ':'
    if kind == 'rifle':
        files = manifest['files']
        assert manifest['poseData'] == pose_file and manifest['poseFrames'] == frames_file
        files[pose_file] = {'bytes': len(new_pose_bytes), 'sha256': sha(new_pose_bytes)}
        files[frames_file] = {'bytes': len(new_frames), 'sha256': sha(new_frames)}
        if gz_file and gz_file in files:
            gz_data = (base / gz_file).read_bytes()
            files[gz_file] = {'bytes': len(gz_data), 'sha256': sha(gz_data)}
        manifest['poseVersion'] = prefix + sha(new_pose_bytes)[:16]
        new_manifest = (json.dumps(manifest, indent=2) + '\n').encode()
    else:
        files = {f['path']: f for f in manifest['files']}
        assert manifest['bodyPose'] == pose_file and manifest['bodyFrames'] == frames_file
        files[pose_file]['bytes'] = len(new_pose_bytes)
        files[pose_file]['sha256'] = sha(new_pose_bytes)
        files[frames_file]['bytes'] = len(new_frames)
        files[frames_file]['sha256'] = sha(new_frames)
        if 'validation' in manifest:
            manifest['validation']['bodyDataSHA256'] = sha(new_pose_bytes)
        manifest['poseVersion'] = prefix + sha(new_pose_bytes)[:16]
        new_manifest = (json.dumps(manifest, indent=2) + '\n').encode()
    (base / 'manifest.json').write_bytes(new_manifest)

    entry = {
        'folder': folder, 'team': team, 'kind': kind,
        'poseFile': pose_file, 'framesFile': frames_file,
        'oldPoseSHA256': sha(pose_bytes), 'newPoseSHA256': sha(new_pose_bytes),
        'oldFramesSHA256': sha(frames_bytes), 'newFramesSHA256': sha(new_frames),
        'oldPoseVersion': old_pose_version, 'newPoseVersion': manifest['poseVersion'],
        'newManifestSHA256': sha(new_manifest),
        'appendedBytes': len(payload), 'appendedFloats': len(payload) // 8,
        'appendedSequences': len(new_sequences), 'appendedDescriptors': len(new_descriptors),
        'families': family_report,
        'appendedFrames': sum(f['frames'] for f in family_report.values()),
        'throwPolicy': 'The pin-pull preparation graph (Upper_GREN over Aim_GREN + HandPos_GREN '
                       'auto-layers) and the Shoot_GREN2 medium / Shoot_GREN3 underhand release '
                       'variants are appended without states: the pose driver arms the preparation '
                       'overlay while the throw key is held and selects the release variant set at '
                       'the release instant, matching the live locomotion state like Shoot_GREN1.',
    }
    (base / 'throw-merge-audit.json').write_text(json.dumps(entry, indent=2) + '\n')
    report.append(entry)
    print('THROW_VARIANTS_MERGED', folder, json.dumps({
        'appendedFloats': entry['appendedFloats'], 'appendedSequences': entry['appendedSequences'],
        'appendedDescriptors': entry['appendedDescriptors'], 'appendedFrames': entry['appendedFrames'],
        'oldPoseVersion': old_pose_version, 'newPoseVersion': manifest['poseVersion'],
        'newManifestSHA256': entry['newManifestSHA256']}))

frozen = {}
for entry in report:
    key = entry['folder'].replace('character-', '')
    frozen[key] = {'poseVersion': entry['newPoseVersion'], 'manifestSha256': entry['newManifestSHA256']}
print('FROZEN_UPDATES')
print(json.dumps(frozen, indent=1))
