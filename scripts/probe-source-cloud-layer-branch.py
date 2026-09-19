"""Which of the shipped UnlitTwoTexture branches the Dust2 cloud layer is drawn by.

Dust2's cloud layer is an `unlittwotexture` material with `$translucent 1`, `$alpha .35`
and a second texture (`$texture2`). The installed shader ships ten static combos, and only
some of them draw two textures. This reads, straight out of the installed build, the facts
that decide which combo that material's own flags select:

  * The shader's static flags, in table order, are `TRANSLUCENT`, `LIGHTING_PREVIEW` and
    `CUSTOM_MODE` - three flags, not two. The `.data.rel.ro` table that describes them
    (`{const char *m_pDefine; int m_nValue; int m_nField}`, 16 bytes per record, ended by a
    null define) carries `(TRANSLUCENT, 0, 1)`, `(LIGHTING_PREVIEW, 0, 2)`,
    `(CUSTOM_MODE, 0, 5)`; the shader's own debug print statement walks the same three in
    the same order, and its flag *names* (`bTranslucent`, `nLightingPreviewMode`,
    `nCustomMode`) appear in that order too. `TRANSLUCENT` is the one flag whose only two
    states are 0 and 1.
  * The shipped container holds exactly ten combos, and among the keys that leave exactly
    one flag set - the keys a material that declares only `$translucent 1` can land on -
    only `0x1` reads both samplers. `0x2` and `0x4` read none at all and write a constant
    colour, so no two-texture material can be drawn by them.
  * That combo's own program, per dynamic combo, is the product of the two textures and the
    per-material modulation: `r0 = tex0 * tex1`, `r0 = r0 * c1` (`g_DiffuseModulation`),
    `r0.rgb *= c30` (`cLightScale`), `oC0 = r0`. Its alpha is therefore the two textures'
    alphas times the modulation's, which is where `$alpha .35` enters. The three *fog*
    dynamic combos add fog arithmetic around the same product; the one dynamic combo with no
    fog arithmetic is the one a `$nofog 1` material gets.

What this does NOT establish, and therefore what a renderer may not assume: the runtime value
of `c30` (`cLightScale`). The program names it and multiplies rgb by it; nothing read here
supplies its value, so this build draws the product without that trailing factor and records
the gap rather than inventing a number.
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
ALPHA = ROOT / '.reference-assets/source-exports/dust2-foliage-audit/cloud-alpha'
VPK = ROOT / '.reference-assets/csgo-legacy/platform/platform_pak01_dir.vpk'
VCS_PATH = 'shaders/fxc/unlittwotexture_ps20b.vcs'
OUT = ROOT / 'research/source-cloud-layer-branch.json'


def module(name, filename, extra_argv=None):
    saved = sys.argv
    if extra_argv is not None:
        sys.argv = extra_argv
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    sys.argv = saved
    return value


encoding = module('cloud_branch_encoding', 'inspect-source-vhv-encoding.py')
index = module('cloud_branch_vpk', 'inventory-source-map.py')
data = SHADER.read_bytes()
assert data[:5] == b'\x7fELF\x02', 'the installed dx9 shader library is not where this probe expects'

# --- the three static flags, in table order ------------------------------------------------
BLOCK = b'bTranslucent\0TRANSLUCENT\0nCustomMode\0CUSTOM_MODE\0'
at = data.find(BLOCK)
assert at >= 0, 'the shader no longer states its static flags inline'
FLAGS_AT = at
pairs = [{'flag': 'bTranslucent', 'define': 'TRANSLUCENT'},
         {'flag': 'nLightingPreviewMode', 'define': 'LIGHTING_PREVIEW'},
         {'flag': 'nCustomMode', 'define': 'CUSTOM_MODE'}]
for pair in pairs:
    assert data.find(pair['flag'].encode() + b'\0') >= 0, pair
    assert data.find(pair['define'].encode() + b'\0') >= 0, pair

# Nothing in the binary takes the address of a flag *name*: the pairs above are a table the
# generated code walks, while the combo defines are loaded by address from real data tables.
references = {}
for pair in pairs:
    for key in (pair['flag'], pair['define']):
        address = data.find(key.encode() + b'\0')
        slot = struct.pack('<Q', address)
        references[key] = {'address': hex(address), 'pointerSlots': len(re.findall(re.escape(slot), data))}
assert references['bTranslucent']['pointerSlots'] == 0, references
assert references['nCustomMode']['pointerSlots'] == 0, references
assert references['TRANSLUCENT']['pointerSlots'] >= 5, references

# The static table itself: {const char *m_pDefine; int m_nValue; int m_nField} records in
# .data.rel.ro, ended by a null define. Read it as the build lays it out.
STATIC_TABLE = 0x151fc0
assert data[STATIC_TABLE - 16:STATIC_TABLE] == b'\0' * 16, 'the static table no longer starts where this probe expects'
table = []
for n in range(8):
    record = STATIC_TABLE + n * 16
    define_ptr = int.from_bytes(data[record:record + 8], 'little')
    if define_ptr == 0:
        break
    end = data.find(b'\0', define_ptr)
    define = data[define_ptr:end].decode()
    value, field = struct.unpack_from('<ii', data, record + 8)
    table.append({'define': define, 'value': value, 'field': field, 'at': hex(record)})
assert table == [{'define': 'TRANSLUCENT', 'value': 0, 'field': 1, 'at': hex(STATIC_TABLE)},
                 {'define': 'LIGHTING_PREVIEW', 'value': 0, 'field': 2, 'at': hex(STATIC_TABLE + 16)},
                 {'define': 'CUSTOM_MODE', 'value': 0, 'field': 5, 'at': hex(STATIC_TABLE + 32)}], table

# The shader's own debug statement walks the same three flags in the same order, and reads
# each flag's value from a different stack slot: that is a second, generated copy of the list.
def lea_target(at: int) -> int:
    """Resolve the RIP-relative `lea r64, [rip+disp32]` the build places at `at`."""
    assert data[at] in (0x48, 0x4C) and data[at + 1] == 0x8D and (data[at + 2] & 0xC7) == 0x05, hex(at)
    return at + 7 + struct.unpack_from('<i', data, at + 3)[0]


def lea_string(at: int) -> str:
    target = lea_target(at)
    return data[target:data.find(b'\0', target)].decode()


DEBUG_SITES = [(0xc21da, 'bTranslucent', 'TRANSLUCENT', '[rbp-0x78]'),
               (0xc2211, 'nLightingPreviewMode', 'LIGHTING_PREVIEW', '[rbp-0x88]'),
               (0xc2245, 'nCustomMode', 'CUSTOM_MODE', '[rbp-0x64]')]
debug_order = []
for site, name, define, slot in DEBUG_SITES:
    assert lea_string(site) == name, (hex(site), lea_string(site))
    assert lea_string(site + 7) == define, (hex(site + 7), lea_string(site + 7))
    debug_order.append({'flag': name, 'define': define, 'valueSlot': slot, 'at': hex(site),
                        'bytes': data[site:site + 14].hex()})
assert [row['flag'] for row in debug_order] == ['bTranslucent', 'nLightingPreviewMode', 'nCustomMode'], debug_order
assert [row['define'] for row in debug_order] == [row['define'] for row in table], debug_order

# --- the shipped combos ---------------------------------------------------------------------
vpk = index.VPKIndex(VPK)
raw = vpk.read(VCS_PATH)
version, total, dynamic_count, flags, centroid, count, crc = struct.unpack_from('<7I', raw)
assert (version, total, dynamic_count, count, crc) == (6, 144, 4, 11, 1071602020), \
    (version, total, dynamic_count, count, crc)
static_table = [struct.unpack_from('<2I', raw, 28 + 8 * i) for i in range(count)]
KEYS = [key for key, _ in static_table]
assert KEYS == [0x0, 0x1, 0x2, 0x4, 0x6, 0xc, 0xe, 0x12, 0x18, 0x1e, 0xffffffff], \
    [hex(key) for key in KEYS]

OPS = {1: 'mov', 2: 'add', 3: 'sub', 4: 'mad', 5: 'mul', 6: 'rcp', 7: 'rsq', 8: 'dp3', 9: 'dp4',
       10: 'min', 11: 'max', 14: 'exp2', 15: 'log2', 18: 'lrp', 31: 'dcl', 32: 'pow', 35: 'abs',
       40: 'if', 42: 'else', 43: 'endif', 66: 'texld', 81: 'def', 88: 'cmp', 90: 'dp2add'}


def tokens(code):
    """ps_2_b: the repo's own word walk, whose version token differs from ps_3_0."""
    words = struct.unpack('<%dI' % (len(code) // 4), code)
    assert words[0] == 0xffff0201, hex(words[0])
    result, offset = {}, 1
    while offset < len(words):
        op = words[offset] & 65535
        if op == 0xffff:
            break
        if op == 0xfffe:
            offset += 1 + ((words[offset] >> 16) & 0x7fff)
            continue
        length = (words[offset] >> 24) & 15
        result[offset] = words[offset:offset + length + 1]
        offset += length + 1
    return result


def text(code):
    rows = []
    for at, words in tokens(code).items():
        op = words[0] & 65535
        args = words[1:]
        if op == 81:
            operands = encoding.register(args[0], True) + ' ' + str(struct.unpack('<4f', struct.pack('<4I', *args[1:])))
        elif op == 31:
            operands = f'usage={args[0] & 15} index={(args[0] >> 16) & 15} ' + encoding.register(args[1], True)
        else:
            operands = (encoding.register(args[0], True) + ' ' + ', '.join(encoding.register(a) for a in args[1:])) if args else ''
        rows.append({'at': at, 'op': OPS.get(op, 'opcode_' + str(op)), 'operands': operands,
                     'tokens': [f'{v:08x}' for v in words]})
    return rows


combos = {}
for key in KEYS[:-1]:
    for dynamic in range(dynamic_count):
        code, report = encoding.vcs_combo(raw, key, dynamic)
        rows = text(code)
        loads = [row for row in rows if row['op'] == 'texld']
        samplers = sorted({int(row['tokens'][3], 16) & 2047 for row in rows if row['op'] == 'texld'})
        combos[f'{key:#x}/{dynamic}'] = {
            'static': key, 'dynamic': dynamic, 'programBytes': len(code),
            'programSha256': hashlib.sha256(code).hexdigest(),
            'textureLoads': len(loads), 'samplers': samplers,
            'usesFogConstants': any(f'c{register}' in row['operands'] for row in rows for register in (11, 12, 29)),
            'instructions': [f"{row['op']} {row['operands']}" for row in rows],
        }

# The keys a material that declares only `$translucent 1` can land on: exactly one flag set.
single_flag = [key for key in KEYS[:-1] if bin(key).count('1') == 1]
assert single_flag == [0x1, 0x2, 0x4], [hex(key) for key in single_flag]
drawing = {key: combos[f'{key:#x}/1']['textureLoads'] for key in single_flag}
assert drawing == {0x1: 2, 0x2: 0, 0x4: 0}, drawing
# The two alternatives a single-flag material could otherwise land on are constant colours,
# not two-texture programs: no two-texture material in the shipped content can be one of them.
assert combos['0x2/1']['instructions'] == ['def c0.xyzw (0.0, 0.0, 0.0, 1.0)', 'mov oc0.xyzw c0.xyzw'], \
    combos['0x2/1']['instructions']
assert combos['0x4/1']['instructions'][:2] == ['def c0.xyzw (0.0, 0.0, 0.0, 1.0)', 'def c1.xyzw (0.0, 0.0, 1.0, 1.0)'], \
    combos['0x4/1']['instructions']
assert not [line for line in combos['0x4/1']['instructions'] if line.startswith('texld')], \
    combos['0x4/1']['instructions']

# The combo the material lands on, and the no-fog dynamic combo it gets: the only shipped
# dynamic combo of that static with no fog arithmetic at all.
no_fog = [d for d in range(dynamic_count) if not combos[f'0x1/{d}']['usesFogConstants']]
assert no_fog == [1], no_fog
program = combos['0x1/1']['instructions']
assert program == [
    'dcl usage=0 index=0 a0.xy',
    'dcl usage=0 index=0 a1.xy',
    'dcl usage=0 index=0 s0.xyzw',
    'dcl usage=0 index=0 s1.xyzw',
    'texld r0.xyzw a0.xyzw, s0.xyzw',
    'texld r1.xyzw a1.xyzw, s1.xyzw',
    'mul r0.xyzw r0.xyzw, r1.xyzw',
    'mul r0.xyzw r0.xyzw, c1.xyzw',
    'mul r0.xyz r0.xyzw, c30.xxxx',
    'mov oc0.xyzw r0.xyzw',
], program
# The same branch in the other shipped static writes a constant alpha instead of the product.
assert combos['0x0/1']['instructions'][-4:] == [
    'mul r0.xyz r0.xyzw, c1.xyzw',
    'mul r0.xyz r0.xyzw, c30.xxxx',
    'mov r0.w c0.xxxx',
    'mov oc0.xyzw r0.xyzw',
], combos['0x0/1']['instructions']

# --- the constants both statics name, from each program's own constant table ----------------
REGISTER_SETS = {0: 'BOOL', 1: 'INT4', 2: 'FLOAT4', 3: 'SAMPLER2D'}


def constants_of(key: int, dynamic: int) -> list[dict]:
    code, _ = encoding.vcs_combo(raw, key, dynamic)
    at_ctab = code.find(b'CTAB')
    assert at_ctab >= 0, 'the program no longer carries its constant table'
    base = at_ctab + 4
    size, creator, cversion, ccount, info, cflags, target = struct.unpack_from('<7I', code, base)
    assert size == 28 and cversion == 0xFFFF0201, (size, hex(cversion))
    rows = []
    for i in range(ccount):
        name_at, register_set, register_index, register_count, _, _, _ = struct.unpack_from(
            '<IHHHHII', code, base + info + i * 20)
        end = code.index(b'\0', base + name_at)
        rows.append({'name': code[base + name_at:end].decode(), 'set': REGISTER_SETS.get(register_set, register_set),
                     'register': register_index, 'count': register_count})
    return rows


# The pixel-fog dynamic combo names every constant the static can reach; the no-fog one names
# only the two it reads. Both statics name the same set, so the branch does not change them.
constants = {f'{key:#x}': constants_of(key, 0) for key in (0x0, 0x1)}
assert constants['0x0'] == constants['0x1'], 'the two statics no longer name the same constants'
by_register = {row['register']: row['name'] for row in constants['0x1'] if row['set'] == 'FLOAT4'}
assert by_register == {30: 'cLightScale', 1: 'g_DiffuseModulation', 11: 'g_EyePos_SpecExponent',
                       12: 'g_FogParams', 29: 'g_LinearFogColor'}, by_register
sampler_names = {row['register']: row['name'] for row in constants['0x1'] if row['set'] == 'SAMPLER2D'}
assert sampler_names == {0: 'BaseTextureSampler', 1: 'BaseTextureSampler2'}, sampler_names
no_fog_constants = constants_of(0x1, 1)
assert {(row['set'], row['register']) for row in no_fog_constants} == {('FLOAT4', 30), ('FLOAT4', 1),
                                                                      ('SAMPLER2D', 0), ('SAMPLER2D', 1)}, \
    no_fog_constants

result = {
    'format': 'source-cloud-layer-branch-v1',
    'shader': {'path': str(SHADER.relative_to(ROOT)), 'sha256': hashlib.sha256(data).hexdigest()},
    'container': {'path': VCS_PATH, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw),
                  'staticKeys': [hex(key) for key in KEYS], 'dynamicCombos': dynamic_count,
                  'sourceCRC32': f'{crc:08x}'},
    'staticFlags': {'inlineTableAt': hex(FLAGS_AT), 'order': pairs, 'pointerSlots': references,
                    'dataRelRoTable': table, 'debugWalkOrder': debug_order},
    'combos': combos,
    'singleFlagKeys': [hex(key) for key in single_flag],
    'textureLoadsPerSingleFlagKey': {f'{key:#x}': loads for key, loads in drawing.items()},
    'cloudCombo': {'static': '0x1', 'dynamic': no_fog[0], 'program': program,
                   'constants': by_register, 'samplers': sampler_names},
    'reading': 'A material that declares only $translucent 1 sets one flag, so it draws one of the shipped '
               'combos that leave exactly one flag set: 0x1, 0x2 or 0x4. Of those, only 0x1 reads both '
               'samplers, and its own program is tex0 * tex1 * c1 with rgb scaled by c30. The material\'s '
               'alpha is therefore tex0.a * tex1.a * c1.a, and c1 is g_DiffuseModulation, the register the '
               'engine uploads the material\'s own colour and alpha into - which is where $alpha .35 enters.',
    'boundary': 'The runtime value of c30 (cLightScale) is not read here, so this build draws the product '
                'without that trailing factor and records the gap. The mapping from c1 to the material\'s '
                '$alpha is the modulation register\'s role, not a value read out of this build.',
}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(result, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
print('static flags', [row['define'] for row in table], 'keys', [hex(key) for key in KEYS])
print('single-flag keys and their texture loads', {hex(k): v for k, v in drawing.items()})
print('cloud combo static 0x1 dynamic', no_fog[0])
for line in program:
    print('   ', line)
print('wrote', OUT.relative_to(ROOT))
