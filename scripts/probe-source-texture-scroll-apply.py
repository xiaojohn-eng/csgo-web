"""Read what the installed TextureScroll material proxy actually writes.

`material/proxies/texturescroll` is the proxy the second Dust2 sky layer uses, and nothing
in the shipped material files says what it composes from its keys. This reads it out of the
installed client's own code instead of inferring it from the key names:

  * `CTextureScrollMaterialProxy::Init` reads `textureScrollVar` (default the empty string,
    so a material that names no variable leaves the proxy a no-op), `textureScrollRate`
    (default 1), `textureScrollAngle` (default 0) and `textureScale` (default 1). KeyValues
    lookups ignore case in the engine, which is why the material file spells them
    `texturescrollvar` and friends and still matches.
  * `CTextureScrollMaterialProxy::OnBind` converts the angle to radians with the shipped
    double pi/180, takes that angle's sine and cosine through `sincos`, multiplies each by
    the rate and by `curtime`, keeps the fractional part of each, and writes a 4x4 matrix
    through the material variable's `SetMatrixValue` slot:
        [ scale 0 0 fu ; 0 scale 0 fv ; 0 0 1 0 ; 0 0 0 1 ] with
        fu = frac(curtime * rate * cos(angle)), fv = frac(curtime * rate * sin(angle))
    A variable whose type is not a matrix is given the two offsets as a vector instead.

Every anchor below is an exact byte sequence or constant at an exact address in the
installed client, and the call to `sincos` is confirmed by the relocation the loader applies
to it. This is a reading of the code, not the engine executing the proxy; it also does not
say which of the shader's two alpha branches the cloud material selects.

Run: python3 scripts/probe-source-texture-scroll-apply.py
"""
from __future__ import annotations
from pathlib import Path
import hashlib
import json
import struct

ROOT = Path(__file__).resolve().parents[1]
CLIENT = ROOT / '.reference-assets/csgo-legacy/csgo/bin/client_client.so'
OUT = ROOT / 'research/source-texture-scroll-apply.json'
data = CLIENT.read_bytes()
assert data[:5] == b'\x7fELF\x01', 'the installed 32-bit client is not where this probe expects'

# The first PT_LOAD starts at offset zero, so file offsets and run addresses are the same
# numbers everywhere this probe reads; this is what keeps that true.
e_phoff = struct.unpack_from('<I', data, 28)[0]
e_phentsize, e_phnum = struct.unpack_from('<HH', data, 42)
loads = [struct.unpack_from('<8I', data, e_phoff + i * e_phentsize) for i in range(e_phnum)]
first = next(segment for segment in loads if segment[0] == 1)
assert first[1] == 0 and first[2] == 0, 'the installed client no longer loads its first segment at zero'


def expect(address: int, hex_bytes: str, label: str) -> None:
    wanted = bytes.fromhex(hex_bytes)
    actual = data[address:address + len(wanted)]
    assert actual == wanted, f'{label} at {address:#x}: {actual.hex(" ")} != {hex_bytes}'


def cstring(address: int) -> str:
    end = data.index(b'\0', address)
    return data[address:end].decode('ascii')


def u32(address: int) -> int:
    return struct.unpack_from('<I', data, address)[0]


def double_at(address: int) -> float:
    return struct.unpack_from('<d', data, address)[0]


def float_at(address: int) -> float:
    return struct.unpack_from('<f', data, address)[0]


# ------------------------------------------------------------ the class, its name, its keys
CLASS_NAME_AT = 0x10ef51a
PROXY_NAME_AT = 0x10ef50a
assert cstring(CLASS_NAME_AT) == 'CTextureScrollMaterialProxy'
assert cstring(PROXY_NAME_AT) == 'TextureScroll', 'the proxy name the material files use'
KEY_VAR, KEY_RATE, KEY_ANGLE, KEY_SCALE = 0x109d63c, 0x10ef4d8, 0x10ef4ea, 0x10ef4fd
assert cstring(KEY_VAR) == 'textureScrollVar'
assert cstring(KEY_RATE) == 'textureScrollRate'
assert cstring(KEY_ANGLE) == 'textureScrollAngle'
assert cstring(KEY_SCALE) == 'textureScale'
# The var name's own default is the empty string, so a material that names no variable
# leaves the proxy with nothing to write and OnBind returns before touching anything.
VAR_DEFAULT_AT = 0x1049fa6
assert cstring(VAR_DEFAULT_AT) == '', repr(cstring(VAR_DEFAULT_AT))

# ------------------------------------------------------------------------------ Init reads
INIT_AT = 0xbba230
# `mov [esp+8], <empty default>` and `mov [esp+4], <textureScrollVar>`.
expect(0xbba247, 'c7442408' + 'a69f0401', 'Init var default')
expect(0xbba24f, 'c7442404' + '3cd60901', 'Init var key')
FLOAT_READS = [
    ('textureScrollRate', 0xbba2ba, 'd8f40e01', 0xbba2b2, '0000803f', 1.0),
    ('textureScrollAngle', 0xbba2dd, 'eaf40e01', 0xbba2d5, '00000000', 0.0),
    ('textureScale', 0xbba303, 'fdf40e01', 0xbba2fb, '0000803f', 1.0),
]
float_reads = []
for name, key_at, key_bytes, default_at, default_bytes, default in FLOAT_READS:
    expect(key_at, 'c744240c' + key_bytes, f'Init {name} key')
    expect(default_at, 'c7442410' + default_bytes, f'Init {name} default')
    float_reads.append({'key': name, 'keyImmediateAt': hex(key_at), 'defaultImmediateAt': hex(default_at),
                        'default': default})

# ------------------------------------------------------------------------------- OnBind
ON_BIND_AT = 0xbba050
DEG_TO_RAD_AT = 0x10a0618
CURTIME_GLOBAL, CURTIME_FIELD = 0x1492c10, 0x10
ONE_FLOAT_AT = 0xf7fc5c
assert double_at(DEG_TO_RAD_AT) == 0.017453292519943295, double_at(DEG_TO_RAD_AT)
assert float_at(ONE_FLOAT_AT) == 1.0
# angle (float) -> double, then times the shipped pi/180 double.
expect(0xbba099, '0f5ac9', 'cvtps2pd of the angle')
expect(0xbba09c, 'f20f590d' + '18060a01', 'mulsd by pi/180')
# curtime: the client's own float global and the field inside it.
expect(0xbba094, 'a1' + '102c4901', 'load of the curtime global')
expect(0xbba0aa, 'f30f105010', 'curtime field read')
# sincos(radians, &sin, &cos): the file's placeholder displacement is replaced by a
# relocation, so the callee is read from the relocation rather than from these bytes.
expect(0xbba0c7, 'e8fcffffff', 'the call whose target the loader rewrites')
# The two offsets: cos * rate * curtime and rate * sin * curtime.
expect(0xbba0de, 'f20f59c8', 'cos * rate')
expect(0xbba0e2, 'f20f5945b0', 'rate * sin')
expect(0xbba0e7, 'f20f59ca', 'cos * rate * curtime')
expect(0xbba0eb, 'f20f59c2', 'rate * sin * curtime')
# The fractional part, and the branch that adds 1.0 for negative results.
expect(0xbba0ef, '0f57d2', 'zero for the sign compare')
expect(0xbba105, '7759', 'negative -> wrap branch')
expect(0xbba118, 'f30f5cca', 'subtract the truncated part (fractional part)')
expect(0xbba164, 'f30f580d5cfcf700', 'add the shipped 1.0 when wrapping')
# The variable's own type decides which write is used: type 7 is a matrix.
expect(0xbba123, '0fb6501c', 'the variable type byte')
expect(0xbba12b, '83e20f', 'mask the type')
expect(0xbba12e, '83fa07', 'compare against the matrix type')
expect(0xbba14c, 'ff5230', 'the vector write slot for a non-matrix variable')
# The matrix itself: scale on both diagonals, the two offsets in the last column of the
# first two rows, 1.0 on the homogeneous entries, and zero everywhere else.
expect(0xbba1a0, 'f30f10559c', 'the scale value')
MATRIX_STORES = [
    (0xbba1a5, 'c745bc00000000', 'm[0][1] 0'),
    (0xbba1b6, 'f30f1155b8', 'm[0][0] = scale'),
    (0xbba1bb, 'f30f114dc4', 'm[0][3] = u offset'),
    (0xbba1c7, 'f30f1155cc', 'm[1][1] = scale'),
    (0xbba1d3, 'f30f1145d4', 'm[1][3] = v offset'),
    (0xbba1e6, 'c745e00000803f', 'm[2][2] = 1.0'),
    (0xbba209, 'c745f40000803f', 'm[3][3] = 1.0'),
    (0xbba219, 'ff5250', 'SetMatrixValue slot'),
]
for address, hex_bytes, label in MATRIX_STORES:
    expect(address, hex_bytes, label)

# ------------------------------------------------------- the callee, from its own relocation
e_shoff = u32(32)
e_shentsize, e_shnum, e_shstrndx = struct.unpack_from('<HHH', data, 46)
sections = [struct.unpack_from('<10I', data, e_shoff + i * e_shentsize) for i in range(e_shnum)]
strings = sections[e_shstrndx]
section_names = []
for section in sections:
    start = strings[4] + section[0]
    section_names.append(data[start:data.index(b'\0', start)].decode('ascii', 'replace'))
CALL_FIELD_AT = 0xbba0c8
callee = None
for index, section in enumerate(sections):
    if section[1] not in (4, 9):          # SHT_REL / SHT_RELA
        continue
    symbols, strtab = sections[section[6]], sections[sections[section[6]][6]]
    for entry in range(section[5] // (section[9] or 8)):
        offset, info = struct.unpack_from('<II', data, section[4] + entry * (section[9] or 8))
        if offset != CALL_FIELD_AT:
            continue
        name_at = struct.unpack_from('<I', data, symbols[4] + (info >> 8) * 16)[0]
        end = data.index(b'\0', strtab[4] + name_at)
        callee = {'symbol': data[strtab[4] + name_at:end].decode('ascii', 'replace'),
                  'relativeType': info & 0xff, 'in': section_names[index]}
assert callee is not None and callee['symbol'] == 'sincos', callee

reading = {
    'class': cstring(CLASS_NAME_AT), 'classAt': hex(CLASS_NAME_AT), 'proxyName': cstring(PROXY_NAME_AT),
    'keys': {'textureScrollVar': hex(KEY_VAR), 'textureScrollRate': hex(KEY_RATE),
             'textureScrollAngle': hex(KEY_ANGLE), 'textureScale': hex(KEY_SCALE),
             'varDefault': {'value': cstring(VAR_DEFAULT_AT), 'at': hex(VAR_DEFAULT_AT)}},
    'note': 'KeyValues lookups ignore case, so the material files spell these keys '
            'texturescrollvar / texturescrollrate / texturescrollangle / texturescale and still match.',
    'init': {'at': hex(INIT_AT), 'floatReads': float_reads},
    'onBind': {
        'at': hex(ON_BIND_AT),
        'degreesToRadians': {'constant': double_at(DEG_TO_RAD_AT), 'at': hex(DEG_TO_RAD_AT)},
        'clock': {'global': hex(CURTIME_GLOBAL), 'field': hex(CURTIME_FIELD)},
        'sincos': {'callAt': hex(0xbba0c7), 'relocation': callee,
                   'argumentOrder': {'sinOut': 'ebp-0x50', 'cosOut': 'ebp-0x58',
                                     'note': 'the second pointer is the sine, the third the cosine'}},
        'offsets': {'u': 'frac(curtime * rate * cos(angleRadians))',
                    'v': 'frac(curtime * rate * sin(angleRadians))',
                    'wrap': {'one': float_at(ONE_FLOAT_AT), 'at': hex(ONE_FLOAT_AT)}},
        'matrix': {'layout': ['scale 0 0 u', '0 scale 0 v', '0 0 1 0', '0 0 0 1'],
                   'writeSlot': 'vtable +0x50 (SetMatrixValue)',
                   'typeCheck': {'mask': 0xf, 'matrixType': 7, 'at': hex(0xbba12e)},
                   'nonMatrixVariable': 'the two offsets are written as a vector through vtable +0x30'},
    },
    'boundary': 'Read from the installed client\'s own bytes, constants and relocation. The '
                'engine is not executed, so this is what the code does when the proxy binds '
                'rather than a rendered result; it does not say which of the cloud material\'s '
                'two shader alpha branches is selected, nor which parameter feeds that '
                'branch\'s c1.',
}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps({
    'format': 'source-texture-scroll-apply-v1',
    'client': {'path': str(CLIENT.relative_to(ROOT)), 'bytes': len(data),
               'sha256': hashlib.sha256(data).hexdigest()},
    'reading': reading,
}, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
print('class', reading['class'], 'proxy', reading['proxyName'])
print('var default', reading['keys']['varDefault'])
print('float reads', [(row['key'], row['default']) for row in float_reads])
print('sincos relocation', callee)
print('deg->rad', double_at(DEG_TO_RAD_AT))
print('wrote', OUT.relative_to(ROOT))
