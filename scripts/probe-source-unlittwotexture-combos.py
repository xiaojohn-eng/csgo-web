"""What the installed UnlitTwoTexture shader itself varies on, and what its two statics differ in.

Dust2's cloud layer is an `unlittwotexture` material with `$translucent 1` and `$alpha .35`,
and the installed pixel shader contains two branches whose final alpha differs (constant 1
against `texture0.a * texture1.a * external c1.a`). Which branch a material gets is chosen by
the shader's own static combo, so this reads what that combo is made of, straight out of the
installed `stdshader_dx9_client.so`:

  * The shader's static flags are stored as an inline table of flag-name/define-name pairs
    immediately before the shader's own names: `bTranslucent` + `TRANSLUCENT`, then
    `nCustomMode` + `CUSTOM_MODE`, then `unlittwotexture_ps20b` / `unlittwotexture_ps20`.
    The two strings of a pair are adjacent and the pairs are in table order, so the order is
    readable; the flag *names* are referenced by nothing else in the binary.
  * The engine's own combo-name table (the array of `{name, capability}` entries the whole
    build shares) carries `TRANSLUCENT` and `CUSTOM_MODE` entries as well, alongside
    `LIGHTING_PREVIEW`, `PIXELFOGTYPE` and `WRITE_DEPTH_TO_DESTALPHA`.
  * Both statics' programs name the same constants, and each program's own constant table
    gives their registers: `BaseTextureSampler` / `BaseTextureSampler2` are the two
    samplers, and register `c1` - the one the translucent static's alpha product reads - is
    `g_DiffuseModulation`.

What this does NOT establish, and therefore what a renderer may not assume: which bit of the
static index `bTranslucent` occupies. The two candidate flags' order is readable; the
composition of the index is not. Which combo the cloud material lands on is settled instead by
`scripts/probe-source-cloud-layer-branch.py`, and without needing the bit: a material declaring
only `$translucent 1` can only draw one of the shipped keys that leave exactly one flag set, and
of those only `0x1` reads both samplers.
"""
from __future__ import annotations
from pathlib import Path
import hashlib
import json
import re
import struct

ROOT = Path(__file__).resolve().parents[1]
SHADER = ROOT / '.reference-assets/csgo-legacy/bin/linux64/stdshader_dx9_client.so'
ALPHA = ROOT / '.reference-assets/source-exports/dust2-foliage-audit/cloud-alpha'
OUT = ROOT / 'research/source-unlittwotexture-combos.json'

data = SHADER.read_bytes()
assert data[:5] == b'\x7fELF\x02', 'the installed dx9 shader library is not where this probe expects'

# The inline static-flag table, in the order it is stored, right before the shader's names.
BLOCK = b'bTranslucent\0TRANSLUCENT\0nCustomMode\0CUSTOM_MODE\0'
at = data.find(BLOCK)
assert at >= 0, 'the shader no longer states its static flags inline'
FLAGS_AT = at
NAMES_AT = at + len(BLOCK)
assert data[NAMES_AT:NAMES_AT + len(b'unlittwotexture_ps20b\0')] == b'unlittwotexture_ps20b\0', \
    'the shader names no longer follow its static flag table'
SHADER_NAMES = re.findall(rb'unlittwotexture_(?:ps20b|ps20|vs20)', data[NAMES_AT:NAMES_AT + 128])
pairs = [{'flag': 'bTranslucent', 'define': 'TRANSLUCENT'}, {'flag': 'nCustomMode', 'define': 'CUSTOM_MODE'}]

# Nothing else in the binary points at the flag names: the pairs above are a table, not
# string constants the code loads by address.
references = {}
for name in ('bTranslucent', 'nCustomMode', 'TRANSLUCENT', 'CUSTOM_MODE'):
    address = data.find(name.encode() + b'\0')
    pattern = address.to_bytes(8, 'little')
    references[name] = {'address': hex(address),
                        'pointerSlots': len(re.findall(re.escape(pattern), data)),
                        'insideTheTable': address >= FLAGS_AT}

# The engine's shared combo-name table: {name pointer, capability word} entries.
CAPABILITY_AT = 0x151fc0
entries = []
for index in range(8):
    slot = CAPABILITY_AT + index * 16
    pointer = int.from_bytes(data[slot:slot + 8], 'little')
    # The table ends where the next slot is no longer a pointer into this file; an entry whose
    # name does not resolve is not one of the combo names.
    if not 0x1000 <= pointer < len(data):
        break
    end = data.find(b'\0', pointer)
    name = data[pointer:end]
    if not name or not all(32 <= byte < 127 for byte in name):
        break
    entries.append({'name': name.decode('ascii'),
                    'capability': int.from_bytes(data[slot + 12:slot + 16], 'little')})

# The two statics' own constant tables, read from each program: the CTAB comment chunk names
# every constant and states the register it occupies, which is what tells which one the
# translucent static's alpha product reads as c1.
REGISTER_SETS = {0: 'BOOL', 1: 'INT4', 2: 'FLOAT4', 3: 'SAMPLER2D'}
constants = {}
for static in (0, 1):
    program = (ALPHA / f'unlittwotexture-ps20b-static{static}-dynamic0.dx9').read_bytes()
    at = program.find(b'CTAB')
    assert at >= 0, 'the program no longer carries its constant table'
    base = at + 4
    size, creator, version, count, info, flags, target = struct.unpack_from('<7I', program, base)
    assert size == 28 and version == 0xFFFF0201, (size, hex(version))
    rows = []
    for index in range(count):
        name_at, register_set, register_index, register_count, _, _, _ = struct.unpack_from(
            '<IHHHHII', program, base + info + index * 20)
        end = program.index(b'\0', base + name_at)
        rows.append({'name': program[base + name_at:end].decode('ascii'),
                     'set': REGISTER_SETS.get(register_set, register_set),
                     'register': register_index, 'count': register_count})
    constants[str(static)] = rows
# The alpha product of the translucent static reads register c1; that constant is the
# engine's per-draw diffuse modulation, not a shader-specific parameter.
alpha_constant = next(row for row in constants['1']
                      if row['set'] == 'FLOAT4' and row['register'] == 1)
assert alpha_constant['name'] == 'g_DiffuseModulation', alpha_constant
assert constants['0'] == constants['1'], 'the two statics no longer name the same constants'
evidence = json.loads((ALPHA / 'evidence.json').read_text(encoding='utf-8'))
formulas = {row['static']: row['verifiedAlpha'] for row in evidence['programs']}
assert set(formulas) == {0, 1}, formulas

result = {
    'format': 'source-unlittwotexture-combos-v1',
    'shader': {'path': str(SHADER.relative_to(ROOT)), 'sha256': hashlib.sha256(data).hexdigest()},
    'staticFlags': {'at': hex(FLAGS_AT), 'pairs': pairs, 'orderReadFrom': 'the inline table itself',
                    'shaderNames': [name.decode() for name in SHADER_NAMES]},
    'flagNameReferences': references,
    'sharedComboTable': {'at': hex(CAPABILITY_AT), 'entries': entries},
    'constants': constants,
    'alphaProductConstant': {'register': 'c1', 'name': alpha_constant['name'],
                             'registerSet': alpha_constant['set']},
    'alphaBranches': formulas,
    'reading': 'The shader varies on exactly two static flags, a translucent flag and a custom-mode flag, '
               'and the cloud material sets $translucent 1. The static whose final alpha is '
               'texture0.a * texture1.a * c1.a reads c1 from the engine\'s own diffuse modulation; the other '
               'writes a constant alpha of 1.',
    'boundary': 'Which bit of the static index the translucent flag owns is NOT established here (the table '
                'order is readable, the index composition is not). The combo this build\'s cloud material draws '
                'is settled by scripts/probe-source-cloud-layer-branch.py, which needs no bit: of the shipped '
                'keys that leave exactly one flag set, only 0x1 reads both samplers.',
}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(result, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
print('static flag table at', hex(FLAGS_AT), pairs)
print('shader names after it', [name.decode() for name in SHADER_NAMES])
print('flag name pointer slots', {k: v['pointerSlots'] for k, v in references.items()})
print('shared combo entries', [(row['name'], row['capability']) for row in entries])
print('constants per static', constants)
print('alpha branches', formulas)
print('wrote', OUT.relative_to(ROOT))
