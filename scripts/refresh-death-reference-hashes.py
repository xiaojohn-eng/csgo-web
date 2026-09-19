"""Refresh the frozen reference hashes after the Death1 snapshot merge.

scripts/patch-source-death-snapshots.py appended the original Death1 FRAMEANIM
descriptor to every research snapshot body dataset (existing descriptors keep
their offsets, so every independently verified sample is unchanged). The frozen
provenance hashes must now point at the patched files:

- pistol/deagle/awp candidates python-reference.json bodyDataSHA256,
- the AWP hitbox oracle actors[].dataSha256 (output/tests/...-native.json),
- the M4 actor-reference.json poseDataSHA256 (mirrors the production manifest
  entry for pose-data.json after scripts/merge-source-death-poses.py).
"""
from __future__ import annotations
import hashlib, json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPORTS = ROOT / '.reference-assets/source-exports'
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()

updated = []
for team in ('t', 'ct'):
    for group, folder in [
        ('pistol', f'pistol-candidates/character-{team}-glock'),
        ('pistol', f'pistol-candidates/character-{team}-usp'),
        ('deagle', f'deagle-candidates/character-{team}-deagle'),
        ('awp', f'awp-character-candidates/character-{team}-awp'),
    ]:
        base = EXPORTS / folder
        reference_path = base / 'python-reference.json'
        reference = json.loads(reference_path.read_text())
        new_hash = sha(base / 'body-pose-data.json')
        if reference['bodyDataSHA256'] == new_hash:
            continue
        reference['bodyDataSHA256'] = new_hash
        reference_path.write_text(json.dumps(reference, separators=(',', ':')) + '\n')
        updated.append(f'{folder}/python-reference.json bodyDataSHA256')

    awp_base = EXPORTS / f'awp-character-candidates/character-{team}-awp'
    oracle_path = ROOT / 'output/tests/source-awp-character-hitbox-native.json'
    oracle = json.loads(oracle_path.read_text())
    actor = next(a for a in oracle['actors'] if a['profile'] == f'{team}-awp')
    new_hash = sha(awp_base / 'body-pose-data.json')
    if actor['dataSha256'] != new_hash:
        actor['dataSha256'] = new_hash
        oracle_path.write_text(json.dumps(oracle, separators=(',', ':')) + '\n')
        updated.append(f'{team}-awp hitbox oracle dataSha256')

    m4_reference_path = EXPORTS / f'character-{team}-m4/actor-reference.json'
    m4_reference = json.loads(m4_reference_path.read_text())
    manifest = json.loads((ROOT / f'public/source/csgo-12426148/character-{team}-m4/manifest.json').read_text())
    entry = manifest['files'][manifest['poseData']]
    assert entry['sha256'] == sha(ROOT / f'public/source/csgo-12426148/character-{team}-m4/{manifest["poseData"]}')
    if m4_reference['poseDataSHA256'] != entry['sha256']:
        m4_reference['poseDataSHA256'] = entry['sha256']
        m4_reference_path.write_text(json.dumps(m4_reference, separators=(',', ':')) + '\n')
        updated.append(f'character-{team}-m4/actor-reference.json poseDataSHA256')

for line in updated:
    print('REFRESHED', line)
print('DEATH_REFERENCE_REFRESH_DONE')
