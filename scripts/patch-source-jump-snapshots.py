"""Patch the ORIGINAL research snapshot body datasets with the same jump merge
used for production data (scripts/merge-source-jump-poses.py), so the frozen
prepare() identity checks (states.Jump + jump_lower) hold for every snapshot
that tests feed through prepareSourceCharacterPose.

Targets:
- character-{t,ct}/continuous           (rifle research snapshots, pose-data.json)
- awp-character-candidates/character-{t,ct}-awp          (body-pose-data.json)
- deagle-candidates/character-{t,ct}-deagle             (body-pose-data.json)
- pistol-candidates/character-{t,ct}-{glock,usp}        (body-pose-data.json)

The rifle snapshots also carry a descriptive manifest.json whose byte counts,
hashes and descriptor/frame totals are kept consistent.
"""
from __future__ import annotations
import gzip, hashlib, json
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
EXPORTS = ROOT / '.reference-assets/source-exports'
JUMP = EXPORTS / 'character-jump'
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

jump = {}
for team in ('t', 'ct'):
    meta = json.loads((JUMP / team / 'jump-metadata.json').read_text())
    frames = np.load(JUMP / team / 'jump-frames.npz')
    jump[team] = {'meta': meta, 'frames': frames}

for folder, pose_file, frames_file, gz_file in TARGETS:
    base = EXPORTS / folder
    pose_bytes = (base / pose_file).read_bytes()
    pose = json.loads(pose_bytes)
    frames_bytes = (base / frames_file).read_bytes()
    assert len(frames_bytes) == pose['frames']['byteLength'] and len(frames_bytes) % 8 == 0

    team = 't' if pose['animationModel'].endswith('/t_animations.mdl') else 'ct'
    assert pose['animationModel'].endswith(f'/{team}_animations.mdl'), f'{folder}: unexpected animation model'
    source = jump[team]
    meta, frames = source['meta'], source['frames']
    bone_count = len(meta['boneNames'])
    assert [b['name'] for b in pose['animationBones']] == meta['boneNames'], f'{folder}: bone table differs'

    used_seq = {s['index'] for s in pose['sequences']}
    used_desc = {d['index'] for d in pose['descriptors']}
    jump_seq = meta['sequences'][0]
    assert jump_seq['index'] == 6 and jump_seq['name'] == 'jump_lower' and 6 not in used_seq
    assert jump_seq['groupSize'] == [3, 3] and jump_seq['parameterIndices'] == [3, 4]
    assert 'Jump' not in pose['states'], f'{folder}: already patched'

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
    offset = total_floats
    new_descriptors = []
    for key in jump_seq['animationIndices']:
        assert key not in used_desc, f'{folder}: jump descriptor slot {key} occupied'
        desc = next(d for d in meta['descriptors'] if d['index'] == key)
        positions = np.ascontiguousarray(frames[f'anim_{key}_positions'], dtype='<f8')
        quaternions = np.ascontiguousarray(frames[f'anim_{key}_quaternions'], dtype='<f8')
        assert positions.shape == (desc['frames'], bone_count, 3) and quaternions.shape == (desc['frames'], bone_count, 4)
        assert np.isfinite(positions).all() and np.isfinite(quaternions).all()
        norms = np.linalg.norm(quaternions.reshape(-1, 4), axis=1)
        assert np.max(np.abs(norms - 1)) < 1e-6
        record = dict(desc)
        record['positionsOffset'] = offset
        record['positionsCount'] = int(positions.size)
        offset += int(positions.size)
        record['quaternionsOffset'] = offset
        record['quaternionsCount'] = int(quaternions.size)
        offset += int(quaternions.size)
        payload.extend(positions.tobytes(order='C'))
        payload.extend(quaternions.tobytes(order='C'))
        new_descriptors.append(record)

    new_frames = frames_bytes + bytes(payload)
    pose['descriptors'].extend(new_descriptors)
    pose['sequences'].append(jump_seq)
    idle = pose['states']['Idle']
    pose['states']['Jump'] = {'lower': jump_seq['index'], 'upper': idle['upper'], 'shoot': idle['shoot']}
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
          'newDescriptors', len(new_descriptors))
print('SNAPSHOT_JUMP_PATCH_DONE')
