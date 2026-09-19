"""The original's projected shadow, read out of the shipped build rather than assumed.

Dust2 declares no `env_cascade_light`, so on this map the original casts no shadow along the sun.
What every actor gets instead is the `shadow_control` entity's *projected* shadow, and this probe
reads that whole channel out of the installed build so the port can draw it instead of recording it
as a gap:

  * the entity's client class. The 64-bit client carries one run of member names -
    `m_shadowColor`, `m_flShadowMaxDist`, `m_bDisableShadows`, `m_bEnableLocalLightShadows` - with
    `DT_ShadowControl` and `CShadowControl` immediately after them. There is **no direction
    member**, which is why the map's own `angles 90 43 0` is not a coincidence: every projected
    shadow in the game points straight down. The server's copy carries the same four members with
    the map's key `disableallshadows` in the same run, which is what ties the entity the map writes
    to the client that draws it, and it carries the inputs the key drives
    (`SetDistance`, `SetShadowsDisabled`, `SetShadowsFromLocalLightsEnabled`).

  * the two shipped programs, out of the platform VPK:
    - `shadowmodel_ps20` puts the shadow on the receiver as **`1 + coverage * (modulation - 1)`**.
      The program states `def c0.xyzw (-1.0, 1.0, 0.0, 0.0)`, then
      `add r0.xyz, v0.xyzw, c0.xxxx` / `mad r0.xyz, a0.wwww, r0.xyzw, c0.yyyy`, which is
      `modulation - 1` scaled by the coverage carried in `a0.w` and added to `1`; the alpha is then
      set to `1` and written straight out.
    - `shadowbuildtexture_ps20b` builds the silhouette the first program reads: the model's own
      texture alpha times its vertex alpha (`mul r0.w, r0.wwww, v0.wwww`), with the colour forced
      to white (`mov r0.xyz, c0.xxxx` under `def c0.xyzw (1.0, 0.0, 0.0, 0.0)`).

  * the map's own numbers, which the environment probe already read out of the frozen BSP and this
    one re-asserts against `research/source-environment.json`: colour `128 128 128`, `distance` 72
    units, shadows enabled, and `angles 90 43 0`. Seventy-two units at the map's own 0.0254 m per
    unit is the 1.8288 m of reach the port uses.

What this does NOT establish, and therefore what a renderer may not assume: the engine's own
projection plane and the height fade it applies per entity are set at runtime and are in neither of
these programs, so the port places the silhouette on the first surface below the caster and does not
fade with height. The `shadow_control` entity carries no member for a second direction either, so
straight down is the whole of it rather than a simplification.
"""
from __future__ import annotations
from pathlib import Path
import hashlib
import importlib.util
import json
import re
import struct

ROOT = Path(__file__).resolve().parents[1]
INSTALL = ROOT / '.reference-assets/csgo-legacy'
CLIENT64 = INSTALL / 'csgo/bin/linux64/client_client.so'
SERVER64 = INSTALL / 'csgo/bin/linux64/server_client.so'
PLATFORM = INSTALL / 'platform/platform_pak01_dir.vpk'
ENVIRONMENT = ROOT / 'research/source-environment.json'
OUT = ROOT / 'research/source-projected-shadows.json'

METRES_PER_UNIT = 0.0254
# The entity's members, in the order the shipped client lays the names out. The whole run is read,
# so a member added beside them (a direction, say) fails this probe rather than being missed.
CONTROL_MEMBERS = ['m_shadowColor', 'm_flShadowMaxDist', 'm_bDisableShadows',
                   'm_bEnableLocalLightShadows']
CONTROL_CLASSES = ['DT_ShadowControl', 'CShadowControl']
# Members of the base entity that would be a direction if the class had one.
DIRECTION_MEMBERS = ['m_vDirection', 'm_angRotation', 'm_angAbsRotation', 'm_flPitch', 'm_vecOrigin']
CONTROL_KEY = 'disableallshadows'
CONTROL_INPUTS = ['SetDistance', 'SetShadowsDisabled', 'SetShadowsFromLocalLightsEnabled']
MODELLING = 'shaders/fxc/shadowmodel_ps20.vcs'
BUILDING = 'shaders/fxc/shadowbuildtexture_ps20b.vcs'

OPS = {1: 'mov', 2: 'add', 3: 'sub', 4: 'mad', 5: 'mul', 6: 'rcp', 7: 'rsq', 8: 'dp3', 9: 'dp4',
       10: 'min', 11: 'max', 14: 'exp2', 15: 'log2', 18: 'lrp', 31: 'dcl', 32: 'pow', 35: 'abs',
       40: 'if', 42: 'else', 43: 'endif', 64: 'texcoord', 65: 'texkill', 66: 'texld', 81: 'def',
       88: 'cmp', 90: 'dp2add'}
KINDS = {0: 'r', 1: 'v', 2: 'c', 3: 'a', 5: 'rast', 6: 'attr', 7: 'o', 8: 'oc', 10: 's', 12: 's',
         13: 'b', 14: 'b', 15: 'loop'}
SRC_MOD = {0: '', 1: '-', 2: '_bias', 3: '-_bias', 4: '_bx2', 5: '-_bx2', 6: '1-', 7: '_x2',
           8: '-_x2', 9: '_dz', 10: '_dw', 11: '_abs', 12: '-_abs', 13: '_not'}
DEST_MOD = {0: '', 1: '_sat', 2: '_pp', 3: '_sat_pp'}
digest = lambda data: hashlib.sha256(data).hexdigest()  # noqa: E731


def module(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def runs(data: bytes, start: int, length: int) -> list[str]:
    """The printable runs in a window: member names sit in one string pool with padding between."""
    return [match.group().decode('latin1')
            for match in re.finditer(rb'[\x20-\x7e]{2,}', data[start:start + length])]


def registers(value: int, dest: bool = False) -> str:
    kind = ((value >> 28) & 7) | ((value >> 8) & 24)
    name = KINDS.get(kind, 'register' + str(kind)) + str(value & 2047)
    if dest:
        mask = ''.join(letter for position, letter in enumerate('xyzw') if value & (1 << (16 + position)))
        return name + '.' + mask + DEST_MOD.get((value >> 20) & 15, '?_mod' + str((value >> 20) & 15))
    swizzle = ''.join('xyzw'[(value >> (16 + 2 * position)) & 3] for position in range(4))
    return SRC_MOD.get((value >> 24) & 15, '?_mod' + str((value >> 24) & 15)) + name + '.' + swizzle


def walk(code: bytes) -> list[dict]:
    """`ps_2_0`: the repo's own word walk, with the tokens kept as the evidence."""
    header = struct.unpack_from('<I', code, 0)[0]
    assert header in (0xffff0200, 0xffff0201), hex(header)
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


# --------------------------------------------------------------------------- #
# the entity the map writes, and the client that draws it
# --------------------------------------------------------------------------- #
client64 = CLIENT64.read_bytes()
server64 = SERVER64.read_bytes()

members_at = client64.index(b'm_shadowColor\0')
client_run = runs(client64, members_at, 0x80)
assert client_run[:len(CONTROL_MEMBERS)] == CONTROL_MEMBERS, client_run
assert CONTROL_CLASSES[0] in client_run and CONTROL_CLASSES[1] in client_run, client_run
for forbidden in DIRECTION_MEMBERS:
    assert not any(name.startswith(forbidden) for name in client_run), \
        f'shadow_control now nets {forbidden}; the class has to be re-read'
assert not any('Direction' in name or 'Rotation' in name for name in client_run), client_run

server_at = server64.index(b'm_shadowColor\0')
server_run = runs(server64, server_at, 0x120)
assert server_run[:len(CONTROL_MEMBERS)] == CONTROL_MEMBERS, server_run
assert CONTROL_CLASSES[0] in server_run, server_run
# The map's own key sits in the same run, with the inputs it drives.
assert CONTROL_KEY in server_run, server_run
assert all(len([name for name in server_run if name == value]) == 1 for value in CONTROL_INPUTS), \
    (CONTROL_INPUTS, server_run)
assert server_run.index(CONTROL_KEY) < server_run.index(CONTROL_INPUTS[0]), server_run

# --------------------------------------------------------------------------- #
# the shipped programs
# --------------------------------------------------------------------------- #
index = module('shadow_vpk', 'inventory-source-map.py')
encoding = module('shadow_encoding', 'inspect-source-vhv-encoding.py')
platform = index.VPKIndex(PLATFORM)


def container(path: str) -> dict:
    raw = platform.read(path)
    version, total, dynamic_count, use_flags, centroid, count, crc = struct.unpack_from('<7I', raw)
    assert version == 6, (path, version)
    statics = [struct.unpack_from('<2I', raw, 28 + 8 * entry)[0] for entry in range(count)]
    assert statics == [0x0, 0xffffffff], [hex(key) for key in statics]
    programs = {}
    for key in statics[:-1]:
        for dynamic in range(dynamic_count):
            code, _ = encoding.vcs_combo(raw, key, dynamic)
            rows = walk(code)
            programs[f'{key:#x}/{dynamic}'] = {
                'static': key, 'dynamic': dynamic, 'bytes': len(code), 'sha256': digest(code),
                'instructions': listing(rows),
                'tokens': [row['tokens'] for row in rows]}
    return {'path': path, 'sha256': digest(raw), 'bytes': len(raw),
            'statics': [hex(key) for key in statics], 'dynamicCombos': dynamic_count,
            'programs': programs}


modelling = container(MODELLING)
building = container(BUILDING)

# `1 + coverage * (modulation - 1)`: the constant declaration, the two instructions that use it,
# and the alpha that follows.
shadow = modelling['programs']['0x0/0']
assert shadow['instructions'][0] == 'def c0.xyzw (-1.0, 1.0, 0.0, 0.0)', shadow['instructions'][0]
assert shadow['instructions'][-4:] == [
    'add r0.xyz, v0.xyzw, c0.xxxx',
    'mad r0.xyz, a0.wwww, r0.xyzw, c0.yyyy',
    'mov r0.w, c0.yyyy',
    'mov oc0.xyzw, r0.xyzw'], shadow['instructions']
expression = 'oc0.rgb = 1 + a0.w * (v0.rgb - 1); oc0.a = 1'
# The `-1.0` and the `1.0` the expression uses are named by the program's own `def`, and the operand
# that scales it is the coverage while the operand it is scaled from is the modulation colour - so
# the expression is the program's arithmetic, not a reading of a parameter's name.
assert shadow['instructions'][0].endswith('(-1.0, 1.0, 0.0, 0.0)'), shadow['instructions'][0]
assert 'a0.wwww' in shadow['instructions'][-3] and 'v0.xyzw' in shadow['instructions'][-4]

# The silhouette that expression reads: the model's own alpha times its vertex alpha, as white.
silhouette = building['programs']['0x0/0']
assert silhouette['instructions'] == [
    'def c0.xyzw (1.0, 0.0, 0.0, 0.0)',
    'dcl usage=0 index=0 a0.xy',
    'dcl usage=0 index=0 v0.xyzw',
    'dcl usage=0 index=0 s0.xyzw',
    'texld r0.xyzw, a0.xyzw, s0.xyzw',
    'mul r0.w, r0.wwww, v0.wwww',
    'mov r0.xyz, c0.xxxx',
    'mov oc0.xyzw, r0.xyzw'], silhouette['instructions']
assert silhouette['instructions'][5].endswith('v0.wwww'), 'the vertex alpha must be a factor'

# --------------------------------------------------------------------------- #
# the map's own numbers
# --------------------------------------------------------------------------- #
environment = json.loads(ENVIRONMENT.read_text())
control = environment['shadowControl']
assert control['color'] == [128, 128, 128], control
assert control['distance'] == 72.0 and control['disableAllShadows'] is False, control
assert control['sourceAngles'] == [90.0, 43.0, 0.0], control
assert environment['metersPerSourceUnit'] == METRES_PER_UNIT, environment['metersPerSourceUnit']

report = {
    'format': 'source-projected-shadows-v1',
    'entity': {
        'classes': CONTROL_CLASSES,
        'members': CONTROL_MEMBERS,
        'key': CONTROL_KEY,
        'inputs': CONTROL_INPUTS,
        'namesAt': hex(members_at),
        'noDirectionMember': True,
        'meaning': ('The client that draws a projected shadow nets only the colour, the reach, an '
                    'on/off switch and a switch for local-light shadows. It carries no direction at '
                    'all, so the direction is straight down for every one of them - which is what the '
                    'map\'s own `angles 90 43 0` states.'),
    },
    'sources': {'client64Sha256': digest(client64), 'server64Sha256': digest(server64),
                'environmentSha256': digest(ENVIRONMENT.read_bytes()),
                'sourceBspSha256': environment['sourceBspSha256']},
    'map': {'color': control['color'], 'sourceDistance': control['distance'],
            'disableAllShadows': control['disableAllShadows'],
            'sourceAngles': control['sourceAngles'], 'metresPerSourceUnit': METRES_PER_UNIT,
            'reachMetres': control['distance'] * METRES_PER_UNIT},
    'programs': {'model': modelling, 'build': building},
    'expression': expression,
    'silhouette': 'white, alpha = the model texture alpha times the vertex alpha',
    'reading': ('The original gives every actor the `shadow_control` entity\'s projected shadow on '
                'this map: a silhouette of that actor, built white with its own alpha, multiplied '
                'onto the receiver as `1 + coverage * (modulation - 1)` with the map\'s colour, '
                'straight down, over the map\'s own 72 units of reach. The port draws exactly that.'),
    'boundary': ('The engine sets the projection plane and the height fade per entity at runtime; '
                 'neither is in these programs and neither was read, so the port places the '
                 'silhouette on the first surface below the caster and does not fade with height. '
                 'The entity also carries no member for a second direction, so straight down is the '
                 'whole of it and not a simplification.'),
}
OUT.write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n')
print(json.dumps({'format': report['format'], 'members': CONTROL_MEMBERS, 'classes': CONTROL_CLASSES,
                  'clientRun': client_run[:6], 'serverRun': server_run[:9], 'expression': expression,
                  'map': report['map'], 'modelPrograms': sorted(modelling['programs']),
                  'buildPrograms': sorted(building['programs'])}, ensure_ascii=False, indent=1))
