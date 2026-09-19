"""What the installed build states about its decal pool and its decal fog fade.

The decal chain's gap list carried three items that no shipped file had been read for. Two of
them are answered here, the third is answered precisely enough to be implemented next.

  * `r_decals` is a real convar of the installed engine and its default is the string `2048`
    that sits in the same string pool immediately before the convar's own name. The engine
    also ships its own debug wording - `%d decals: %d permanent, %d dynamic` and
    `R_FindDynamicDecalSlot: no slot available` - which is what says its pool counts two kinds
    of decals and recycles a slot when full.
  * There is **no** `cl_decals*` convar anywhere in the installed binaries, so this build has
    no decal fade *time* to reproduce.
  * The fade the decals do have is a **fog** fade, and it is a fully stated shader feature of
    the installed `DecalModulate`: a static flag `bHasFogFade` (define `FOGFADE`) and four
    parameters, `$FOGEXPONENT` (default `0.4`, "exponent to tweak fog fade"), `$FOGSCALE`
    ("scale to tweak fog fade"), `$FOGFADESTART` ("fog amount at which to start fading decal")
    and `$FOGFADEEND` ("fog amount at which to end fading decal", both upper case in the
    shader while the materials spell them lower case, which the engine's case-insensitive
    lookups accept). All 14 shipped materials that state a fog fade - the bullet decal sheet
    among them - state exactly `$fogfadeend 0.5` and nothing else.

Run: python3 scripts/probe-source-decal-pool.py
"""
from __future__ import annotations
from pathlib import Path
import hashlib
import importlib.util
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / '.reference-assets/csgo-legacy'
OUT = ROOT / 'research/source-decal-pool.json'

binaries = sorted({path for root in (ASSETS / 'bin', ASSETS / 'csgo/bin') for path in root.rglob('*.so')})
engine = (ASSETS / 'bin/linux64/engine_client.so').read_bytes()
NAME_AT = engine.find(b'r_decals\x00')
counts = {}
for path in binaries:
    data = path.read_bytes()
    counts[str(path.relative_to(ASSETS))] = {
        'r_decals': data.count(b'r_decals'),
        'r_decal_overlap_count': data.count(b'r_decal_overlap_count'),
        'cl_decals': len(re.findall(rb'cl_decals', data, re.I)),
        # The shader states its own fade parameters, so this counts the shader's spelling.
        'fog fade parameters': len(re.findall(rb'\$FOGFADE', data)),
    }
assert counts['bin/linux64/engine_client.so']['r_decals'] >= 2, counts['bin/linux64/engine_client.so']
for name, row in counts.items():
    assert row['cl_decals'] == 0, f'{name} grew a decal fade convar'
assert counts['bin/linux64/stdshader_dx9_client.so']['fog fade parameters'] == 2, counts

# The engine states the default as the string next to the convar's own name: the NUL right
# before the name ends the default's own string, so walk back one more terminator.
terminator = NAME_AT - 1
assert engine[terminator] == 0, 'the convar name is not preceded by a terminated string'
start = engine.rindex(b'\0', 0, terminator) + 1
default_before_name = engine[start:terminator].decode('ascii')
assert default_before_name == '2048', repr(default_before_name)


def cstring_at(data: bytes, address: int) -> str:
    end = data.index(b'\0', address)
    return data[address:end].decode('ascii', 'replace')


DEBUG_FORMAT = engine.find(b'%d decals: %d permanent, %d dynamic')
assert DEBUG_FORMAT >= 0
NO_SLOT = engine.find(b'R_FindDynamicDecalSlot: no slot available')
assert NO_SLOT >= 0

# The decal shader's own parameter table: the names, the one default that has a value beside
# it, and the descriptions the build ships for them.
shaders = (ASSETS / 'bin/linux64/stdshader_dx9_client.so').read_bytes()
DECAL_PARAMETER_BLOCK = 0x1167f0
assert shaders.find(b'DecalModulate_DX9\0') >= 0
assert shaders.find(b'bHasFogFade\0FOGFADE\0') == DECAL_PARAMETER_BLOCK
assert shaders.find(b'$FOGFADESTART\0$FOGFADEEND\0') > 0
decal_parameters = []
for name in ('$FOGEXPONENT', '$FOGSCALE', '$FOGFADESTART', '$FOGFADEEND'):
    at = shaders.index(name.encode() + b'\0')
    # Walk the strings that follow this parameter's name: the default (when it has one) and
    # the description, whichever comes first, since two parameters here share one description
    # run and state no default at all.
    offset = at + len(name) + 1
    default, description = None, None
    # The pool aligns its strings, so a run of empty strings may have to be crossed before the
    # description that belongs to this parameter is reached.
    for _ in range(64):
        value = cstring_at(shaders, offset)
        offset += len(value) + 1
        if not value or value.startswith('$'):
            continue
        if re.match(r'^-?[0-9.]+$', value):
            default = default or value
            continue
        if ' ' in value:
            description = value
            break
    decal_parameters.append({'name': name, 'default': default, 'description': description})
assert decal_parameters[0]['default'] == '0.4', decal_parameters[0]
assert decal_parameters[0]['description'] == 'exponent to tweak fog fade', decal_parameters[0]
assert decal_parameters[1]['description'] == 'scale to tweak fog fade', decal_parameters[1]
# The two fade bounds state no default of their own and share one description run, in the same
# order as their names, so the run is read once and paired by position.
tail = []
offset = shaders.index(b'$FOGFADESTART\0')
while len(tail) < 2:
    value = cstring_at(shaders, offset)
    offset += len(value) + 1
    if value and not value.startswith('$') and ' ' in value:
        tail.append(value)
assert tail[0] == 'fog amount at which to start fading decal', tail
assert tail[1] == 'fog amount at which to end fading decal', tail
decal_parameters[2]['description'] = tail[0]
decal_parameters[3]['description'] = tail[1]

# Which shipped materials state a fog fade, and what they state.
spec = importlib.util.spec_from_file_location('mapinv', ROOT / 'scripts/inventory-source-map.py')
mapinv = importlib.util.module_from_spec(spec)
sys.modules['mapinv'] = mapinv
spec.loader.exec_module(mapinv)
vpk = mapinv.VPKIndex(ASSETS / 'csgo/pak01_dir.vpk')
fog_materials = {}
for name in vpk.entries:
    if not name.startswith('materials/'):
        continue
    raw = vpk.read(name)
    if re.search(rb'fogfade', raw, re.I):
        text = raw.decode('latin-1')
        values = sorted({line.strip() for line in text.splitlines() if 'fogfade' in line.lower()})
        fog_materials[name] = values
assert len(fog_materials) == 14, sorted(fog_materials)
assert fog_materials['materials/decals/decals_bulletsheet.vmt'] == ['$fogfadeend 0.5'], \
    fog_materials['materials/decals/decals_bulletsheet.vmt']
assert all(values == ['$fogfadeend 0.5'] for values in fog_materials.values()), fog_materials

result = {
    'format': 'source-decal-pool-v1',
    'binaries': counts,
    'rDecals': {'name': 'r_decals', 'default': default_before_name, 'nameAt': hex(NAME_AT),
                'defaultAt': hex(start), 'binary': 'bin/linux64/engine_client.so',
                'sha256': hashlib.sha256(engine).hexdigest()},
    'engineWording': {'debugFormat': cstring_at(engine, DEBUG_FORMAT), 'at': hex(DEBUG_FORMAT),
                      'noSlot': cstring_at(engine, NO_SLOT), 'noSlotAt': hex(NO_SLOT)},
    'decalShaderFogFade': {
        'shader': 'DecalModulate', 'flags': ['bHasFogFade = FOGFADE', 'nLightingPreviewMode = LIGHTING_PREVIEW'],
        'flagTableAt': hex(DECAL_PARAMETER_BLOCK), 'parameters': decal_parameters,
        'note': 'The shader spells the parameters in upper case and the materials in lower case; the '
                'engine matches them ignoring case, the same way the texture scroll proxy does.',
    },
    'fogFadeMaterials': fog_materials,
    'reading': 'The installed build states 2048 as the default for r_decals, counts its decals as permanent '
               'plus dynamic, recycles a slot when the pool is full, and states no decal fade convar at all. '
               'The fade decals have is a fog fade, stated by the DecalModulate shader through a FOGFADE '
               'static flag and four parameters, and every one of the 14 materials that use it - including '
               'the bullet decal sheet this build draws from - states exactly $fogfadeend 0.5.',
    'boundary': 'The pool number is the shipped default rather than a measurement of the original running: how '
                'it divides 2048 between permanent and dynamic decals, and the order it recycles slots in, are '
                'not read, so this build keeps its own budget and oldest-first recycling and says so. The fog '
                'fade\'s own arithmetic has not been read off the DecalModulate program yet, and it would not '
                'show on the map this build ships, whose fog is disabled; it is recorded here as the next step '
                'rather than implemented from the parameter names.',
}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(result, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
print('r_decals default', default_before_name, 'at', hex(NAME_AT), '(string at', hex(start), ')')
print('debug wording', result['engineWording']['debugFormat'].strip())
print('decal parameters', [(row['name'], row['default']) for row in decal_parameters])
print('materials stating a fog fade', len(fog_materials),
      sorted(fog_materials)[:2], '...', 'bulletsheet:', fog_materials['materials/decals/decals_bulletsheet.vmt'])
print('wrote', OUT.relative_to(ROOT))
