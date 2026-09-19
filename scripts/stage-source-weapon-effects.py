"""Stage the original per-weapon effect mapping as production data.

Only the keys this build can name are staged, and only for the weapons the build
ships, so every effect string in the client is traceable to `items_game.txt`.
`weapon_<id>_prefab` is the original block name; the shipped ids are mapped to it
here rather than guessed at the call site.

Run: .tools/source-binary-venv/bin/python scripts/stage-source-weapon-effects.py
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'research/source-muzzle-flash-map.json'
DEST = ROOT / 'public/source/csgo-12426148/weapon-effects/effect-map.json'
# Original prefab block -> the weapon ids this build ships. The build's own ids
# are its own names for the original weapons (`vandal` is the original AK-47).
PREFABS = {'vandal': 'weapon_ak47_prefab', 'm4a4': 'weapon_m4a1_prefab', 'awp': 'weapon_awp_prefab',
           'glock': 'weapon_glock_prefab', 'usp': 'weapon_usp_silencer_prefab', 'deagle': 'weapon_deagle_prefab'}
KEYS = ('muzzle_flash_effect_1st_person', 'muzzle_flash_effect_3rd_person', 'heat_effect', 'eject_brass_effect',
        'tracer_effect', 'weapon_type')

research = json.loads(SRC.read_text())
assert research['format'] == 'source-muzzle-flash-map-v1' and research['build'] == 12426148
weapons: dict[str, dict[str, str]] = {}
for weapon, prefab in PREFABS.items():
    row = research['weapons'].get(prefab)
    assert row, f'Original items_game has no visuals for {prefab}'
    weapons[weapon] = {key: row[key] for key in KEYS if key in row}
    missing = [key for key in KEYS if key not in row]
    print(f'{weapon:7s} {prefab:30s} {weapons[weapon]}' + (f'  (absent: {missing})' if missing else ''))

out = {'format': 'source-weapon-effects-v1', 'sourceApp': research['sourceApp'], 'build': research['build'],
       'sourceSha256': hashlib.sha256(SRC.read_bytes()).hexdigest(), 'sourceFile': research['receipt']['path'],
       'sourceFileSha256': research['receipt']['sha256'], 'prefabs': PREFABS, 'weapons': weapons}
DEST.parent.mkdir(parents=True, exist_ok=True)
payload = json.dumps(out, separators=(',', ':')) + '\n'
DEST.write_text(payload)
print(f'wrote {DEST} ({len(payload)} bytes) sha256 {hashlib.sha256(payload.encode()).hexdigest()}')
