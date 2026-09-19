"""Strip the five appended Shoot_GREN1 delta layers from the ten ORIGINAL
research snapshot body datasets, restoring their pre-GREN bytes so
scripts/patch-source-gren-snapshots.py can re-append them in the production
variant order (Idle, Walk, Run — scripts/merge-source-gren-poses.py).

The merge script left gren-merge-audit.json in every production folder with
the pre-GREN frames SHA; because the deagle/glock/usp/awp/rifle production
body bytes equal the matching snapshot bytes, those audits cross-validate the
stripped snapshots byte-for-byte.
"""
from __future__ import annotations
import gzip, hashlib, json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPORTS = ROOT / '.reference-assets/source-exports'
PUBLIC = ROOT / 'public/source/csgo-12426148'
sha = lambda b: hashlib.sha256(b).hexdigest()

# snapshot folder -> production folder whose gren-merge-audit.json holds the
# pre-GREN frames SHA the stripped snapshot must reproduce
TARGETS = {
    'character-t/continuous': 'character-ak',
    'character-ct/continuous': 'character-ct-ak',
    'awp-character-candidates/character-t-awp': 'character-t-awp',
    'awp-character-candidates/character-ct-awp': 'character-ct-awp',
    'deagle-candidates/character-t-deagle': 'character-t-deagle',
    'deagle-candidates/character-ct-deagle': 'character-ct-deagle',
    'pistol-candidates/character-t-glock': 'character-t-glock',
    'pistol-candidates/character-ct-glock': 'character-ct-glock',
    'pistol-candidates/character-t-usp': 'character-t-usp',
    'pistol-candidates/character-ct-usp': 'character-ct-usp',
}

VARIANTS = ['Run', 'Walk', 'Idle', 'Crouch_Idle', 'Crouch_Walk']
GREN_SEQ = {f'{v}_Shoot_GREN1' for v in VARIANTS}
GREN_DESC = {f'{v}_Shoot_GREN_layer' for v in VARIANTS}

audits = {}
for folder in set(TARGETS.values()):
    audit = json.loads((PUBLIC / folder / 'gren-merge-audit.json').read_text())
    audits[folder] = audit['oldFramesSHA256']

for snapshot, production in TARGETS.items():
    base = EXPORTS / snapshot
    pose_file = 'pose-data.json' if (snapshot.startswith('character-')) else 'body-pose-data.json'
    frames_file = 'frames.f64.bin' if pose_file == 'pose-data.json' else 'body-frames.f64.bin'
    gz_file = 'frames.f64.bin.gz' if pose_file == 'pose-data.json' else None
    pose = json.loads((base / pose_file).read_text())
    frames_bytes = (base / frames_file).read_bytes()
    assert len(frames_bytes) == pose['frames']['byteLength']

    seq_names = {s['name'] for s in pose['sequences']}
    assert GREN_SEQ <= seq_names, f'{snapshot}: grenade sequences absent'
    kept_sequences = [s for s in pose['sequences'] if s['name'] not in GREN_SEQ]
    desc_names = [d['name'] for d in pose['descriptors']]
    assert GREN_DESC <= set(desc_names), f'{snapshot}: grenade descriptors absent'
    kept_descriptors = [d for d in pose['descriptors'] if d['name'] not in GREN_DESC]

    ranges = sorted((d['positionsOffset'], d['positionsOffset'] + d['positionsCount']) for d in kept_descriptors) + \
             sorted((d['quaternionsOffset'], d['quaternionsOffset'] + d['quaternionsCount']) for d in kept_descriptors)
    ranges.sort()
    consumed = 0
    for lo, hi in ranges:
        assert lo == consumed, f'{snapshot}: kept frame ranges are not contiguous'
        consumed = hi
    stripped_bytes = frames_bytes[:consumed * 8]
    stripped_sha = sha(stripped_bytes)
    expected = audits[production]
    assert stripped_sha == expected, f'{snapshot}: stripped SHA {stripped_sha} != pre-GREN {expected}'

    pose['descriptors'] = kept_descriptors
    pose['sequences'] = kept_sequences
    pose['frames']['byteLength'] = len(stripped_bytes)
    pose['frames']['sha256'] = stripped_sha
    new_pose_bytes = (json.dumps(pose, separators=(',', ':'), allow_nan=False) + '\n').encode()
    (base / pose_file).write_bytes(new_pose_bytes)
    (base / frames_file).write_bytes(stripped_bytes)
    gzip_bytes = None
    if gz_file:
        gzip_bytes = gzip.compress(stripped_bytes, mtime=0)
        (base / gz_file).write_bytes(gzip_bytes)

    manifest_path = base / 'manifest.json'
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        manifest['descriptors'] = len(kept_descriptors)
        manifest['frames'] = sum(d['frames'] for d in kept_descriptors)
        manifest['binaryBytes'] = len(stripped_bytes)
        manifest['binarySha256'] = stripped_sha
        manifest['jsonBytes'] = len(new_pose_bytes)
        manifest['jsonSha256'] = sha(new_pose_bytes)
        if gzip_bytes is not None:
            manifest['gzipBytes'] = len(gzip_bytes)
        manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')

    print('STRIPPED', snapshot, 'bytes', len(stripped_bytes), 'sha', stripped_sha[:16])
print('GREN_UNPATCH_DONE')
