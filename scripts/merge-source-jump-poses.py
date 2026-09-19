"""Merge decoded jump_lower into every production character pose dataset.

For each of the 12 production character folders this script:
- appends the 9 original a_jump* FRAMEANIM descriptors (float64 frames) to the
  end of the body frames binary (contiguous, matching the loader's range check),
- appends the original jump_lower sequence record (MDL index 6, 3x3 move_y/move_x blend),
- adds states.Jump = { lower: jump_lower, upper: Idle.upper, shoot: Idle.shoot }
  (original air playback keeps the weapon aim upper body; no Jump_Upper exists
  in the original animation MDLs),
- rewrites frames bin (+gz where present), pose json, manifest identity and
  emits jump-merge-audit.json with old/new hashes.

Run after scripts/export-source-jump-sequences.py.
"""
from __future__ import annotations
import gzip, hashlib, json
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public/source/csgo-12426148'
JUMP = ROOT / '.reference-assets/source-exports/character-jump'
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

jump = {}
for team in ('t', 'ct'):
    meta = json.loads((JUMP / team / 'jump-metadata.json').read_text())
    frames = np.load(JUMP / team / 'jump-frames.npz')
    assert [b for b in meta['boneNames']] and len(meta['boneNames']) == (71 if team == 't' else 70)
    jump[team] = {'meta': meta, 'frames': frames, 'audit': json.loads((JUMP / team / 'jump-audit.json').read_text())}

report = []
for folder, pose_file, frames_file, gz_file, kind in TARGETS:
    base = PUBLIC / folder
    pose_bytes = (base / pose_file).read_bytes()
    pose = json.loads(pose_bytes)
    frames_bytes = (base / frames_file).read_bytes()
    assert len(frames_bytes) == pose['frames']['byteLength'] and len(frames_bytes) % 8 == 0

    team = 't' if pose['animationModel'].endswith('/t_animations.mdl') else 'ct'
    assert pose['animationModel'].endswith(f'/{team}_animations.mdl'), f'{folder}: unexpected animation model {pose["animationModel"]}'
    source = jump[team]
    meta, frames = source['meta'], source['frames']
    bone_count = len(meta['boneNames'])
    assert [b['name'] for b in pose['animationBones']] == meta['boneNames'], f'{folder}: animation bone table differs from jump source MDL'

    used_seq = {s['index'] for s in pose['sequences']}
    used_desc = {d['index'] for d in pose['descriptors']}
    jump_seq = meta['sequences'][0]
    assert jump_seq['index'] == 6 and jump_seq['name'] == 'jump_lower' and 6 not in used_seq, f'{folder}: sequence slot 6 not free'
    assert jump_seq['groupSize'] == [3, 3] and jump_seq['parameterIndices'] == [3, 4]
    assert jump_seq['animationIndices'] == [35, 34, 33, 36, 38, 32, 37, 30, 31]

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

    # Append jump descriptors in jump_lower's own animationIndices order.
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
        'descriptors': [d['index'] for d in new_descriptors],
        'sequence': {'index': 6, 'name': 'jump_lower', 'flags': jump_seq['flags'],
                     'groupSize': jump_seq['groupSize'], 'poseKeys': jump_seq['poseKeys'],
                     'parameterIndices': jump_seq['parameterIndices']},
        'statesJump': pose['states']['Jump'],
        'jumpUpperPolicy': 'Airborne lower body plays original jump_lower 9-way; upper/shoot reuse the weapon Idle aim layers (no Jump_Upper sequence exists in the original animation MDLs).',
        'frames': sum(d['frames'] for d in new_descriptors),
    }
    (base / 'jump-merge-audit.json').write_text(json.dumps(entry, indent=2) + '\n')
    report.append(entry)
    print('JUMP_MERGED', folder, json.dumps({
        'appendedFloats': entry['appendedFloats'], 'frames': entry['frames'],
        'oldPoseVersion': old_pose_version, 'newPoseVersion': manifest['poseVersion'],
        'newManifestSHA256': entry['newManifestSHA256']}))

# Frozen TS constants to update (pistol/deagle/awp loaders pin manifest SHA).
frozen = {}
for entry in report:
    if entry['kind'] == 'rifle':
        continue
    key = entry['folder'].replace('character-', '')
    frozen[key] = {'poseVersion': entry['newPoseVersion'], 'manifestSha256': entry['newManifestSHA256']}
print('FROZEN_UPDATES')
print(json.dumps(frozen, indent=1))
