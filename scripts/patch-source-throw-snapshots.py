"""Patch the ORIGINAL research snapshot body datasets with the same pin-pull
preparation graph and medium/underhand release merges used for production data
(scripts/merge-source-throw-variants.py), so the pose driver's throw-variant
lookups (namedSequences) hold for every snapshot the tests feed through
prepareSourceCharacterPose/createSourcePoseDriver.

Targets (same set as scripts/patch-source-gren-snapshots.py):
- character-{t,ct}/continuous           (rifle research snapshots, pose-data.json)
- awp-character-candidates/character-{t,ct}-awp          (body-pose-data.json)
- deagle-candidates/character-{t,ct}-deagle             (body-pose-data.json)
- pistol-candidates/character-{t,ct}-{glock,usp}        (body-pose-data.json)

No states entry is added: like Shoot_GREN1 these are overlay layers the pose
driver selects per locomotion state. Existing descriptors keep their offsets
(contiguous append), so every independently verified sample stays
byte-identical. Run scripts/refresh-throw-reference-hashes.py afterwards.
"""
from __future__ import annotations
import gzip, hashlib, json
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
EXPORTS = ROOT / '.reference-assets/source-exports'
GREN = EXPORTS / 'character-gren'
sha = lambda b: hashlib.sha256(b).hexdigest()

TARGETS = [
    ('character-t/continuous', 'pose-data.json', 'frames.f64.bin', 'frames.f64.bin.gz'),
    ('character-ct/continuous', 'pose-data.json', 'frames.f64.bin', 'frames.f64.bin.gz'),
    ('awp-character-candidates/character-t-awp', 'body-pose-data.json', 'body-frames.f64.bin', None),
    ('awp-character-candidates/character-ct-awp', 'body-pose-data.json', 'body-frames.f64.bin', None),
    ('deagle-candidates/character-t-deagle', 'body-pose-data.json', 'body-frames.f64.bin', None),
    ('deagle-candidates/character-ct-deagle', 'body-pose-data.json', 'body-frames.f64.bin', None),
    ('pistol-candidates/character-t-glock', 'body-pose-data.json', 'body-frames.f64.bin', None),
    ('pistol-candidates/character-ct-glock', 'body-pose-data.json', 'body-frames.f64.bin', None),
    ('pistol-candidates/character-t-usp', 'body-pose-data.json', 'body-frames.f64.bin', None),
    ('pistol-candidates/character-ct-usp', 'body-pose-data.json', 'body-frames.f64.bin', None),
]

VARIANTS = ['Idle', 'Walk', 'Run', 'Crouch_Idle', 'Crouch_Walk']  # production append order (merge-source-throw-variants.py)
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

for folder, pose_file, frames_file, gz_file in TARGETS:
    base = EXPORTS / folder
    pose_bytes = (base / pose_file).read_bytes()
    pose = json.loads(pose_bytes)
    frames_bytes = (base / frames_file).read_bytes()
    assert len(frames_bytes) == pose['frames']['byteLength'] and len(frames_bytes) % 8 == 0

    team = 't' if pose['animationModel'].endswith('/t_animations.mdl') else 'ct'
    assert pose['animationModel'].endswith(f'/{team}_animations.mdl'), f'{folder}: unexpected animation model'
    source = throw[team]
    meta, frames = source['meta'], source['frames']
    bone_count = len(meta['boneNames'])
    assert [b['name'] for b in pose['animationBones']] == meta['boneNames'], f'{folder}: bone table differs'
    # Aim_GREN samples poseParameters[2]/[1]; both axes must keep their names.
    assert [p['name'] for p in pose['poseParameters'][1:3]] == ['body_pitch', 'body_yaw'], f'{folder}: unexpected pose parameter order'

    used_seq = {s['index'] for s in pose['sequences']}
    used_desc = {d['index'] for d in pose['descriptors']}
    for family in FAMILY_ORDER:
        for variant in VARIANTS:
            name = f'{variant}_{FAMILY_SUFFIX[family]}'
            if name in {s['name'] for s in pose['sequences']}:
                raise AssertionError(f'{folder}: already patched')
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
    appended = 0
    for family in FAMILY_ORDER:
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
                pose['descriptors'].append(record)
                appended += desc['frames']
            pose['sequences'].append(seq)
            new_sequences.append(seq)

    # Every auto-layer target must exist in the patched snapshot.
    appended_seq_ids = {s['index'] for s in new_sequences}
    for seq in new_sequences:
        for layer in seq['autoLayers']:
            assert layer['sequence_id'] in appended_seq_ids, f'{folder}: auto-layer target {layer["sequence_id"]} missing'

    new_frames = frames_bytes + bytes(payload)
    pose['frames']['byteLength'] = len(new_frames)
    pose['frames']['sha256'] = sha(new_frames)

    new_pose_bytes = (json.dumps(pose, separators=(',', ':'), allow_nan=False) + '\n').encode()
    (base / pose_file).write_bytes(new_pose_bytes)
    (base / frames_file).write_bytes(new_frames)
    gzip_bytes = None
    if gz_file:
        gzip_bytes = gzip.compress(new_frames, mtime=0)
        (base / gz_file).write_bytes(gzip_bytes)

    manifest_path = base / 'manifest.json'
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        manifest['descriptors'] = len(pose['descriptors'])
        manifest['frames'] = sum(d['frames'] for d in pose['descriptors'])
        manifest['binaryBytes'] = len(new_frames)
        manifest['binarySha256'] = sha(new_frames)
        manifest['jsonBytes'] = len(new_pose_bytes)
        manifest['jsonSha256'] = sha(new_pose_bytes)
        if gzip_bytes is not None:
            manifest['gzipBytes'] = len(gzip_bytes)
        manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')

    print('PATCHED', folder, 'team', team, 'appendedFloats', len(payload) // 8,
          'appendedSequences', len(new_sequences), 'appendedFrames', appended)
print('SNAPSHOT_THROW_PATCH_DONE')
