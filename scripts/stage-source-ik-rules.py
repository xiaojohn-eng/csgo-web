"""Stage the exported original IK chains and rules as production data.

Only the descriptors the shipped pose datasets actually sample are staged, so the
file is exactly the rule set a solver can be asked for. Staging is also where the
two independently produced assets are cross-checked: every descriptor that
`pose-data.json` says carries `ikRules` must have exactly that many rules here.

Run: .tools/source-binary-venv/bin/python scripts/stage-source-ik-rules.py
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'research/source-ik-rules.json'
DEST = ROOT / 'public/source/csgo-12426148/ik/ik-rules.json'
PUBLIC = ROOT / 'public/source/csgo-12426148'
TEAM_OF = {'models/player/t_animations.mdl': 't', 'models/player/ct_animations.mdl': 'ct'}

research = json.loads(SRC.read_text())
assert research['format'] == 'source-ik-rules-v1' and research['build'] == 12426148
assert research['recordBytes'] == 152

needed: dict[str, set[str]] = {'t': set(), 'ct': set()}
datasets = sorted(path for path in PUBLIC.glob('character*/pose-data.json'))
assert datasets, 'No shipped pose datasets to cross-check against'
for path in datasets:
    pose = json.loads(path.read_text())
    team = TEAM_OF.get(pose['animationModel'])
    assert team, f'{path} names an unknown original animation model'
    rules = research['models'][pose['animationModel']]['rules']
    checked = 0
    for descriptor in pose['descriptors']:
        count = descriptor['ikRules']
        exported = rules.get(descriptor['name'])
        assert (exported is None) == (count == 0), (
            f'{path.name}: {descriptor["name"]} carries {count} rules in the shipped pose data '
            f'but {"none" if exported is None else len(exported)} in the export')
        if count:
            assert len(exported) == count, f'{path.name}: {descriptor["name"]} rule count differs'
            needed[team].add(descriptor['name'])
            checked += count
    print(f'{path.parent.name}: {checked} rules cross-checked against the shipped pose data')

out = {'format': 'source-ik-rules-v1', 'sourceApp': research['sourceApp'], 'build': research['build'],
       'recordBytes': research['recordBytes'], 'ruleTypes': research['ruleTypes'],
       'exportSha256': hashlib.sha256(SRC.read_bytes()).hexdigest(),
       'receipts': research['receipts'], 'teams': {}}
for team, names in needed.items():
    model = next(m for m, t in TEAM_OF.items() if t == team)
    source = research['models'][model]
    out['teams'][team] = {'animationModel': model, 'bones': source['bones'], 'ikChains': source['ikChains'],
                          'rules': {name: source['rules'][name] for name in sorted(names)}}

DEST.parent.mkdir(parents=True, exist_ok=True)
payload = json.dumps(out, separators=(',', ':')) + '\n'
DEST.write_text(payload)
print(f'wrote {DEST} ({len(payload)} bytes)')
print(f'sha256 {hashlib.sha256(payload.encode()).hexdigest()}')
for team, data in out['teams'].items():
    counts: dict[str, int] = {}
    for rules in data['rules'].values():
        for rule in rules:
            counts[rule['type']] = counts.get(rule['type'], 0) + 1
    print(f'  {team}: descriptors={len(data["rules"])} rules={sum(counts.values())} {counts}')
