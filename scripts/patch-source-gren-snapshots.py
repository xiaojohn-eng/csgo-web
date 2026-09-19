"""Patch the ORIGINAL research snapshot body datasets with the same five
Shoot_GREN1 delta-layer merges used for production data
(scripts/merge-source-gren-poses.py), so the pose driver's grenade-throw
variant lookup (namedSequences) holds for every snapshot the tests feed
through prepareSourceCharacterPose/createSourcePoseDriver.

Targets (same set as scripts/patch-source-death-snapshots.py):
- character-{t,ct}/continuous           (rifle research snapshots, pose-data.json)
- awp-character-candidates/character-{t,ct}-awp          (body-pose-data.json)
- deagle-candidates/character-{t,ct}-deagle             (body-pose-data.json)
- pistol-candidates/character-{t,ct}-{glock,usp}        (body-pose-data.json)

No states entry is added: the throw layer is an overlay the pose driver
selects per locomotion state, unlike the Death state switch.

Run scripts/refresh-death-reference-hashes.py-style hash refresh afterwards
(the same provenance records cover the appended bytes).
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

VARIANTS = ['Idle', 'Walk', 'Run', 'Crouch_Idle', 'Crouch_Walk']  # production append order (merge-source-gren-poses.py)

gren = {}
for team in ('t', 'ct'):
    meta = json.loads((GREN / team / 'gren-metadata.json').read_text())
    frames = np.load(GREN / team / 'gren-frames.npz')
    seqs = {}
    for variant in VARIANTS:
        name = f'{variant}_Shoot_GREN1'
        seq = next(s for s in meta['sequences'] if s['name'] == name)
        assert seq['flags'] == 20, f'{name}: expected delta+post flags, got {seq["flags"]}'
        assert seq['groupSize'] == [1, 1] and seq['parameterIndices'] == [-1, -1] and not seq['poseKeys']
        weights = seq['boneWeights']
        assert len(weights) == len(meta['boneNames']) == (71 if team == 't' else 70)
        assert all(w in (0.0, 1.0) for w in weights)
        seqs[name] = seq
    gren[team] = {'meta': meta, 'frames': frames, 'seqs': seqs}

for folder, pose_file, frames_file, gz_file in TARGETS:
    base = EXPORTS / folder
    pose_bytes = (base / pose_file).read_bytes()
    pose = json.loads(pose_bytes)
    frames_bytes = (base / frames_file).read_bytes()
    assert len(frames_bytes) == pose['frames']['byteLength'] and len(frames_bytes) % 8 == 0

    team = 't' if pose['animationModel'].endswith('/t_animations.mdl') else 'ct'
    assert pose['animationModel'].endswith(f'/{team}_animations.mdl'), f'{folder}: unexpected animation model'
    source = gren[team]
    meta, frames = source['meta'], source['frames']
    bone_count = len(meta['boneNames'])
    assert [b['name'] for b in pose['animationBones']] == meta['boneNames'], f'{folder}: bone table differs'

    used_seq = {s['index'] for s in pose['sequences']}
    used_desc = {d['index'] for d in pose['descriptors']}
    for variant in VARIANTS:
        name = f'{variant}_Shoot_GREN1'
        if name in {s['name'] for s in pose['sequences']}:
            raise AssertionError(f'{folder}: already patched')
        seq = source['seqs'][name]
        assert seq['index'] not in used_seq, f'{folder}: sequence slot {seq["index"]} occupied'
        for key in seq['animationIndices']:
            assert key not in used_desc, f'{folder}: gren descriptor slot {key} occupied'

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
    appended = 0
    for variant in VARIANTS:
        name = f'{variant}_Shoot_GREN1'
        seq = source['seqs'][name]
        key = seq['animationIndices'][0]
        desc = next(d for d in meta['descriptors'] if d['index'] == key)
        assert desc['frames'] == 14 and desc['fps'] == 30.0 and desc['delta']

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
        pose['sequences'].append(seq)
        appended += desc['frames']

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
          'grenFrames', appended)
print('SNAPSHOT_GREN_PATCH_DONE')
