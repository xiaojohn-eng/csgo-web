"""The original's decal fog fade, read out of the shipped build rather than assumed.

Dust2's fog reaches the map's own cap (40%) over its own range, and the shipped `DecalModulate`
does not simply fog a bullet hole: it *fades the decal out* as the fog thickens, and tints what is
left toward the fog colour. This probe reads the whole of that behaviour out of the installed
build, so the port can draw it instead of recording it as a gap:

  * The shader's own parameter declarations, straight out of `stdshader_dx9_client.so`:
    `$FOGEXPONENT` states the default `0.4`, `$FOGSCALE` states `1.0` (as a deduplicated literal,
    so it is never next to the name - it is the string the declaring code loads), and the two fade
    bounds state no default at all, which is exactly why every shipped material that uses the fade
    states its own `$fogfadeend`.
  * The shipped `decalmodulate_ps20b` container: four static combos, each with two dynamic ones.
    `ps_2_b` tokens carry destination and source *modifiers*, which the repo's `ps_3_0` walker does
    not decode, and they matter here: the program saturates its fog ramp and its fade, and its
    `mov` to the output has no doubling modifier, so the doubling the port draws is a blend factor
    and not a shader instruction.
  * The program the fade lives in, instruction by instruction, with the register names the CTAB
    gives: `g_FogParams` (the ramp), `g_FogTweakParams` (the four fade parameters),
    `g_LinearFogColor`, `g_EyePos_SpecExponent` (the eye the fog distance is measured from) and the
    decal's own sampler. The two variants that matter - with and without the fade - are asserted in
    full, and so is the `VERTEXALPHA` variant that scales the texel by the vertex alpha, which is
    the identity on a decal quad that carries none.
  * Which shipped materials ask for the fade, and which atlas material each reachable decal names,
    because a `Subrect` decal inherits the fade from the material its `$Material` names.

What this does NOT establish, and therefore what a renderer may not assume: which *bit* of the
static combo key the engine sets for the fade. The container states four combos and the probe reads
which of them contains the fade arithmetic; the reading the port acts on is the material's own
numbers - a material that states `$fogfadeend` gets the fade, and one that states none cannot (its
fade would divide by zero). The content agrees: all fourteen materials that use the fade state it.
"""
from __future__ import annotations
from pathlib import Path
import hashlib
import importlib.util
import json
import re
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
SHADER = ROOT / '.reference-assets/csgo-legacy/bin/linux64/stdshader_dx9_client.so'
PLATFORM = ROOT / '.reference-assets/csgo-legacy/platform/platform_pak01_dir.vpk'
GAME = ROOT / '.reference-assets/csgo-legacy/csgo/pak01_dir.vpk'
IMPACT = ROOT / '.reference-assets/source-exports/impact/surface-props.json'
VCS_PATH = 'shaders/fxc/decalmodulate_ps20b.vcs'
OUT = ROOT / 'research/source-decal-fog-fade.json'

OPS = {1: 'mov', 2: 'add', 3: 'sub', 4: 'mad', 5: 'mul', 6: 'rcp', 7: 'rsq', 8: 'dp3', 9: 'dp4',
       10: 'min', 11: 'max', 14: 'exp2', 15: 'log2', 18: 'lrp', 31: 'dcl', 32: 'pow', 35: 'abs',
       40: 'if', 42: 'else', 43: 'endif', 66: 'texld', 81: 'def', 88: 'cmp', 90: 'dp2add'}
# The register file names Source's own CTAB uses, keyed the way the token encodes them.
KINDS = {0: 'r', 1: 'v', 2: 'c', 3: 'a', 5: 'rast', 6: 'attr', 7: 'o', 8: 'oc', 10: 's', 12: 's',
         13: 'b', 14: 'b', 15: 'loop'}
SRC_MOD = {0: '', 1: '-', 2: '_bias', 3: '-_bias', 4: '_bx2', 5: '-_bx2', 6: '1-', 7: '_x2',
           8: '-_x2', 9: '_dz', 10: '_dw', 11: '_abs', 12: '-_abs', 13: '_not'}
DEST_MOD = {0: '', 1: '_sat', 2: '_pp', 3: '_sat_pp'}


def module(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def cstring(data: bytes, offset: int) -> str | None:
    if not 0 <= offset < len(data):
        return None
    end = data.find(b'\0', offset)
    value = data[offset:end]
    return value.decode('ascii') if value and all(32 <= byte < 127 for byte in value) else None


shader = SHADER.read_bytes()
assert shader[:5] == b'\x7fELF\x02', 'the installed dx9 shader library is not where this probe expects'

# --------------------------------------------------------------------------- #
# what the shader states about its four fade parameters
# --------------------------------------------------------------------------- #
BLOCK = (b'bHasFogFade\0FOGFADE\0decalmodulate_ps20b\0decalmodulate_ps20\0'
         b'decalmodulate_vs30\0decalmodulate_ps30\0$FOGEXPONENT\0')
BLOCK_AT = shader.find(BLOCK)
assert BLOCK_AT >= 0, 'the shipped shader no longer declares the fade and its programs together'

# The code that builds the parameter table loads each name, its default and its description by
# address. Reading the loads rather than the string pool is what distinguishes a parameter that
# states no default from one whose default happens to sit elsewhere in the pool.
LEAS = {index: index + 7 + struct.unpack_from('<i', shader, index + 3)[0]
        for index in range(len(shader) - 7)
        if shader[index] in (0x48, 0x4C) and shader[index + 1] == 0x8D
        and (shader[index + 2] & 0xC7) == 0x05}
DECLARATIONS = {
    '$FOGEXPONENT': {'site': 0x2fd76, 'default': '0.4'},
    '$FOGSCALE': {'site': 0x2fdd9, 'default': '1.0'},
    '$FOGFADESTART': {'site': 0x2fe3c, 'default': None},
    '$FOGFADEEND': {'site': 0x2fe98, 'default': None},
}
parameters = []
for name, expected in DECLARATIONS.items():
    site = expected['site']
    assert LEAS.get(site) == shader.index(name.encode() + b'\0'), (name, hex(site))
    # Walk the loads this site makes: the name, then whatever the declaration passes next.
    loaded = [cstring(shader, LEAS[at]) for at in sorted(LEAS) if site <= at < site + 120]
    loaded = [value for value in loaded if value and not value.startswith('$')]
    default = loaded[0] if loaded and re.fullmatch(r'-?[0-9.]+', loaded[0]) else None
    description = next((value for value in loaded if ' ' in value), None)
    assert default == expected['default'], (name, default)
    if expected['default'] is None:
        # No default means the declaration passes no literal for it at all, in either order.
        assert not any(re.fullmatch(r'-?[0-9.]+', value) for value in loaded), (name, loaded)
    parameters.append({'name': name, 'default': default, 'description': description,
                       'declarationAt': hex(site),
                       'declarationBytes': shader[site:site + 24].hex(' ')})
assert [row['name'] for row in parameters] == list(DECLARATIONS), parameters
assert parameters[0]['description'] == 'exponent to tweak fog fade', parameters[0]
assert parameters[1]['description'] == 'scale to tweak fog fade', parameters[1]
assert parameters[2]['description'] == 'fog amount at which to start fading decal', parameters[2]
assert parameters[3]['description'] == 'fog amount at which to end fading decal', parameters[3]

# The static flags the shader declares beside those parameters, as the build lays them out:
# `{const char *m_pDefine; int m_nValue; int m_nField}` in .data.rel.ro, ended by a null define.
FLAG_TABLE_AT = 0x14a880
flags = []
for index in range(8):
    record = FLAG_TABLE_AT + index * 16
    pointer, value, field = struct.unpack_from('<Qii', shader, record)
    name = cstring(shader, pointer)
    if name is None:
        break
    flags.append({'define': name, 'value': value, 'field': field, 'at': hex(record)})
assert flags == [{'define': 'VERTEXALPHA', 'value': 0, 'field': 1, 'at': hex(FLAG_TABLE_AT)},
                 {'define': 'FOGFADE', 'value': 0, 'field': 1, 'at': hex(FLAG_TABLE_AT + 16)},
                 {'define': 'PIXELFOGTYPE', 'value': 0, 'field': 1, 'at': hex(FLAG_TABLE_AT + 32)}], flags
assert shader[FLAG_TABLE_AT - 16:FLAG_TABLE_AT] == b'\0' * 16, 'the flag table moved'

# --------------------------------------------------------------------------- #
# the shipped programs
# --------------------------------------------------------------------------- #
index = module('fog_fade_vpk', 'inventory-source-map.py')
encoding = module('fog_fade_encoding', 'inspect-source-vhv-encoding.py')
platform = index.VPKIndex(PLATFORM)
game = index.VPKIndex(GAME)
raw = platform.read(VCS_PATH)
version, total, dynamic_count, use_flags, centroid, count, crc = struct.unpack_from('<7I', raw)
assert (version, total, dynamic_count, count) == (6, 8, 2, 5), (version, total, dynamic_count, count)
statics = [struct.unpack_from('<2I', raw, 28 + 8 * entry)[0] for entry in range(count)]
assert statics == [0x0, 0x1, 0x2, 0x3, 0xffffffff], [hex(key) for key in statics]


def registers(value: int, dest: bool = False) -> str:
    kind = ((value >> 28) & 7) | ((value >> 8) & 24)
    name = KINDS.get(kind, 'register' + str(kind)) + str(value & 2047)
    if dest:
        mask = ''.join(letter for position, letter in enumerate('xyzw') if value & (1 << (16 + position)))
        return name + '.' + mask + DEST_MOD.get((value >> 20) & 15, '?_mod' + str((value >> 20) & 15))
    swizzle = ''.join('xyzw'[(value >> (16 + 2 * position)) & 3] for position in range(4))
    return SRC_MOD.get((value >> 24) & 15, '?_mod' + str((value >> 24) & 15)) + name + '.' + swizzle


def walk(code: bytes) -> list[dict]:
    """`ps_2_b`: the repo's own word walk, with the tokens kept as the evidence."""
    assert struct.unpack_from('<I', code, 0)[0] == 0xffff0201, hex(struct.unpack_from('<I', code, 0)[0])
    words = struct.unpack('<%dI' % (len(code) // 4), code)
    rows, offset = [], 1
    while offset < len(words):
        token = words[offset]
        op = token & 65535
        if op == 0xffff:
            break
        if op == 0xfffe:
            offset += 1 + ((token >> 16) & 0x7fff)
            continue
        length = (token >> 24) & 15
        args = words[offset + 1:offset + length + 1]
        if op == 81:
            body = registers(args[0], True) + ' ' + str(
                struct.unpack('<4f', struct.pack('<4I', *args[1:5])))
        elif op == 31:
            body = f'usage={args[0] & 15} index={(args[0] >> 16) & 15} ' + registers(args[1], True)
        else:
            body = (registers(args[0], True) + ', ' + ', '.join(registers(value) for value in args[1:])) \
                if args else ''
        rows.append({'at': offset, 'op': OPS.get(op, 'opcode_' + str(op)), 'operands': body,
                     'tokens': [f'{word:08x}' for word in words[offset:offset + length + 1]]})
        offset += length + 1
    return rows


def listing(rows: list[dict]) -> list[str]:
    return [f"{row['op']} {row['operands']}" for row in rows]


programs = {}
for key in statics[:-1]:
    for dynamic in range(dynamic_count):
        code, report = encoding.vcs_combo(raw, key, dynamic)
        rows = walk(code)
        programs[f'{key:#x}/{dynamic}'] = {
            'static': key, 'dynamic': dynamic, 'bytes': len(code),
            'sha256': digest(code), 'instructions': listing(rows)}
# The two named statics the four programs carry: the fade arithmetic is what separates them.
FADE = programs['0x2/0']
PLAIN = programs['0x0/0']
VERTEX = programs['0x1/1']
assert PLAIN['instructions'] == [
    'dcl usage=0 index=0 a0.xy', 'dcl usage=0 index=0 a1.xyz', 'dcl usage=0 index=0 s0.xyzw',
    'texld r0.xyzw, a0.xyzw, s0.xyzw',
    'add r1.xyz, -a1.xyzw, c11.xyzw',
    'dp3 r1.x, r1.xyzw, r1.xyzw',
    'rsq r1.x, r1.xxxx',
    'rcp r1.x, r1.xxxx',
    'mad r1.x_sat, r1.xxxx, c12.wwww, c12.xxxx',
    'min r2.w, r1.xxxx, c12.zzzz',
    'mul r1.x_sat, r2.wwww, c0.yyyy',
    'pow r2.x, r1.xxxx, c0.xxxx',
    'mul r1.x, r2.xxxx, r2.xxxx',
    'lrp r2.xyz, r1.xxxx, c29.xyzw, r0.xyzw',
    'mov r2.w, r0.wwww',
    'mov oc0.xyzw, r2.xyzw',
], PLAIN['instructions']
assert FADE['instructions'] == [
    'def c1.xyzw (0.5, 0.0, 0.0, 0.0)',
    'dcl usage=0 index=0 a0.xy', 'dcl usage=0 index=0 a1.xyz', 'dcl usage=0 index=0 s0.xyzw',
    'texld r0.xyzw, a0.xyzw, s0.xyzw',
    'add r1.xyz, -a1.xyzw, c11.xyzw',
    'dp3 r1.x, r1.xyzw, r1.xyzw',
    'rsq r1.x, r1.xxxx',
    'rcp r1.x, r1.xxxx',
    'mad r1.x_sat, r1.xxxx, c12.wwww, c12.xxxx',
    'min r2.w, r1.xxxx, c12.zzzz',
    'mul r1.x_sat, r2.wwww, c0.yyyy',
    'add r1.y, r2.wwww, -c0.zzzz',
    'pow r2.x, r1.xxxx, c0.xxxx',
    'mul r1.x, r2.xxxx, r2.xxxx',
    'add r1.z, -c0.zzzz, c0.wwww',
    'rcp r1.z, r1.zzzz',
    'mul r1.y_sat, r1.zzzz, r1.yyyy',
    'lrp r2.xyz, r1.yyyy, c1.xxxx, r0.xyzw',
    'lrp r0.xyz, r1.xxxx, c29.xyzw, r2.xyzw',
    'mov oc0.xyzw, r0.xyzw',
], FADE['instructions']
assert VERTEX['instructions'] == [
    'def c0.xyzw (-0.5, 0.5, 0.0, 0.0)',
    'dcl usage=0 index=0 a0.xy', 'dcl usage=0 index=0 v1.xyzw', 'dcl usage=0 index=0 s0.xyzw',
    'texld r0.xyzw, a0.xyzw, s0.xyzw',
    'add r1.xyz, r0.xyzw, c0.xxxx',
    'mad r0.xyz, v1.wwww, r1.xyzw, c0.yyyy',
    'mov oc0.xyzw, r0.xyzw',
], VERTEX['instructions']
# The doubling the port draws is not in the program: the one write to the output reads a plain
# register, and no instruction in any combo carries a doubling source modifier.
for program in programs.values():
    outputs = [line for line in program['instructions'] if 'oc0' in line]
    assert len(outputs) == 1, outputs
    assert re.fullmatch(r'mov oc0\.xyzw, r\d+\.[xyzw]+', outputs[0]), outputs[0]
    assert not any('_x2' in line for line in program['instructions']), program

# No sRGB decode hides in the fade program either: its one power takes the shader's own exponent,
# and nothing computes a logarithm, which is what a decode would need.
assert [line for line in FADE['instructions'] if line.startswith('pow')] == [
    'pow r2.x, r1.xxxx, c0.xxxx'], FADE['instructions']
assert not [line for line in FADE['instructions'] if line.startswith('log')], FADE['instructions']

# The names the CTAB gives the registers the fade program reads. They live in the program's own
# constant table, not in the shader library, so they are read out of the container above.
CTAB_NAMES = ['TexSampler', 'g_EyePos_SpecExponent', 'g_FogParams', 'g_FogTweakParams',
              'g_LinearFogColor']
code, report = encoding.vcs_combo(raw, 0x2, 0)
words = struct.unpack('<%dI' % (len(code) // 4), code)
comment = struct.pack('<%dI' % ((words[1] >> 16) & 0x7fff), *words[2:2 + ((words[1] >> 16) & 0x7fff)])
assert comment[:4] == b'CTAB' and b'ps_2_b\0' in comment
found = [name for name in CTAB_NAMES if comment.find(name.encode() + b'\0') >= 0]
assert found == CTAB_NAMES, found

# --------------------------------------------------------------------------- #
# which materials ask for the fade
# --------------------------------------------------------------------------- #
export = json.loads(IMPACT.read_text())
reachable = sorted({entry['material'] for row in export['impact'].values() for entry in row['decals']})
assert reachable, 'the impact export names no decal'
atlases = {}
for material in reachable:
    row = export['decalMaterials'][material]
    atlases.setdefault(row['atlas'], []).append(material)
assert sorted(atlases) == ['decals/decals_bulletsheet', 'decals/decals_mod2x'], sorted(atlases)

fade_atlases = {}
STATED = re.compile(r'"?\$?(fogfade(?:start|end)|fogscale|fogexponent)"?\s+"?([0-9.]+)"?', re.IGNORECASE)
for atlas in sorted(atlases):
    text = game.read('materials/' + atlas + '.vmt').decode('utf-8')
    shader_name = text.lstrip().split()[0]
    assert shader_name == 'DecalModulate', (atlas, shader_name)
    fade_atlases[atlas] = {'shader': shader_name,
                           'stated': {key.lower(): float(value) for key, value in STATED.findall(text)},
                           'materials': len(atlases[atlas])}
# The sheet the port draws most of its marks from asks for the fade; the other does not ask at all,
# which is the difference the port has to draw.
assert fade_atlases['decals/decals_bulletsheet']['stated'] == {'fogfadeend': 0.5}, fade_atlases
assert fade_atlases['decals/decals_mod2x']['stated'] == {}, fade_atlases

# Whether the sheet reaches the multiply decoded or as stored. Both sheets carry the sRGB flag,
# which is worth recording because it is *not* what the program does: DX9 has no sRGB sampler
# decode for the DXT formats these sheets ship as, and the fade program contains no conversion of
# its own - its only power is the fog exponent the shader declares. So the texel the program
# multiplies is the stored one.
VTF_FLAGS = {0x1: 'pointsample', 0x2: 'trilinear', 0x4: 'clamps', 0x8: 'clampt', 0x10: 'anisotropic',
             0x20: 'hint_dxt5', 0x40: 'sRGB', 0x80: 'normal', 0x100: 'nomip', 0x200: 'nolod'}
sheets = {}
for atlas in sorted(atlases):
    path = 'materials/' + atlas + '.vtf'
    assert path in game.entries, path
    sheet_flags = struct.unpack_from('<I', game.read(path)[:16], 12)[0]
    sheets[atlas] = {'path': path, 'flags': f'{sheet_flags:#010x}',
                     'named': [name for bit, name in VTF_FLAGS.items() if sheet_flags & bit]}
    assert 'sRGB' in sheets[atlas]['named'], sheets[atlas]

with_fade = []
for name in sorted(game.entries):
    if not name.startswith('materials/decals/') or not name.endswith('.vmt'):
        continue
    text = game.read(name).decode('utf-8', 'replace')
    if 'fogfade' in text.lower():
        with_fade.append({'material': name,
                          'stated': {key.lower(): float(value) for key, value in STATED.findall(text)}})
assert len(with_fade) == 14, len(with_fade)
assert all(row['stated'] == {'fogfadeend': 0.5} for row in with_fade), with_fade
assert 'materials/decals/decals_bulletsheet.vmt' in {row['material'] for row in with_fade}

report = {
    'format': 'source-decal-fog-fade-v1',
    'shader': {'path': str(SHADER.relative_to(ROOT)), 'sha256': digest(shader),
               'flagTableAt': hex(FLAG_TABLE_AT), 'flags': flags,
               'parameterBlockAt': hex(BLOCK_AT), 'parameters': parameters},
    'container': {'path': VCS_PATH,
                  'sha256': digest(raw), 'statics': [hex(key) for key in statics[:-1]],
                  'dynamicCombos': dynamic_count, 'programs': programs},
    'ctabNames': CTAB_NAMES,
    'formula': {
        'eyeToFragment': 'c11.xyz - worldPosition.xyz',
        'fogAmount': 'min(saturate(distance * g_FogParams.w + g_FogParams.x), g_FogParams.z)',
        'tint': '(saturate(fogAmount * $FOGSCALE) ^ $FOGEXPONENT) ^ 2',
        'fade': 'saturate((fogAmount - $FOGFADESTART) / ($FOGFADEEND - $FOGFADESTART))',
        'shaded': 'mix(mix(texel, 0.5, fade), g_LinearFogColor, tint)',
        'written': 'the shaded texel, blended as destination * source, so the doubling is the '
                   'blend and not an instruction',
    },
    'fadeMaterials': with_fade,
    'reachableAtlases': fade_atlases,
    'sources': {'sheets': sheets},
    'reading': 'The shipped DecalModulate fades a decal out of the fog rather than only tinting it: '
               'the fade lerps the texel toward the neutral 0.5 the atlas is authored around, so a '
               'decal returns the surface untouched instead of turning into a grey patch, and the '
               'fade is saturated. Its tint is the fog amount scaled, raised to the shader\'s own '
               'exponent and squared, and the fog amount is the same capped ramp the map states for '
               'the whole scene, measured as the distance from the eye - not the depth along the '
               'view axis. `$FOGSCALE` defaults to 1.0 and the two fade bounds default to nothing, '
               'which is why every shipped material that uses the fade states its own end value.',
    'boundary': 'The engine\'s static combo key was not read: the container states four combos and '
                'the probe reads which of them holds the fade arithmetic, so the port keys the fade '
                'off the material\'s own stated bound - the value the arithmetic requires - rather '
                'than off a bit it has not proved. The `VERTEXALPHA` variant scales the texel by the '
                'vertex alpha and is the identity on a decal quad that carries none, which is what '
                'this port draws. The port\'s own bullet decals name two atlas materials, and only '
                'one of them - the bullet sheet - states a fade bound.',
}
OUT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
print(f'parameters: ' + ', '.join(
    f'{row["name"]}={row["default"]!r}' for row in parameters))
print(f'flags: ' + ', '.join(row['define'] for row in flags))
print(f'statics: {[hex(key) for key in statics[:-1]]} with {dynamic_count} dynamics each')
for key in ('0x0/0', '0x0/1', '0x1/1', '0x2/0'):
    print(f'  {key} {programs[key]["bytes"]:>4} bytes {programs[key]["sha256"][:16]} '
          f'{len(programs[key]["instructions"])} instructions')
print(f'materials stating a fade: {len(with_fade)}, all {with_fade[0]["stated"]}')
for atlas, row in fade_atlases.items():
    print(f'  atlas {atlas}: {row["materials"]} reachable decals, stated {row["stated"]}')
for atlas, row in sheets.items():
    print(f'  sheet {atlas}: {row["flags"]} ({", ".join(row["named"])})')
print('wrote', OUT.relative_to(ROOT))
