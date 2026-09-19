"""Execute the original normal bullet path with frozen pistol item attributes.

Reuses only the ELF/Unicorn original-byte executor, not a reimplementation of
damage formulas. No player or live game process is created.
"""
from pathlib import Path
import hashlib
import importlib.util
import json

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('original_pistol_damage_blocks', ROOT / 'scripts/probe-source-damage.py')
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)
inventory = json.loads((ROOT / '.reference-assets/source-exports/pistol-candidates/inventory.json').read_text())
source = inventory['itemSource']
raw = (ROOT / '.reference-assets/csgo-legacy/csgo' / source['path']).read_bytes()
assert hashlib.sha256(raw).hexdigest() == source['sha256']
oracle = native.OriginalDamage()
rows, profiles = [], {}
for weapon, item, expected in [
    ('glock18', '4', {'damage': 30, 'headshot multiplier': 4, 'armor ratio': .94, 'range': 4096, 'range modifier': .85}),
    ('usp-s', '61', {'damage': 35, 'headshot multiplier': 4, 'armor ratio': 1.01, 'range': 4096, 'range modifier': .91}),
]:
    item_row = next(w for w in inventory['weapons'] if w['id'] == item)
    attrs = {k: float(item_row['definition']['attributes'][k]) for k in expected}
    assert attrs == expected
    profiles[weapon] = {'itemDefinition': int(item), 'name': item_row['name'], 'attributes': attrs}
    for distance in [0, 1, 100, 500, 1000, 2000, 4096]:
        attenuated = oracle.distance(attrs['damage'], attrs['range modifier'], distance)
        for group in range(9):
            for armor in [0, 1, 5, 20, 100]:
                for helmet in [False, True]:
                    grouped = oracle.hitgroup(attenuated, group, armor, helmet, head=attrs['headshot multiplier'])
                    final = oracle.armor(grouped, attrs['armor ratio'], group, armor, helmet)
                    final['healthDamageInteger'] = oracle.health_integer(final['damage'])
                    rows.append({'weapon': weapon, 'distanceSource': distance, 'hitgroup': group,
                                 'armor': armor, 'helmet': helmet, 'attenuated': attenuated,
                                 'grouped': grouped, 'original': final})
report = {'sourceServerSha256': native.SHA, 'sourceItems': source, 'profiles': profiles,
          'status': 'original_normal_pistol_damage_blocks_executed', 'rows': rows,
          'scope': 'Ordinary no-penetration bullet damage, default team multipliers; mode selection does not change these original item damage attributes. No heavy armor, wall penetration or complete entity damage side effects.'}
(ROOT / 'output/tests/source-pistol-damage-native.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'cases': len(rows), 'profiles': profiles, 'status': report['status']}))
