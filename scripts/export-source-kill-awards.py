"""Export the original per-weapon kill award from the shipped items_game.

The original keeps the cash a kill pays where it keeps every other weapon
property: `scripts/items/items_game.txt`, as the `kill award` attribute of the
weapon's own item block or of a prefab it inherits from. Fifteen prefabs state one
explicitly — `melee` 1500 (the knife), the five SMG prefabs 600, the four shotgun
prefabs 900, the AWP and CZ75 100, the taser 0 — and every other weapon inherits
`statted_item_base`'s 300, which is also the shipped
`cash_player_killed_enemy_default`. The prefab chain is walked here, so a weapon is
resolved by what the file says it inherits rather than by its name.

The base default is cross-checked against the two shipped competitive mode configs:
if `cash_player_killed_enemy_default` disagreed with `statted_item_base`, this
export fails rather than choosing one.

Run: Blender --background --factory-startup --python-exit-code 1 \
       --python scripts/export-source-kill-awards.py
"""
from __future__ import annotations
from pathlib import Path
import importlib.util, json, re

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'research/source-kill-awards.json'
ITEMS = 'scripts/items/items_game.txt'
CFGS = ('csgo/cfg/gamemode_competitive.cfg', 'csgo/cfg/gamemode_competitive_short.cfg')

spec = importlib.util.spec_from_file_location('items_reader', ROOT / 'scripts/inventory-source-items.py')
items = importlib.util.module_from_spec(spec); spec.loader.exec_module(items)
context = items.initialize(); sources = items.Sources()

path = ITEMS
text = sources.read(path).decode('utf-8', 'replace')
receipt = sources.reads[path]

stack: list[str | None] = []
pending: str | None = None
rows: list[tuple[list[str], str, str]] = []
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
    found = re.findall(r'"((?:[^"\\]|\\.)*)"', line)
    braces = line.count('{') + line.count('}')
    if len(found) == 1 and not braces:
        pending = found[0]
        continue
    if len(found) >= 2 and not braces:
        rows.append(([block for block in stack if block], found[0], found[1]))
        continue
    if braces:
        if line.endswith('{'):
            stack.append(found[0] if found else None)
        if line.endswith('}'):
            for _ in range(line.count('}')):
                if stack:
                    stack.pop()


def award_of(block: dict) -> str | None:
    """The block's own `kill award` row, whatever case or spacing the file uses."""
    attributes = block.get('__attributes') or {}
    for key, value in attributes.items():
        if key.strip().lower().replace('_', ' ') == 'kill award':
            return value
    return None


# The item table is keyed by the original's own item number; the weapon's name is a
# row inside each block, so the lookup the rest of this export needs is built here.
by_defindex: dict[str, dict] = {}
prefabs: dict[str, dict] = {}
for row_path, key, value in rows:
    head = row_path[:2]
    if head not in (['items_game', 'items'], ['items_game', 'prefabs']):
        continue
    table = by_defindex if head[1] == 'items' else prefabs
    if len(row_path) == 3:
        table.setdefault(row_path[2], {})[key] = value
    elif len(row_path) == 4 and row_path[3] == 'attributes':
        table.setdefault(row_path[2], {}).setdefault('__attributes', {})[key] = value

items_by_name = {block['name']: {**block, 'defindex': defindex}
                 for defindex, block in by_defindex.items() if 'name' in block}
if len(items_by_name) != sum(1 for block in by_defindex.values() if 'name' in block):
    raise ValueError('Two items share one name; the lookup would be ambiguous')

prefab_awards = {name: int(award) for name, block in prefabs.items()
                 if (award := award_of(block)) is not None and award.lstrip('-').isdigit()}
if not prefab_awards:
    raise ValueError('The shipped file states no prefab kill award at all')
default_owner = 'statted_item_base'
if default_owner not in prefab_awards:
    raise ValueError('The shipped base prefab no longer states a kill award')
default_award = prefab_awards[default_owner]


def resolve(name: str):
    """Walk the weapon's own block and then its prefab chain, in file order."""
    block = items_by_name.get(name)
    if block is None:
        return None
    chain = [name]
    own = award_of(block)
    if own is not None:
        return {'award': int(own), 'owner': name, 'chain': chain}
    prefab = block.get('prefab')
    while prefab:
        chain.append(prefab)
        parent = prefabs.get(prefab)
        if parent is None:
            raise ValueError(f'{name} inherits a prefab the file does not define: {prefab}')
        award = award_of(parent)
        if award is not None:
            return {'award': int(award), 'owner': prefab, 'chain': chain}
        prefab = parent.get('prefab')
    return None


# Every item whose prefab chain reaches the weapon base or the melee base is a
# weapon in the original's own sense; anything else (cases, tools, music kits) is
# not one and is reported rather than given an award.
weapon_rows: dict[str, dict] = {}
not_weapons: list[str] = []
for name, block in sorted(items_by_name.items()):
    if not name.startswith('weapon_'):
        continue
    prefab = block.get('prefab')
    if prefab is None:
        not_weapons.append(name)
        continue
    chain, reached = [prefab], False
    cursor = prefab
    while cursor and not reached:
        if cursor in ('weapon_base', 'melee'):
            reached = True
            break
        parent = prefabs.get(cursor)
        if parent is None:
            break
        cursor = parent.get('prefab')
        chain.append(cursor)
    if not reached:
        not_weapons.append(name)
        continue
    resolved = resolve(name)
    if resolved is None:
        raise ValueError(f'{name} is a weapon with no award in its chain')
    weapon_rows[name] = {**resolved, 'prefab': prefab}

if weapon_rows['weapon_awp']['award'] != 100:
    raise ValueError('The shipped AWP award is no longer the 100 this export documents')
if weapon_rows['weapon_knife']['award'] != 1500:
    raise ValueError('The shipped knife award is no longer the 1500 this export documents')

# Cross-check against the shipped mode configs, which state the same default. The
# configs live in the install's cfg directory rather than in a vpk, so they are read
# from disk the way the mode stager reads them.
import hashlib

cross = []
for index, relative in enumerate(CFGS):
    config_path = ROOT / '.reference-assets/csgo-legacy' / relative
    data = config_path.read_bytes()
    text = data.decode('utf-8', 'replace')
    found = re.search(r'^\s*cash_player_killed_enemy_default\s+"?([0-9]+)"?\s*$', text, re.M)
    factor = re.search(r'^\s*cash_player_killed_enemy_factor\s+"?([0-9.]+)"?\s*$', text, re.M)
    if not found:
        # The short mode is the base config plus the keys it overrides, so a key it does
        # not restate is the base's value rather than a missing one.
        if index == 0:
            raise ValueError(f'{relative} no longer states cash_player_killed_enemy_default')
        cross.append({'file': relative, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
                      'killDefault': None, 'killFactor': None, 'restates': False})
        continue
    value = int(found.group(1))
    if value != default_award:
        raise ValueError(f'{relative} default kill cash {value} disagrees with the item base {default_award}')
    cross.append({'file': relative, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
                  'killDefault': value, 'killFactor': float(factor.group(1)) if factor else None,
                  'restates': True})

result = {
    'format': 'source-kill-awards-v1',
    'sourceApp': 740, 'build': 12426148,
    'source': path, 'receipt': receipt,
    'defaultAward': {'owner': default_owner, 'award': default_award},
    'prefabAwards': prefab_awards,
    'weapons': weapon_rows,
    'notWeapons': not_weapons,
    'modeConfigCrossCheck': cross,
    'note': 'The award is the value the shipped file states for the weapon, or the '
            '`kill award` of the prefab its own chain reaches. Nothing here is a default '
            'chosen by this port: a weapon whose chain states no award inherits '
            f'`{default_owner}`\'s {default_award}, which is also what both shipped '
            'competitive configs set `cash_player_killed_enemy_default` to.',
}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(result, indent=1, ensure_ascii=False, default=str) + '\n', encoding='utf-8')
print('items parsed', len(items_by_name), 'prefabs', len(prefabs))
print('prefab awards', prefab_awards)
print('weapons resolved', len(weapon_rows), 'not weapons', len(not_weapons))
for name in ('weapon_ak47', 'weapon_m4a1', 'weapon_awp', 'weapon_glock', 'weapon_usp_silencer',
             'weapon_deagle', 'weapon_hegrenade', 'weapon_molotov', 'weapon_knife', 'weapon_mp9',
             'weapon_nova', 'weapon_ssg08'):
    print(' ', name, weapon_rows.get(name))
print('mode cross-check', [(row['file'], row['killDefault'], row['killFactor']) for row in cross])
print('wrote', OUT.relative_to(ROOT))
