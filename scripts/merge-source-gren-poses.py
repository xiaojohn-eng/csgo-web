"""Merge the five decoded Shoot_GREN1 delta layers into every production character
pose dataset.

For each of the 12 production character folders this script:
- appends the five original Shoot_GREN1 FRAMEANIM descriptors (float64 delta
  frames) to the end of the body frames binary (contiguous, matching the
  loader's range check),
- appends the five original sequence records (MDL indices 829-833, group [1,1],
  non-looping delta layers with their original 0/1 bone-weight masks: the
  moving variants zero the leg chain so locomotion keeps driving the legs),
- does NOT add a state: the throw is an overlay layer (like jump), the pose
  driver picks the variant from the current locomotion state,
- rewrites frames bin (+gz where present), pose json, manifest identity and
  emits gren-merge-audit.json with old/new hashes.

Run after scripts/export-source-gren-sequences.py.
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

gren = {}
for team in ('t', 'ct'):
    meta = json.loads((GREN / team / 'gren-metadata.json').read_text())
    frames = np.load(GREN / team / 'gren-frames.npz')
    seqs = {}
    for variant in VARIANTS:
        name = f'{variant}_Shoot_GREN1'
        seq = next(s for s in meta['sequences'] if s['name'] == name)
        assert seq['groupSize'] == [1, 1] and seq['autoLayers'] == []
        weights = seq['boneWeights']
        assert all(w in (0.0, 1.0) for w in weights)
        seqs[name] = seq
    assert len(meta['boneNames']) == (71 if team == 't' else 70)
    gren[team] = {'meta': meta, 'frames': frames, 'seqs': seqs}

report = []
for folder, pose_file, frames_file, gz_file, kind in TARGETS:
    base = PUBLIC / folder
    pose_bytes = (base / pose_file).read_bytes()
    pose = json.loads(pose_bytes)
    frames_bytes = (base / frames_file).read_bytes()
    assert len(frames_bytes) == pose['frames']['byteLength'] and len(frames_bytes) % 8 == 0

    team = 't' if pose['animationModel'].endswith('/t_animations.mdl') else 'ct'
    assert pose['animationModel'].endswith(f'/{team}_animations.mdl'), f'{folder}: unexpected animation model {pose["animationModel"]}'
    source = gren[team]
    meta, frames = source['meta'], source['frames']
    bone_count = len(meta['boneNames'])
    assert [b['name'] for b in pose['animationBones']] == meta['boneNames'], f'{folder}: animation bone table differs from gren source MDL'

    used_seq = {s['index'] for s in pose['sequences']}
    used_desc = {d['index'] for d in pose['descriptors']}
    for variant in VARIANTS:
        name = f'{variant}_Shoot_GREN1'
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
    new_sequences = []
    new_descriptors = []
    variant_report = []
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
        new_descriptors.append(record)
        new_sequences.append(seq)
        weights = seq['boneWeights']
        variant_report.append({'name': name, 'index': seq['index'], 'descriptor': key,
                               'frames': desc['frames'], 'fps': desc['fps'],
                               'weightOnes': sum(1 for w in weights if w == 1.0),
                               'weightZeros': sum(1 for w in weights if w == 0.0)})

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
        'variants': variant_report,
        'throwPolicy': 'The five Shoot_GREN1 delta layers are appended without a state: '
                       'the pose driver overlays the variant matching the current locomotion '
                       'state on throw input (single 14-frame run @30fps, non-looping cycle clamp).',
        'frames': sum(v['frames'] for v in variant_report),
    }
    (base / 'gren-merge-audit.json').write_text(json.dumps(entry, indent=2) + '\n')
    report.append(entry)
    print('GREN_MERGED', folder, json.dumps({
        'appendedFloats': entry['appendedFloats'], 'frames': entry['frames'],
        'oldPoseVersion': old_pose_version, 'newPoseVersion': manifest['poseVersion'],
        'newManifestSHA256': entry['newManifestSHA256']}))

frozen = {}
for entry in report:
    key = entry['folder'].replace('character-', '')
    frozen[key] = {'poseVersion': entry['newPoseVersion'], 'manifestSha256': entry['newManifestSHA256']}
print('FROZEN_UPDATES')
print(json.dumps(frozen, indent=1))
