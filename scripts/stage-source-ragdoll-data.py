"""Stage the extracted ragdoll definition as the shared production data file.

T and CT player models ship byte-identical ragdoll text definitions (the only
difference is a 1e-6 rounding on one forearm mass), so one shared file backs
both. The output keeps the original per-part masses, damping, rotdamping,
inertia, volume, massBias and parent chain plus the per-joint axis limits,
exactly as parsed from the PHY text section. SHA is printed for freezing.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
src = ROOT / 'research/source-ragdoll-data.json'
dest = ROOT / 'public/source/csgo-12426148/ragdoll/ragdoll-data.json'

data = json.loads(src.read_text())
t, ct = data['t'], data['ct']

for p, c in zip(t['parts'], ct['parts']):
    assert p['bone'] == c['bone'] and p.get('parentBone') == c.get('parentBone')
    assert abs(p['mass'] - c['mass']) < 1e-4, f"{p['bone']}: mass differs beyond rounding"
for j, k in zip(t['joints'], ct['joints']):
    assert j == k, 'joint limits differ between T and CT models'

parts = [{
    'index': p['index'], 'bone': p['bone'], 'mass': p['mass'],
    'damping': p['damping'], 'rotdamping': p['rotdamping'],
    'inertia': p['inertia'], 'volume': p['volume'],
    **({'parentBone': p['parentBone']} if 'parentBone' in p else {}),
    **({'massBias': p['massBias']} if 'massBias' in p else {}),
} for p in t['parts']]
joints = [{
    'parent': j['parent'], 'child': j['child'],
    'x': j['x'][:2], 'y': j['y'][:2], 'z': j['z'][:2],
} for j in t['joints']]

out = {
    'format': 'source-ragdoll-v1',
    'sourceApp': 740,
    'build': 12426148,
    'models': {'t': t['source'], 'ct': ct['source']},
    'phyChecksums': {'t': t['phyChecksum'], 'ct': ct['phyChecksum']},
    'rootBone': 'ValveBiped.Bip01_Pelvis',
    'totalMass': t['totalMass'],
    'summedPartMass': t['summedPartMass'],
    'parts': parts,
    'joints': joints,
}
dest.parent.mkdir(parents=True, exist_ok=True)
payload = json.dumps(out, separators=(',', ':')) + '\n'
dest.write_text(payload)
sha = hashlib.sha256(payload.encode()).hexdigest()
print(f'wrote {dest} ({dest.stat().st_size} bytes)')
print(f'sha256 {sha}')
print(f'parts={len(parts)} joints={len(joints)} mass={out["summedPartMass"]}')
