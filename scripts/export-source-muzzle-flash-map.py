"""Export the original per-weapon effect mapping from the shipped items_game.

The original keeps every weapon's effect choice in `scripts/items/items_game.txt`,
inside that weapon's own `visuals` block, and it distinguishes first- from
third-person systems explicitly. Nothing here is inferred from a weapon's name:
every string comes from that file, and the file's own SHA256 is recorded.

Extracted keys (all of them are original values, not defaults):
  muzzle_flash_effect_1st_person, muzzle_flash_effect_3rd_person, heat_effect,
  eject_brass_effect, tracer_effect, weapon_type, player_animation_extension

Run: Blender --background --factory-startup --python-exit-code 1 \
       --python scripts/export-source-muzzle-flash-map.py
"""
from __future__ import annotations
from pathlib import Path
import importlib.util, json, re

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'research/source-muzzle-flash-map.json'
KEYS = ('muzzle_flash_effect_1st_person', 'muzzle_flash_effect_3rd_person', 'heat_effect',
        'eject_brass_effect', 'tracer_effect', 'weapon_type', 'player_animation_extension')

spec = importlib.util.spec_from_file_location('pistol_particle_items', ROOT / 'scripts/inventory-source-items.py')
items = importlib.util.module_from_spec(spec); spec.loader.exec_module(items)
context = items.initialize(); sources = items.Sources()

path = 'scripts/items/items_game.txt'
text = sources.read(path).decode('utf-8', 'replace')
receipt = sources.reads[path]

# The file is written one token per line: `"name"` then `{` to open a block, key
# rows as two quoted tokens, and `}` to close. Walking that stack attributes each
# row to the weapon block that owns it.
stack: list[str | None] = []
pending: str | None = None
weapons: dict[str, dict[str, str]] = {}
other: list[dict[str, str]] = []
for raw in text.splitlines():
    line = raw.strip()
    if not line or line.startswith('//'):
        continue
    if line == '{':
        stack.append(pending); pending = None; continue
    if line.startswith('}'):
        if stack:
            stack.pop()
        continue
    parts = re.findall(r'"([^"]*)"', line)
    braces = line.count('{') + line.count('}')
    if len(parts) == 1 and not braces:
        pending = parts[0]
        continue
    if len(parts) >= 2 and not braces:
        key, value = parts[0], parts[1]
        if key in KEYS:
            owner = stack[-2] if len(stack) >= 2 and stack[-1] == 'visuals' else None
            if owner is None:
                other.append({'context': [block for block in stack if block], 'key': key, 'value': value})
            else:
                weapons.setdefault(owner, {})[key] = value
        continue
    if braces:
        # A block opened or closed on the same line as other content.
        stack.append(parts[0] if parts else None) if line.endswith('{') else None
        if line.endswith('}'):
            for _ in range(line.count('}')):
                if stack:
                    stack.pop()

result = {'format': 'source-muzzle-flash-map-v1', 'sourceApp': 740, 'build': 12426148,
          'receipt': receipt, 'keys': list(KEYS), 'weapons': weapons, 'unattributed': other[:20]}
OUT.parent.mkdir(parents=True, exist_ok=True)
payload = json.dumps(result, indent=1, ensure_ascii=False) + '\n'
OUT.write_text(payload)
print('weapons with visuals', len(weapons))
for weapon in ('weapon_ak47', 'weapon_m4a1', 'weapon_awp', 'weapon_glock', 'weapon_usp_silencer', 'weapon_deagle',
               'weapon_p250', 'weapon_mp9', 'weapon_ssg08', 'weapon_famas'):
    print(' ', weapon, weapons.get(weapon, 'ABSENT'))
print('unattributed rows', len(other))
systems = sorted({value for effects in weapons.values() for value in effects.values()
                  if isinstance(value, str) and value.startswith(('weapon_muzzle', 'weapon_shell', 'weapon_tracers'))})
print('effect systems', len(systems), systems[:14])
print('names', sorted(weapons)[:70])
print('wrote', OUT, len(payload), 'bytes')
