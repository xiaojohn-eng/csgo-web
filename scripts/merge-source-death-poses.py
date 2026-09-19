"""Merge decoded Death1 into every production character pose dataset.

For each of the 12 production character folders this script:
- appends the original Death1 FRAMEANIM descriptor (float64 frames) to the
  end of the body frames binary (contiguous, matching the loader's range check),
- appends the original Death1 sequence record (MDL index 922, group [1,1],
  non-looping; the original full-body death fall: pelvis 39->6 source units,
  96 frames @30fps for T, 101 @30fps for CT),
- adds states.Death = { lower: 922, upper: 922, shoot: 922 } (Death1 animates
  every bone with unity weights, so all three accumulated layers resolve to
  the pure original death pose; the non-looping flag freezes the corpse at
  the final frame once the cycle clamps to 1),
- rewrites frames bin (+gz where present), pose json, manifest identity and
  emits death-merge-audit.json with old/new hashes.

Run after scripts/export-source-death-sequences.py.
"""
from __future__ import annotations
import gzip, hashlib, json
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public/source/csgo-12426148'
DEATH = ROOT / '.reference-assets/source-exports/character-death'
sha = lambda b: hashlib.sha256(b).hexdigest()

# dir, pose file, frames file, gz file (or None), manifest kind
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

death = {}
for team in ('t', 'ct'):
    meta = json.loads((DEATH / team / 'death-metadata.json').read_text())
    frames = np.load(DEATH / team / 'death-frames.npz')
    seq = next(s for s in meta['sequences'] if s['name'] == 'Death1')
    assert seq['index'] == 922 and seq['animationIndices'] == [2636]
    assert len(meta['boneNames']) == (71 if team == 't' else 70)
    death[team] = {'meta': meta, 'frames': frames, 'seq': seq}

report = []
for folder, pose_file, frames_file, gz_file, kind in TARGETS:
    base = PUBLIC / folder
    pose_bytes = (base / pose_file).read_bytes()
    pose = json.loads(pose_bytes)
    frames_bytes = (base / frames_file).read_bytes()
    assert len(frames_bytes) == pose['frames']['byteLength'] and len(frames_bytes) % 8 == 0

    team = 't' if pose['animationModel'].endswith('/t_animations.mdl') else 'ct'
    assert pose['animationModel'].endswith(f'/{team}_animations.mdl'), f'{folder}: unexpected animation model {pose["animationModel"]}'
    source = death[team]
    meta, frames, seq = source['meta'], source['frames'], source['seq']
    bone_count = len(meta['boneNames'])
    assert [b['name'] for b in pose['animationBones']] == meta['boneNames'], f'{folder}: animation bone table differs from death source MDL'

    used_seq = {s['index'] for s in pose['sequences']}
    used_desc = {d['index'] for d in pose['descriptors']}
    assert seq['index'] == 922 and seq['name'] == 'Death1' and 922 not in used_seq, f'{folder}: sequence slot 922 not free'
    assert seq['groupSize'] == [1, 1] and seq['flags'] == 0
    key = seq['animationIndices'][0]
    assert key == 2636 and key not in used_desc, f'{folder}: death descriptor slot {key} occupied'
    desc = next(d for d in meta['descriptors'] if d['index'] == key)
    expected_frames = 96 if team == 't' else 101
    assert desc['frames'] == expected_frames and desc['fps'] == 30.0 and not desc['delta']

    # Contiguity: every existing descriptor range must tile the binary exactly.
    ranges = sorted((d['positionsOffset'], d['positionsOffset'] + d['positionsCount']) for d in pose['descriptors']) + \
             sorted((d['quaternionsOffset'], d['quaternionsOffset'] + d['quaternionsCount']) for d in pose['descriptors'])
    ranges.sort()
    consumed = 0
    for lo, hi in ranges:
        assert lo == consumed, f'{folder}: existing frame ranges are not contiguous'
        consumed = hi
    total_floats = len(frames_bytes) // 8
    assert consumed == total_floats, f'{folder}: unmapped frame suffix'

    # Append the Death1 descriptor frames.
    positions = np.ascontiguousarray(frames[f'anim_{key}_positions'], dtype='<f8')
    quaternions = np.ascontiguousarray(frames[f'anim_{key}_quaternions'], dtype='<f8')
    assert positions.shape == (desc['frames'], bone_count, 3) and quaternions.shape == (desc['frames'], bone_count, 4)
    assert np.isfinite(positions).all() and np.isfinite(quaternions).all()
    norms = np.linalg.norm(quaternions.reshape(-1, 4), axis=1)
    assert np.max(np.abs(norms - 1)) < 1e-6
    payload = bytearray()
    payload.extend(positions.tobytes(order='C'))
    payload.extend(quaternions.tobytes(order='C'))
    record = dict(desc)
    record['positionsOffset'] = total_floats
    record['positionsCount'] = int(positions.size)
    record['quaternionsOffset'] = total_floats + int(positions.size)
    record['quaternionsCount'] = int(quaternions.size)

    new_frames = frames_bytes + bytes(payload)
    pose['descriptors'].append(record)
    pose['sequences'].append(seq)
    pose['states']['Death'] = {'lower': seq['index'], 'upper': seq['index'], 'shoot': seq['index']}
    pose['frames']['byteLength'] = len(new_frames)
    pose['frames']['sha256'] = sha(new_frames)

    new_pose_bytes = (json.dumps(pose, separators=(',', ':'), allow_nan=False) + '\n').encode()
    (base / pose_file).write_bytes(new_pose_bytes)
    (base / frames_file).write_bytes(new_frames)
    if gz_file:
        (base / gz_file).write_bytes(gzip.compress(new_frames, mtime=0))

    # Manifest identity update.
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
        'descriptor': key, 'sequence': {'index': 922, 'name': 'Death1', 'flags': 0,
                                        'groupSize': [1, 1], 'frames': desc['frames'], 'fps': desc['fps']},
        'statesDeath': pose['states']['Death'],
        'deathPolicy': 'Death state plays the original full-body Death1 fall once (30fps, '
                       f'{desc["frames"]} frames); the non-looping flag freezes the corpse at the final frame. '
                       'lower/upper/shoot all reference Death1 because it animates every bone with unity weights.',
        'frames': desc['frames'],
    }
    (base / 'death-merge-audit.json').write_text(json.dumps(entry, indent=2) + '\n')
    report.append(entry)
    print('DEATH_MERGED', folder, json.dumps({
        'appendedFloats': entry['appendedFloats'], 'frames': entry['frames'],
        'oldPoseVersion': old_pose_version, 'newPoseVersion': manifest['poseVersion'],
        'newManifestSHA256': entry['newManifestSHA256']}))

# Frozen TS constants to update (pistol/deagle/awp loaders pin manifest SHA).
frozen = {}
for entry in report:
    key = entry['folder'].replace('character-', '')
    frozen[key] = {'poseVersion': entry['newPoseVersion'], 'manifestSha256': entry['newManifestSHA256']}
print('FROZEN_UPDATES')
print(json.dumps(frozen, indent=1))
