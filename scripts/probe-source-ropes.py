"""Dust2's ropes, read out of the shipped map and the shipped build.

The map hangs 142 ropes (`keyframe_rope` chains and `move_rope` movers), and the port draws none of
them: its converter is invoked with `load_ropes=False`. They are not decoration the port may skip -
they are geometry the map states - so this probe reads them, and reads what draws them, before any
renderer touches them:

  * the entities, twice over: the frozen BSP's own entity lump, parsed here, and the reviewed
    SourceIO export the other tables were generated from (it lowercases every key, so the
    comparison is case-insensitive). Every rope's own numbers are asserted: all 142 name the same
    `cable/nuke_cable`, all 142 state `Subdiv 2`, `Type 0`, `TextureScale 1` and no dangling,
    collision, breakable or barbed flag, while `Width` and `Slack` vary and 120 of them name the
    next rope in their chain.

  * the class the client draws them with. `DT_RopeKeyframe` in the 64-bit client nets sixteen
    members, and the table is read whole - each name with the offset the client stores it at and
    the type it is sent as - so the port knows what the map's keys become on the client rather
    than assuming. `m_Width`, `m_Subdiv`, `m_TextureScale`, `m_Slack` and `m_RopeLength` are all
    in it, and so is `m_RopeFlags`.

  * what the shipped build says about drawing and simulating one: `CRopeKeyframe::DrawModel`,
    `CRopeManager::DrawRenderCache` and `CRopeKeyframe::CalculateEndPointAttachment` are the
    client's own method names for it, `CPhysicsDelegate::ApplyConstraints` is the solver's, the
    solver is `CRopePhysics<10>` (ten passes), the rope's own material chain starts at
    `cable/cable` with `cable/rope_shadowdepth` for the depth-writing pass and
    `missing_rope_material` when a material is absent, and the client carries the rope's own
    convars with their defaults.

What this does NOT establish, and therefore what a renderer may not assume: the *rules* that turn
the map's keys into the client's numbers, and the shape of the rope. The server-side `KeyValue`
handlers that read `Slack`, `NextKey` and `MoveSpeed` (they are in `server_client.so`, beside the
`CRopeKeyframe` name) have not been read, so which endpoint of a chained rope is which, and what
`Slack` is a percentage of, are open; neither have the client's integration constants (gravity and
damping) nor the vertex/width construction `DrawModel` performs. This probe stages the map's own
numbers and stops there.
"""
from __future__ import annotations
from pathlib import Path
import collections
import hashlib
import json
import re
import struct

ROOT = Path(__file__).resolve().parents[1]
INSTALL = ROOT / '.reference-assets/csgo-legacy'
BSP = INSTALL / 'csgo/maps/de_dust2.bsp'
EXPORT = ROOT / '.reference-assets/source-exports/dust2/source-metadata/entities.json'
CLIENT64 = INSTALL / 'csgo/bin/linux64/client_client.so'
SERVER64 = INSTALL / 'csgo/bin/linux64/server_client.so'
OUT = ROOT / 'research/source-ropes.json'
BSP_SHA = 'b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc'
METRES_PER_UNIT = 0.0254
sha = lambda data: hashlib.sha256(data).hexdigest()  # noqa: E731

ROPE_CLASSES = ('move_rope', 'keyframe_rope')
# The sixteen members the client nets for a rope, in table order, with the offset it stores each
# at and the type it is sent as (4 = int/float, 2 = short, 1 = bool, 0xc = vector).
MEMBERS = [
    ('m_nChangeCount', 0x12bc, 4),
    ('m_iRopeMaterialModelIndex', 0xfa4, 4),
    ('m_hStartPoint', 0x129c, 4),
    ('m_hEndPoint', 0x12a0, 4),
    ('m_iStartAttachment', 0x12a4, 2),
    ('m_iEndAttachment', 0x12a6, 2),
    ('m_fLockedPoints', 0x12b8, 4),
    ('m_Slack', 0x12b0, 4),
    ('m_RopeLength', 0x12ac, 4),
    ('m_RopeFlags', 0xfa0, 4),
    ('m_TextureScale', 0x12b4, 4),
    ('m_nSegments', 0x1298, 4),
    ('m_bConstrainBetweenEndpoints', 0x1350, 1),
    ('m_Subdiv', 0x12a8, 4),
    ('m_Width', 0x12c0, 4),
    ('m_flScrollSpeed', 0xf9c, 4),
]
MATERIALS = ['cable/cable', 'cable/rope_shadowdepth', 'missing_rope_material']
METHODS = ['C_RopeKeyframe::DrawModel', 'CRopeManager::DrawRenderCache',
           'C_RopeKeyframe::CalculateEndPointAttachment', 'CPhysicsDelegate::ApplyConstraints']
CONVARS = ['rope_shake', 'rope_subdiv', 'rope_collide', 'rope_smooth', 'rope_smooth_enlarge',
           'rope_smooth_minwidth', 'rope_smooth_minalpha', 'rope_smooth_maxalphawidth',
           'rope_smooth_maxalpha', 'r_drawropes', 'r_ropetranslucent', 'rope_wind_dist',
           'rope_averagelight', 'rope_rendersolid', 'rope_solid_minwidth', 'rope_solid_maxwidth',
           'rope_solid_minalpha', 'rope_solid_maxalpha', 'r_queued_ropes',
           'r_rope_holiday_light_scale', 'r_ropes_holiday_lights_type']
# The material flags the client's rope material chain names, and the proc it adds for the
# depth-writing pass.
MATERIAL_FLAGS = ['$no_fullbright', '$alphatest', '$nocull', '__DepthWrite01']


def lump(data: bytes, index: int) -> bytes:
    at, size, version, compressed = struct.unpack_from('<4i', data, 8 + index * 16)
    if not (0 <= at <= at + size <= len(data)) or compressed:
        raise ValueError(f'lump {index} is not an inline readable lump')
    return data[at:at + size]


def blocks(text: str) -> list[str]:
    """Every top-level `{...}` in an entity lump, quoted strings respected."""
    spans, index = [], 0
    while True:
        start = text.find('{', index)
        if start < 0:
            return spans
        depth, cursor = 0, start
        while True:
            char = text[cursor]
            if char == '"':
                cursor = text.find('"', cursor + 1) + 1
            elif char == '{':
                depth += 1
            elif char == '}':
                depth -= 1
                if depth == 0:
                    break
            cursor += 1
        spans.append(text[start:cursor + 1])
        index = cursor + 1


def pairs(block: str) -> dict:
    return dict(re.findall(r'"([^"]+)"\s+"([^"]+)"', block))


# --------------------------------------------------------------------------- #
# the map's own ropes, read twice
# --------------------------------------------------------------------------- #
raw = BSP.read_bytes()
assert sha(raw) == BSP_SHA, 'the frozen BSP is not the one this probe was written against'
text = lump(raw, 0).decode('latin1')
from_bsp = [pairs(block) for block in blocks(text) if pairs(block).get('classname') in ROPE_CLASSES]
from_export = [row for row in json.loads(EXPORT.read_text())
               if row.get('classname') in ROPE_CLASSES]
assert len(from_bsp) == len(from_export) == 142, (len(from_bsp), len(from_export))

# Case-insensitively, both readers say the same thing about every rope.
assert [row['classname'] for row in from_bsp] == [row['classname'] for row in from_export]
for left, right in zip(from_bsp, from_export):
    lowered = {key.lower(): value for key, value in left.items()}
    for key, value in right.items():
        assert lowered.get(key) == value, (key, lowered.get(key), value)

classes = collections.Counter(row['classname'] for row in from_bsp)
assert classes == {'keyframe_rope': 109, 'move_rope': 33}, classes
materials = collections.Counter(row['RopeMaterial'] for row in from_bsp)
assert materials == {'cable/nuke_cable': 142}, materials
for key, value in (('Subdiv', '2'), ('Type', '0'), ('TextureScale', '1'), ('Dangling', '0'),
                   ('Collide', '0'), ('Breakable', '0'), ('Barbed', '0'), ('spawnflags', '0')):
    assert {row[key] for row in from_bsp} == {value}, (key, {row[key] for row in from_bsp})
segments = [row for row in from_bsp if row['classname'] == 'keyframe_rope']
movers = [row for row in from_bsp if row['classname'] == 'move_rope']
named = [row for row in from_bsp if 'NextKey' in row]
# A chain is a mover naming the next rope, then segments naming the next one; a segment that
# nothing names is the tail of its chain, so it states no next key.
assert len(segments) == 109 and len(movers) == 33
assert all('targetname' in row for row in segments), 'every segment says what it is called'
assert all('targetname' not in row for row in movers), 'a mover starts a chain rather than joining one'
assert len(named) == 120 == len(movers) + len([row for row in segments if 'NextKey' in row])
targets = {row['targetname'] for row in segments}
linked = {row['NextKey'] for row in named}
assert linked <= targets, sorted(linked - targets)
# Every segment is named as some rope's next key; twenty-two of them name no next key of their own,
# which is fewer than the thirty-three movers that start a chain, so eleven ropes share a next key
# and the chains are not one straight run per mover. Which of these readings the engine builds a
# rope from is the server's rule, and it is not read - see the boundary.
assert len(targets) == 109 and len([row for row in segments if 'NextKey' not in row]) == 22
assert len(named) - len(linked) == 11, len(named) - len(linked)
ropes = [{'hammerId': row.get('hammerid'), 'classname': row['classname'],
          'origin': [float(v) for v in row['origin'].split()],
          'angles': [float(v) for v in row.get('angles', '0 0 0').split()],
          'material': row['RopeMaterial'], 'width': float(row['Width']),
          'slack': int(row['Slack']), 'subdiv': int(row['Subdiv']), 'type': int(row['Type']),
          'textureScale': float(row['TextureScale']), 'moveSpeed': float(row['MoveSpeed']),
          'targetname': row.get('targetname'), 'nextKey': row.get('NextKey'),
          'positionInterpolator': row.get('PositionInterpolator')} for row in from_bsp]

# --------------------------------------------------------------------------- #
# what the map's own links say the rope network is
#
# The map states the links and nothing else, so what a rope *is* can be read off them: a rope that
# names a next key hangs between its own origin and that rope's origin, and a rope nothing names as
# its next is where a chain ends. Following every mover's chain settles both, and the counts that
# come out are asserted rather than assumed - including the eleven links that two ropes share.
# --------------------------------------------------------------------------- #
origins = {row['hammerId']: row['origin'] for row in ropes}
byname = {row['targetname']: row for row in ropes if row['targetname']}
spans = [row for row in ropes if row['nextKey']]
ends = [row for row in ropes if not row['nextKey']]
shared = {key: count for key, count in collections.Counter(
    row['nextKey'] for row in spans).items() if count > 1}
assert len(spans) == 120 and len(ends) == 22, (len(spans), len(ends))
assert len(shared) == 8 and sum(count - 1 for count in shared.values()) == 11, shared


def metres(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5 * METRES_PER_UNIT


chains, hops, reached = [], [], set()
for mover in [row for row in ropes if row['classname'] == 'move_rope']:
    walked, seen = [mover], set()
    while walked[-1]['nextKey'] and walked[-1]['nextKey'] not in seen:
        seen.add(walked[-1]['nextKey'])
        walked.append(byname[walked[-1]['nextKey']])
    chains.append(walked)
    reached.update(row['hammerId'] for row in walked)
    hops.extend(metres(origins[walked[index]['hammerId']],
                       origins[walked[index + 1]['hammerId']])
                for index in range(len(walked) - 1))
assert len(chains) == 33 and len(reached) == 142, (len(chains), len(reached))
# The chains overlap: they walk 148 hops between them but only 142 ropes are distinct, because a
# run of segments is reached from more than one of the movers (the same thing the eleven shared
# links in the map's own data say).
assert len(hops) == 148, len(hops)
assert sum(len(chain) for chain in chains) == 181, sum(len(chain) for chain in chains)
assert max(len(chain) for chain in chains) == 9, max(len(chain) for chain in chains)
assert all(chain[-1]['hammerId'] in {row['hammerId'] for row in ends} for chain in chains)
hops.sort()
structure = {'spans': len(spans), 'ends': len(ends), 'chains': len(chains),
             'ropesReached': len(reached), 'hopsWalked': len(hops),
             'chainRopes': sum(len(chain) for chain in chains),
             'sharedLinks': len(shared),
             'sharedLinksExtra': sum(count - 1 for count in shared.values()),
             'longestChain': max(len(chain) for chain in chains),
             'hopMetres': {'min': round(hops[0], 3), 'median': round(hops[len(hops) // 2], 3),
                           'max': round(hops[-1], 3)},
             'reading': ('A rope that names a next key hangs from its own origin to that rope\'s '
                         'origin; a rope nothing names as its next ends a chain. Following the '
                         'movers that way reaches all 142 ropes, in 33 chains that overlap - they '
                         'walk 181 ropes between them, and the eleven links two ropes share are what '
                         'makes the ends fewer than the movers.')}

# --------------------------------------------------------------------------- #
# the class the client draws them with
# --------------------------------------------------------------------------- #
client64 = CLIENT64.read_bytes()
server64 = SERVER64.read_bytes()
with open(CLIENT64, 'rb') as handle:
    from elftools.elf.elffile import ELFFile
    elf = ELFFile(handle)
    text_section = [s for s in elf.iter_sections() if s.name == '.text'][0]
    base, offset, size = text_section['sh_addr'], text_section['sh_offset'], text_section['sh_size']
    sections = [(s['sh_addr'], s['sh_addr'] + s['sh_size'], s['sh_offset'], s.name)
                for s in elf.iter_sections() if s['sh_addr'] and s['sh_size']]
body = client64[offset:offset + size]
with open(SERVER64, 'rb') as handle:
    server_elf = ELFFile(handle)
    server_text = [s for s in server_elf.iter_sections() if s.name == '.text'][0]
    server_base, server_offset = server_text['sh_addr'], server_text['sh_offset']
    server_sections = [(s['sh_addr'], s['sh_addr'] + s['sh_size'], s['sh_offset'], s.name)
                       for s in server_elf.iter_sections() if s['sh_addr'] and s['sh_size']]
server_body = server64[server_offset:server_offset + server_text['sh_size']]


def cstring_in(data: bytes, table: list, vaddr: int) -> str | None:
    for start, end, at, _ in table:
        if start <= vaddr < end:
            stop = data.find(b'\x00', at + (vaddr - start))
            run = data[at + (vaddr - start):stop]
            return run.decode('latin1') if run and all(32 <= c < 127 for c in run) else None
    return None


def offset_of(data: bytes, table: list, vaddr: int) -> int:
    for start, end, at, _ in table:
        if start <= vaddr < end:
            return at + (vaddr - start)
    raise ValueError(f'{vaddr:#x} is not in a loaded section')


def cstring(vaddr: int) -> str | None:
    for start, end, at, _ in sections:
        if start <= vaddr < end:
            stop = client64.find(b'\x00', at + (vaddr - start))
            run = client64[at + (vaddr - start):stop]
            return run.decode('latin1') if run and all(32 <= c < 127 for c in run) else None
    return None


def lea_sites() -> dict:
    found = {}
    for index in range(len(body) - 7):
        if body[index] != 0x8D or (body[index + 1] & 0xC7) != 0x05:
            continue
        prefix = body[index - 1] if index else 0
        length = 7 if 0x40 <= prefix <= 0x4F else 6
        address = base + index - (1 if length == 7 else 0)
        disp = int.from_bytes(body[index + 2:index + 6], 'little', signed=True)
        found.setdefault(address + length + disp, []).append(address)
    return found


sites = lea_sites()
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
disassembler = Cs(CS_ARCH_X86, CS_MODE_64)


def window(address: int, length: int = 0x60):
    at = offset + (address - base)
    return list(disassembler.disasm(client64[at:at + length], address))


def window_in(data: bytes, text_offset: int, text_base: int, address: int,
              length: int = 0x60):
    at = text_offset + (address - text_base)
    return list(disassembler.disasm(data[at:at + length], address))


# The table is built by one `RecvTable_Init` over `DT_RopeKeyframe`; the members follow it as a
# run of registration calls, each handed a name, an offset and a type - in whatever order the
# compiler scheduled them, so the triple is taken between one call and the next.
table_at = sites[client64.index(b'DT_RopeKeyframe\0') + 0][0]
rows = []
pending = {'name': None, 'offset': None, 'type': None}
for instruction in window(table_at, 0x400):
    if instruction.mnemonic == 'lea' and instruction.op_str.startswith('rsi, ') \
            and 'rip + ' in instruction.op_str:
        disp = int(instruction.op_str.split('rip + ')[1].split(']')[0], 16)
        pending['name'] = cstring(instruction.address + instruction.size + disp)
    elif instruction.mnemonic == 'mov' and instruction.op_str.startswith('ecx, '):
        pending['type'] = int(instruction.op_str.split(', ')[1], 16)
    elif instruction.mnemonic == 'mov' and instruction.op_str.startswith('edx, '):
        pending['offset'] = int(instruction.op_str.split(', ')[1], 16)
    elif instruction.mnemonic == 'call':
        if pending['name'] and pending['name'].startswith('m_') and pending['offset'] is not None:
            rows.append((pending['name'], pending['offset'], pending['type']))
        pending = {'name': None, 'offset': None, 'type': None}
assert [row[0] for row in rows][:len(MEMBERS)] == [name for name, _, _ in MEMBERS], rows[:20]
for index, (name, at, kind) in enumerate(MEMBERS):
    assert rows[index] == (name, at, kind), (rows[index], (name, at, kind))

# The materials, the flags, the convars and the method names the class carries, in one block of
# the client's read-only data: it spans the class's netvar names through its last convar. The
# map's own key `RopeMaterial` is *not* in this block - the client has no such string, because the
# key is parsed server-side, which is where the boundary below says the rules still are.
block_lo = client64.index(b'm_iRopeMaterialModelIndex\0')
block_hi = client64.index(b'r_ropes_holiday_max_dist_to_draw\0', block_lo)
assert block_lo < block_hi
rope_block = client64[block_lo:block_hi]
for value in MATERIALS + METHODS + MATERIAL_FLAGS + CONVARS + ['CRopePhysicsILi10EE',
                                                               'IRopeManager', 'CRopeManager',
                                                               'C_RopeKeyframe']:
    assert value.encode() in rope_block or value.encode() in client64, value
# Ten solver passes, and the two defaults that sit among the rope's own convars.
assert b'12CRopePhysicsILi10EE' in client64, 'the rope solver is no longer a ten-pass CRopePhysics'
defaults = [text_ for text_ in (b'1.75', b'0.14')]
for value in defaults:
    assert value in rope_block, value

# Each rope convar is registered with its name in `rsi`, its default in `rdx` and - where it has
# one - its help text in `r8`, all loaded next to the name, in whichever order the compiler
# scheduled them. The default is read from its own register rather than from the name.
registrations = {}
for name in CONVARS:
    at = client64.find(name.encode() + b'\x00')
    assert at >= 0, name
    for site in sites.get(at, []):
        default = help_text = None
        for instruction in window(site - 0x30, 0x60):
            if instruction.mnemonic != 'lea' or 'rip + ' not in instruction.op_str:
                continue
            register = instruction.op_str.split(', ')[0]
            disp = int(instruction.op_str.split('rip + ')[1].split(']')[0], 16)
            value = cstring(instruction.address + instruction.size + disp)
            if not value:
                continue
            if register == 'r8' and ' ' in value and instruction.address < site:
                # The help text is loaded before the name; one loaded after it belongs to the next
                # convar in the block.
                help_text = value
            elif register in ('rdx', 'rsi') and re.fullmatch(r'-?[0-9.]+', value) \
                    and default is None:
                default = value
        if default is not None:
            registrations[name] = {'default': default, 'help': help_text}
            break
assert len(registrations) == len(CONVARS), sorted(set(CONVARS) - set(registrations))
assert registrations['rope_smooth_enlarge']['default'] == '1.4', registrations['rope_smooth_enlarge']
assert registrations['rope_smooth_minwidth']['default'] == '0.3', registrations['rope_smooth_minwidth']
assert registrations['rope_subdiv']['default'] == '2', registrations['rope_subdiv']
assert registrations['rope_collide']['default'] == '1', registrations['rope_collide']
assert registrations['r_drawropes']['default'] == '1', registrations['r_drawropes']
assert registrations['r_rope_holiday_light_scale']['default'] == '0.14', \
    registrations['r_rope_holiday_light_scale']
assert registrations['rope_smooth_enlarge']['help'].startswith('How much to enlarge'), \
    registrations['rope_smooth_enlarge']
assert registrations['rope_smooth']['help'] == 'Do an antialiasing effect on ropes', \
    registrations['rope_smooth']

# The server carries the same class name and the keys the map writes, which is where the rules
# that turn them into those numbers live, and it carries the rule for the material: `RopeMaterial`
# is resolved as written (plus `.vmt`), and a rope with no material takes one of three shader
# defaults instead.
SERVER_KEYS = ['RopeMaterial', 'RopeShader', 'Slack', 'Subdiv', 'NextKey', 'MoveSpeed', 'Type',
               'Dangling', 'Barbed', 'UseWind', 'Width', 'TextureScale']
SERVER_MATERIALS = ['cable/cable.vmt', 'cable/rope.vmt', 'cable/chain.vmt']
for value in SERVER_KEYS + SERVER_MATERIALS + ['.vmt', 'CRopeKeyframe']:
    assert server64.find(value.encode()) >= 0, value

# The numbers the client's rope code is built around, read where they sit rather than from a name.
GRAVITY_AT = 0x19358c0


def rodata_float(vaddr: int) -> float:
    for start, end, at, _ in sections:
        if start <= vaddr < end:
            return struct.unpack_from('<f', client64, at + (vaddr - start))[0]
    raise ValueError(f'{vaddr:#x} is not in a loaded section')


gravity = rodata_float(GRAVITY_AT)
assert gravity == -1293.0, gravity
for value in (b'Other textures', b'cable/rope_shadowdepth'):
    assert client64.find(value) >= 0, value


def client_call_target(address: int) -> int:
    at = offset + (address - base)
    assert client64[at] == 0xe8, hex(address)
    return address + 5 + struct.unpack_from('<i', client64, at + 1)[0]


for address, expected, what in (
        # The rope's init clamps its own segment count into 2..10 and stores it back.
        (0x85d98b, '8b8398120000', 'mov eax, [rbx + m_nSegments]'),
        (0x85d99a, '83f80a', 'cmp eax, 10'),
        (0x85d9a5, '89b398120000', 'mov [rbx + m_nSegments], esi'),
        # Then the simulation object, and the two vectors handed to it.
        (0x85d9db, 'c745d0000020c1', 'mov dword [rbp - 0x30], -10.0'),
        (0x85d9e2, 'c745d4000020c1', 'mov dword [rbp - 0x2c], -10.0'),
        (0x85d9e9, 'c745d8000020c1', 'mov dword [rbp - 0x28], -10.0'),
        (0x85d9bb, 'c745e000002041', 'mov dword [rbp - 0x20], 10.0'),
        (0x85d9c6, 'c745e400002041', 'mov dword [rbp - 0x1c], 10.0'),
        (0x85d9d4, 'c745e800002041', 'mov dword [rbp - 0x18], 10.0'),
        # And the entity's own virtual at [vtable + 0x528] takes the float.
        (0x85da03, 'ff9028050000', 'call qword [rax + 0x528]')):
    at = offset + (address - base)
    assert client64[at:at + len(expected) // 2].hex() == expected, (hex(address), what)
assert client_call_target(0x85d9b2) == 0xaa9340, hex(client_call_target(0x85d9b2))
# The instructions the renderer's tube is sized by, at their own addresses: it reads m_Subdiv and
# m_Width, and builds its texture coordinate from the rope's two length numbers minus 100.
MESH_AT = 0x860fb5
for address, expected, what in (
        (0x860fb5, '8b87a8120000', 'mov eax, [rdi + m_Subdiv]'),
        (0x860fee, 'f30f10afc0120000', 'movss xmm5, [rdi + m_Width]'),
        (0x8610b6, '8b97b0120000', 'mov edx, [rdi + m_Slack]'),
        (0x8610bc, '0397ac120000', 'add edx, [rdi + m_RopeLength]'),
        (0x8610d6, '83ea64', 'sub edx, 100'),
        # Building a rope clamps its simulated segments into 2..10 before storing them.
        (0x863f4c, '4183fe0a', 'cmp r14d, 10'),
        (0x863f55, '440f4ff0', 'cmovg r14d, eax'),
        (0x863f5c, '4489b398120000', 'mov [rbx + m_nSegments], r14d'),
        # The restore path writes the same members, which is a second place their offsets show.
        (0x8640c9, '8983ac120000', 'mov [rbx + m_RopeLength], eax'),
        (0x8640d4, 'c783b01200', 'mov dword [rbx + m_Slack], 0')):
    at = offset + (address - base)
    assert client64[at:at + len(expected) // 2].hex() == expected, (hex(address), what)

# What 0x72a820 turned out to be - and what it is not.
#
# Its address is patched into a `.data` slot that sits in a 36-byte record whose other two relocated
# fields point at the strings `InputFadeIn` and `FadeIn`, so it is the handler an entity input is
# registered with. The value and type it reads come out of that input's own argument.
#
# It is therefore NOT a receive proxy for the rope, and that is now positively disproved rather than
# merely unestablished: the rope's own m_nSegments registration pushes a null proxy - 0x9cbfdd
# pushes 0 - and the registration helper reads that argument as a pointer and compares it against a
# default proxy. Its writes to 0x4fc and 0x500 are that other class's fields; the rope class keeping
# members at the same two offsets proves nothing about it.
PROXY_AT = 0x72a820
SLOT_AT = 0x1bab8c0
with open(SERVER64, 'rb') as handle:
    server_relocations = {}
    for section in ELFFile(handle).iter_sections():
        if section.header['sh_type'] in ('SHT_RELA', 'SHT_REL'):
            for relocation in section.iter_relocations():
                addend = relocation['r_addend'] if section.header['sh_type'] == 'SHT_RELA' else 0
                if addend:
                    server_relocations[relocation['r_offset']] = addend
assert server_relocations[SLOT_AT] == PROXY_AT, hex(server_relocations.get(SLOT_AT, 0))
slot_strings = [cstring_in(server64, server_sections, server_relocations[SLOT_AT - 0x20]),
                cstring_in(server64, server_sections, server_relocations[SLOT_AT - 0x10])]
assert slot_strings == ['InputFadeIn', 'FadeIn'], slot_strings
# The function beside it is the same class's FadeOut handler, which says the whole region is that
# class's - a fade-capable entity - rather than the map's rope, whose own key handling is at
# 0x9d1850. Its neighbours are read the same way so the region is not mistaken for rope code.
OUT_AT, OUT_SLOT = 0x72a890, 0x1bab928
assert server_relocations[OUT_SLOT] == OUT_AT, hex(server_relocations.get(OUT_SLOT, 0))
neighbour_strings = [cstring_in(server64, server_sections, server_relocations[OUT_SLOT - 0x20]),
                     cstring_in(server64, server_sections, server_relocations[OUT_SLOT - 0x10])]
assert neighbour_strings == ['InputFadeOut', 'FadeOut'], neighbour_strings
# The update function in the same region (0x72ab60) is in no vtable and no data table - nothing
# points at it - so which class it belongs to cannot be read off it, and its use of the same
# offsets is not evidence about the rope either way.
UPDATE_AT = 0x72ab60
assert UPDATE_AT not in set(server_relocations.values()), 'that function is now pointed at by a table'

# The rope's own datamap, out of `server_client.so`'s `.data`: the engine's field table for the
# class, each entry holding the field name, the offset it sits at, its type code and - where the map
# may set it - the key that reaches it. This is what the map's keys land on, read from the offsets
# the table itself states rather than from a registration's argument order, so it is a second and
# independent reading of the same layout. Four of the map's keys go straight to a field; the four
# a rope must derive for itself carry no key at all.
DATAMAP = [
    ('m_Slack', 0x4f0, 0x00060001, 'Slack'),
    ('m_Width', 0x4f4, 0x00060001, 'Width'),
    ('m_TextureScale', 0x4f8, 0x00060001, 'TextureScale'),
    ('m_nSegments', 0x4fc, 0x00020001, None),
    ('m_bConstrainBetweenEndpoints', 0x500, 0x00020001, None),
    ('m_strRopeMaterialModel', 0x508, 0x00020001, None),
    ('m_iRopeMaterialModelIndex', 0x510, 0x00020001, None),
    ('m_Subdiv', 0x514, 0x00060001, 'Subdiv'),
    ('m_RopeLength', 0x51c, 0x00020001, None),
    ('m_fLockedPoints', 0x520, 0x00020001, None),
    ('m_bCreatedFromMapFile', 0x524, 0x00020001, None),
    ('m_flScrollSpeed', 0x528, 0x00060001, 'ScrollSpeed'),
    ('m_bStartPointValid', 0x530, 0x00020001, None),
    ('m_bEndPointValid', 0x531, 0x00020001, None),
    ('m_hStartPoint', 0x534, 0x00020001, None),
    ('m_hEndPoint', 0x538, 0x00020001, None),
    ('m_iStartAttachment', 0x53c, 0x00020001, None),
    ('m_iEndAttachment', 0x53e, 0x00020001, None),
]
# Each entry is 0x68 bytes: name pointer, offset, type code, and the key pointer where there is one.
FIELD_TYPE_CODE_OFFSET = 0x0c
DATAMAP_AT = 0x1c0dd00
# That this table is the rope's own is not assumed: the class's registration (which stores
# `CRopeKeyframe` as its name) calls the datamap builder at 0x9cc430, and that builder records the
# field count and a pointer to 0x1c0dc28 - the table my entries sit inside, 0xd8 in.
DATAMAP_BUILDER_AT = 0x9cc430
DATAMAP_ROOT_AT = 0x1c0dc28
assert DATAMAP_AT - DATAMAP_ROOT_AT == 0xd8, hex(DATAMAP_AT - DATAMAP_ROOT_AT)


def call_target(address: int) -> int:
    at = server_offset + (address - server_base)
    assert server64[at] == 0xe8, hex(address)
    return address + 5 + struct.unpack_from('<i', server64, at + 1)[0]


# The registration calls the network table builder and then the datamap builder.
assert call_target(0x5a5fb0) == 0x9cbd90, hex(call_target(0x5a5fb0))
assert call_target(0x5a5fbd) == DATAMAP_BUILDER_AT, hex(call_target(0x5a5fbd))
# The builder states the table's field count and where it starts, and the entries are inside it.
assert struct.unpack_from('<I', server64, offset_of(server64, server_sections, 0x9cc443))[0] == 0x17
root = struct.unpack_from('<i', server64, offset_of(server64, server_sections, 0x9cc459))[0]
assert 0x9cc456 + 7 + root == DATAMAP_ROOT_AT, hex(0x9cc456 + 7 + root)
assert DATAMAP_ROOT_AT < DATAMAP_AT < 0x1c0e580, hex(DATAMAP_AT)
for index, (field, at, kind, key) in enumerate(DATAMAP):
    entry = DATAMAP_AT + 0x68 * index
    name_at = server_relocations.get(entry)
    assert name_at is not None and cstring_in(server64, server_sections, name_at) == field, \
        (hex(entry), field, cstring_in(server64, server_sections, name_at) if name_at else None)
    where_at = offset_of(server64, server_sections, entry + 8)
    stated = struct.unpack_from('<I', server64, where_at)[0]
    assert stated == at, (field, hex(stated), hex(at))
    code_at = offset_of(server64, server_sections, entry + FIELD_TYPE_CODE_OFFSET)
    assert struct.unpack_from('<I', server64, code_at)[0] == kind, field
    key_at = server_relocations.get(entry + 0x10)
    read = cstring_in(server64, server_sections, key_at) if key_at else None
    assert read == key, (field, read, key)
for address, expected, what in (
        # The rope's m_nSegments registration: the proxy argument is pushed as zero.
        (0x9cbfd8, '6880000000', 'push 0x80 (the flag argument)'),
        (0x9cbfdd, '6a00', 'push 0 (no proxy)'),
        # The helper reads that argument as a pointer and compares it against a default proxy.
        (0xabcf81, '488b7d10', 'mov rdi, [rbp + 0x10] (the proxy argument)'),
        (0xabcfa8, '4885ff', 'test rdi, rdi'),
        (0xabd02b, '4839d7', 'cmp rdi, rdx (against the default proxy)'),
        (PROXY_AT, '55c7870005000000', 'push rbp; mov dword [rdi + 0x500], 0')):
    at = server_offset + (address - server_base)
    assert server64[at:at + len(expected) // 2].hex() == expected, (hex(address), what)
# The expression that function computes, kept because it was read, and kept apart from the rope.
for address, expected, what in (
        (0x72a860, 'f30f2c4610', 'cvttss2si eax, [rsi + 0x10]'),
        (0x72a865, '83f864', 'cmp eax, 100'),
        (0x72a86f, '8d0c80', 'lea ecx, [rax + rax*4]  (five times n)'),
        (0x72a872, 'b800640000', 'mov eax, 25600'),
        (0x72a878, 'f7f9', 'idiv ecx'),
        (0x72a87a, '8987fc040000', 'mov [rdi + 0x4fc], eax')):
    at = server_offset + (address - server_base)
    assert server64[at:at + len(expected) // 2].hex() == expected, (hex(address), what)

# The server's own members, whose offsets are not the client's - read the same way, between one
# registration call and the next, and agreeing with the earlier scan of the same block.
SERVER_MEMBERS = [
    ('m_RopeFlags', 0x4e0, 4), ('m_Slack', 0x4f0, 4), ('m_Width', 0x4f4, 4),
    ('m_TextureScale', 0x4f8, 4), ('m_nSegments', 0x4fc, 4),
    ('m_bConstrainBetweenEndpoints', 0x500, 1), ('m_iRopeMaterialModelIndex', 0x510, 4),
    ('m_Subdiv', 0x514, 4), ('m_nChangeCount', 0x518, 1), ('m_RopeLength', 0x51c, 4),
    ('m_fLockedPoints', 0x520, 4), ('m_flScrollSpeed', 0x528, 4),
]
server_rows = []
pending = {'name': None, 'offset': None, 'type': None}
for instruction in window_in(server64, server_offset, server_base, 0x9cbe80, 0x320):
    if instruction.mnemonic == 'lea' and instruction.op_str.startswith('rsi, ') \
            and 'rip + ' in instruction.op_str:
        disp = int(instruction.op_str.split('rip + ')[1].split(']')[0], 16)
        pending['name'] = cstring_in(server64, server_sections,
                                     instruction.address + instruction.size + disp)
    elif instruction.mnemonic == 'mov' and instruction.op_str.startswith('ecx, '):
        pending['type'] = int(instruction.op_str.split(', ')[1], 16)
    elif instruction.mnemonic == 'mov' and instruction.op_str.startswith('edx, '):
        pending['offset'] = int(instruction.op_str.split(', ')[1], 16)
    elif instruction.mnemonic == 'call':
        if pending['name'] and pending['offset'] is not None:
            server_rows.append((pending['name'], pending['offset'], pending['type']))
        pending = {'name': None, 'offset': None, 'type': None}
server_names = {name for name, _, _ in SERVER_MEMBERS}
server_by_name = {name: (offset, kind) for name, offset, kind in server_rows if name in server_names}
for name, offset, kind in SERVER_MEMBERS:
    assert server_by_name.get(name) == (offset, kind), \
        (name, server_by_name.get(name), (offset, kind))
assert len(server_by_name) == len(SERVER_MEMBERS), sorted(server_names - set(server_by_name))
server_order = [name for name, _, _ in server_rows if name in server_names]

# Where each function begins is not guessed: the binary ships its own frame information
# (`.eh_frame`), one entry per function with its start and length. Reading it means a function can be
# named as such - "the code from 0x9cfda0 to 0x9d0195" - instead of being pointed at by an address
# somewhere inside it, which is what earlier rounds had to do.
with open(SERVER64, 'rb') as handle:
    server_elf = ELFFile(handle)
    frame = server_elf.get_section_by_name('.eh_frame')
    frame_at, frame_size, frame_addr = frame['sh_offset'], frame['sh_size'], frame['sh_addr']
    server_relative = {}
    for section in server_elf.iter_sections():
        if section.header['sh_type'] == 'SHT_RELA' and section.name == '.rela.dyn':
            for relocation in section.iter_relocations():
                if relocation['r_info_type'] == 8:      # R_X86_64_RELATIVE
                    server_relative[relocation['r_offset']] = relocation['r_addend']

ENCODED_SIZE = {0x00: 8, 0x01: 1, 0x02: 2, 0x03: 4, 0x04: 8,
                0x09: 1, 0x0A: 2, 0x0B: 4, 0x0C: 8}


def leb128(data: bytes, at: int) -> tuple[int, int]:
    value = 0
    shift = 0
    while True:
        byte = data[at]
        at += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, at
        shift += 7


def function_bounds(data: bytes, at: int, size: int, address: int) -> list[tuple[int, int]]:
    """Every function's start and length, walked out of the frame entries."""
    cies: dict[int, int] = {}
    bounds: list[tuple[int, int]] = []
    cursor = 0
    while cursor < size - 4:
        length = int.from_bytes(data[at + cursor:at + cursor + 4], 'little')
        if length == 0:
            cursor += 4
            continue
        if length == 0xFFFFFFFF:
            length = int.from_bytes(data[at + cursor + 4:at + cursor + 12], 'little')
            body = cursor + 12
        else:
            body = cursor + 4
        entry = int.from_bytes(data[at + body:at + body + 4], 'little')
        here = body + 4
        if entry == 0:
            here += 1                                    # version
            augmentation = b''
            while data[at + here] != 0:
                augmentation += bytes([data[at + here]])
                here += 1
            here += 1
            _, here = leb128(data, at + here)
            here -= at
            here += 1                                    # data alignment
            _, here = leb128(data, at + here)
            here -= at
            encoding = 0
            if augmentation.startswith(b'z'):
                aug_len, here = leb128(data, at + here)
                here -= at
                walk = here
                for letter in augmentation[1:]:
                    if letter in (ord('L'), ord('R')):
                        if letter == ord('R'):
                            encoding = data[at + walk]
                        walk += 1
                    elif letter == ord('P'):
                        walk += 1
                        walk += ENCODED_SIZE.get(data[at + walk - 1] & 0x0F, 8)
                    else:
                        break
                here = here + aug_len
            cies[address + cursor] = encoding
        else:
            encoding = cies[address + body - entry]
            kind = encoding & 0x0F
            field = address + here
            raw = int.from_bytes(data[at + here:at + here + ENCODED_SIZE[kind]], 'little',
                                 signed=kind in (0x09, 0x0A, 0x0B, 0x0C))
            here += ENCODED_SIZE[kind]
            start = field + raw if encoding & 0x10 else raw
            span = int.from_bytes(data[at + here:at + here + ENCODED_SIZE[kind]], 'little',
                                  signed=kind in (0x09, 0x0A, 0x0B, 0x0C))
            bounds.append((start, span))
        cursor += 4 + length if length != 0xFFFFFFFF else 12 + length
    bounds.sort()
    return bounds


server_bounds = function_bounds(server64, frame_at, frame_size, frame_addr)
assert len(server_bounds) > 50_000, len(server_bounds)
server_starts = {start for start, _ in server_bounds}
# The two builders the class's registration calls are function starts, which is what says the walk
# came out right rather than stretching across instructions.
for start in (DATAMAP_BUILDER_AT, 0x9cbd90):
    assert start in server_starts, hex(start)
SERVER_TEXT_LO, SERVER_TEXT_HI = server_base, server_base + server_text['sh_size']


def function_of(address: int) -> tuple[int, int]:
    lo, hi = 0, len(server_bounds) - 1
    best = 0
    while lo <= hi:
        mid = (lo + hi) // 2
        if server_bounds[mid][0] <= address:
            best = mid
            lo = mid + 1
        else:
            hi = mid - 1
    return server_bounds[best]


# Which class a function belongs to cannot be read off the offsets it writes - two classes can keep
# members at the same numbers, and one in this very binary does. What can say it is the class's own
# virtual table: the compiler relocates every entry, and the slot just before the table points at the
# class's type information, whose name is a string. So the rope's table is found by name and its
# members are then vouched for by membership.
def vtable_runs() -> list[list[int]]:
    slots = sorted(address for address, value in server_relative.items()
                   if SERVER_TEXT_LO <= value < SERVER_TEXT_HI)
    runs: list[list[int]] = []
    current = [slots[0]]
    for address in slots[1:]:
        if address == current[-1] + 8:
            current.append(address)
        else:
            runs.append(current)
            current = [address]
    runs.append(current)
    return runs


def vtable_name(head: int) -> str | None:
    type_info = server_relative.get(head - 8)
    if type_info is None:
        return None
    return cstring_in(server64, server_sections, server_relative.get(type_info + 8, 0))


ROPE_VTABLE_AT = 0x1a8d3e8
rope_vtable: list[int] = []
for run in vtable_runs():
    if len(run) < 8 or vtable_name(run[0]) is None:
        continue
    if vtable_name(run[0]).endswith('CRopeKeyframe'):
        assert run[0] == ROPE_VTABLE_AT, hex(run[0])
        rope_vtable = [server_relative[address] for address in run]
assert len(rope_vtable) == 203, len(rope_vtable)
# Two of the functions below are in it, so they are the class's own virtuals; that is what makes
# what they do with the class's fields theirs to say.
assert 0x9d2520 in rope_vtable, 'the spawn-time validation is no longer a virtual of the rope'
assert 0x9d2c00 in rope_vtable, 'the tracked update is no longer a virtual of the rope'

# The map's `Type` key decides the simulated segment count, in the class's key handling. Read as
# bytes: for `Type 0` the count is set to 10, for `Type 1` to 4, and for anything else to 2 - so the
# count is derived from a key rather than stored under one, which is why the datamap above shows no
# key reaching m_nSegments at all. Every one of the map's 142 ropes writes `Type 0`.
KEY_HANDLING_AT = 0x9d16d0
TYPE_SEGMENTS = {'0': 10, '1': 4, 'other': 2}
for address, name in ((0x9d16ff, 'Breakable'), (0x9d1760, 'Collide'), (0x9d1880, 'Barbed'),
                      (0x9d1897, 'UseWind'), (0x9d1b28, 'Dangling'), (0x9d1b3b, 'Type'),
                      (0x9d1c20, 'RopeShader'), (0x9d1ca7, 'RopeMaterial')):
    at = server_offset + (address - server_base)
    assert server64[at] == 0x48 and server64[at + 1] == 0x8d and server64[at + 2] == 0x35, \
        (hex(address), name)
    disp = struct.unpack_from('<i', server64, at + 3)[0]
    assert cstring_in(server64, server_sections, address + 7 + disp) == name, name
for address, expected, what in (
        (0x9d1b61, '85c0', 'test eax, eax  (is the Type zero?)'),
        (0x9d1b63, '0f85f4000000', 'jne 0x9d1c5d  (anything but zero goes on)'),
        (0x9d1b9a, '41c785fc0400000a000000', 'mov dword [r13 + m_nSegments], 10'),
        (0x9d1c5d, '83f801', 'cmp eax, 1'),
        (0x9d1c60, '0f8437010000', 'je 0x9d1d9d  (Type 1)'),
        (0x9d1c97, '41c785fc04000002000000', 'mov dword [r13 + m_nSegments], 2'),
        (0x9d1db7, '41c785fc04000004000000', 'mov dword [r13 + m_nSegments], 4')):
    at = server_offset + (address - server_base)
    assert server64[at:at + len(expected) // 2].hex() == expected, (hex(address), what)

# The class's spawn-time validation, a virtual of the rope, bounds the count at both ends and floors
# the texture scale - and its own warning text says which entity it is talking about.
SPAWN_VALIDATION_AT = 0x9d2520
for address, expected, what in (
        (0x9d2543, 'e858d8ffff', 'call the length calculation (0x9cfda0)'),
        (0x9d2548, '8b83fc040000', 'mov eax, [rbx + m_nSegments]'),
        (0x9d254e, '83f801', 'cmp eax, 1'),
        (0x9d2557, '83f80a', 'cmp eax, 10'),
        (0x9d2807, '488d93fc040000', 'lea rdx, [rbx + m_nSegments]'),
        (0x9d280e, '41bc02000000', 'mov r12d, 2'),
        (0x9d26ae, '41bc0a000000', 'mov r12d, 10'),
        (0x9d26da, '4489a3fc040000', 'mov [rbx + m_nSegments], r12d'),
        (0x9d2633, '488d3df6b8a100', 'lea rdi, [rip + 0xa1b8f6]  (less than 0.1)'),
        (0x9d2767, '488d3d0ab8a100', 'lea rdi, [rip + 0xa1b80a]  (greater than 10)')):
    at = server_offset + (address - server_base)
    assert server64[at:at + len(expected) // 2].hex() == expected, (hex(address), what)
warning_texts = ['move_rope has TextureScale less than 0.1 at (%2.2f, %2.2f, %2.2f)\n',
                 'move_rope has TextureScale greater than 10 at (%2.2f, %2.2f, %2.2f)\n']
# The strings end in a newline, so they are compared as bytes rather than read as a C string.
for address, text in zip((0x9d2633, 0x9d2767), warning_texts):
    at = server_offset + (address - server_base)
    disp = struct.unpack_from('<i', server64, at + 3)[0]
    where = offset_of(server64, server_sections, address + 7 + disp)
    assert server64[where:where + len(text)] == text.encode(), (hex(address), text)

# The length: the straight distance between the rope's two endpoints, truncated to whole units. When
# the end point is not valid the length is left at zero. A second, tracked update adds the slack.
LENGTH_CALC_AT = 0x9cfda0
for address, expected, what in (
        (0x9cfed8, 'f30f2cd8', 'cvttss2si ebx, xmm0  (the distance, truncated)'),
        (0x9cfedc, '41399c241c050000', 'cmp [r12 + m_RopeLength], ebx'),
        (0x9cff0b, '41899c241c050000', 'mov [r12 + m_RopeLength], ebx'),
        (0x9cfe1a, '41c784241c05000000000000', 'mov dword [r12 + m_RopeLength], 0')):
    at = server_offset + (address - server_base)
    assert server64[at:at + len(expected) // 2].hex() == expected, (hex(address), what)
TRACKED_UPDATE_AT = 0x9d2c00
for address, expected, what in (
        (0x9d2dc5, 'f30f2cd8', 'cvttss2si ebx, xmm0  (the same distance)'),
        (0x9d2dc9, '41039c24f0040000', 'add ebx, [r12 + m_Slack]'),
        (0x9d2dd1, '413b9c241c050000', 'cmp ebx, [r12 + m_RopeLength]'),
        (0x9d2e09, '41899c241c050000', 'mov [r12 + m_RopeLength], ebx')):
    at = server_offset + (address - server_base)
    assert server64[at:at + len(expected) // 2].hex() == expected, (hex(address), what)

# The runtime way to make a rope (`CreateRope`): its only caller in the binary is a virtual of
# `CRopeAnchor` (in that class's own table), and the length it hands over is the vertical distance
# between the anchor and the entity it is attached to - or 384 when it is attached to nothing.
CREATE_ROPE_AT = 0x9cf500
ANCHOR_VTABLE_AT = 0x19f2660
anchor_vtable = []
for run in vtable_runs():
    if len(run) >= 8 and (vtable_name(run[0]) or '').endswith('CRopeAnchor'):
        assert run[0] == ANCHOR_VTABLE_AT, hex(run[0])
        anchor_vtable = [server_relative[address] for address in run]
assert 0x6ab080 in anchor_vtable, 'the rope creator is no longer a virtual of CRopeAnchor'
assert 'keyframe_rope' == cstring_in(server64, server_sections, 0x6ab0ca + 7 + 0xcfe75b)
for address, expected, what in (
        (0x6ab099, 'ba80010000', 'mov edx, 0x180  (the length with no parent)'),
        (0x6ab0ee, 'e80d443200', 'call CreateRope (0x9cf500)'),
        (0x6ab1ae, 'f30f2cd0', 'cvttss2si edx, xmm0'),
        (0x6ab19b, 'f30f5c8380020000', 'subss xmm0, [rbx + 0x280]  (the two heights)')):
    at = server_offset + (address - server_base)
    assert server64[at:at + len(expected) // 2].hex() == expected, (hex(address), what)

# A function that would compute both numbers for itself (0x9ce1a0) is in no virtual table, is called
# from nowhere and is pointed at by no table in the file. It is left in the build and reached by
# nothing, so it is not the rule the game follows - and saying so is the point of reading this far.
DEAD_LENGTH_AT = 0x9ce1a0
assert DEAD_LENGTH_AT in server_starts, hex(DEAD_LENGTH_AT)
assert DEAD_LENGTH_AT not in rope_vtable and DEAD_LENGTH_AT not in anchor_vtable
assert DEAD_LENGTH_AT not in set(server_relative.values()), 'that function is now in a table'
for found in re.finditer(rb'[\xe8\xe9]', server_body):
    if found.start() + 5 + struct.unpack_from('<i', server_body, found.start() + 1)[0] \
            == DEAD_LENGTH_AT:
        raise AssertionError(f'{DEAD_LENGTH_AT:#x} is called from '
                             f'{server_base + found.start():#x}')

report = {
    'format': 'source-ropes-v1',
    'sources': {'sourceBspSha256': sha(raw), 'client64Sha256': sha(client64),
                'server64Sha256': sha(server64),
                'entitiesJsonSha256': sha(EXPORT.read_bytes())},
    'structure': structure,
    'map': {'ropes': len(ropes), 'classes': dict(classes), 'materials': dict(materials),
            'chained': len(named), 'movers': sum(1 for row in from_bsp if 'PositionInterpolator' in row),
            'widths': dict(collections.Counter(row['Width'] for row in from_bsp).most_common()),
            'slacks': dict(collections.Counter(row['Slack'] for row in from_bsp).most_common()),
            'ropeSet': ropes},
    'class': {'members': [{'name': name, 'offset': at, 'type': kind} for name, at, kind in MEMBERS],
              'tableAt': hex(table_at),
              'serverMembers': [{'name': name, 'offset': at, 'type': kind}
                                for name, at, kind in SERVER_MEMBERS],
              'serverRegistrationOrder': server_order,
              'serverMeaning': ('The server\'s own copy of the class is laid out differently from the '
                                'client\'s - the same keys land at different offsets, e.g. m_Slack at '
                                '0x4f0 there against 0x12b0 here - so what the port acts on is the '
                                'map\'s keys, not either build\'s member numbers.'),
              'datamap': {
                  'at': hex(DATAMAP_AT), 'entryBytes': 0x68,
                  'root': hex(DATAMAP_ROOT_AT), 'fields': 0x17,
                  'builtBy': hex(DATAMAP_BUILDER_AT),
                  'linkage': ('The class\'s registration stores `CRopeKeyframe` as its name and calls '
                              'the network table builder (0x5a5fb0 -> 0x9cbd90) and then this one '
                              '(0x5a5fbd -> 0x9cc430), which records the field count and the root the '
                              'entries sit inside - so the table read here is this class\'s, not one '
                              'matched to it by offsets.'),
                  'rows': [{'field': field, 'offset': at, 'typeCode': kind, 'key': key}
                           for field, at, kind, key in DATAMAP],
                  'keyed': {key: field for field, _, _, key in DATAMAP if key},
                  'derived': [field for field, _, _, key in DATAMAP if not key],
                  'meaning': ('This is what the map\'s keys land on. `Slack`, `Width`, `TextureScale` '
                              'and `Subdiv` reach the fields at 0x4f0, 0x4f4, 0x4f8 and 0x514 directly - '
                              'the offsets the network table states, read here from the table\'s own '
                              'bytes - and the scroll-speed key is `ScrollSpeed`, not the `MoveSpeed` '
                              'the map writes. `m_nSegments` and `m_RopeLength` carry no key at all, so '
                              'a rope\'s segment count and length are derived rather than set, and a '
                              'port that reads only the map has to derive them too. It also carries '
                              '`m_bCreatedFromMapFile` and its own start/end validity flags and '
                              'handles.')},
              'meaning': ('The client stores each of the map\'s rope keys in its own member and nets '
                          'them; the port reads the keys off the map, so these are the members its '
                          'keys become.')},
    'drawing': {'methods': METHODS, 'solver': 'CRopePhysicsILi10EE (ten constraint passes)',
                'materials': MATERIALS, 'materialFlags': MATERIAL_FLAGS,
                'serverKeys': SERVER_KEYS, 'serverMaterials': SERVER_MATERIALS,
                'materialRule': ('The server resolves `RopeMaterial` as written plus `.vmt`, so all 142 '
                                 'ropes use `cable/nuke_cable.vmt`; a rope that states none takes '
                                 '`RopeShader`, whose default is `cable/cable.vmt` and which picks '
                                 '`cable/rope.vmt` or `cable/chain.vmt` by value.'),
                'mesh': {'at': hex(MESH_AT),
                         'vertices': '2 + sum over the rope\'s segments of 3 * (m_Subdiv + 1)',
                         'indices': 'sum over the rope\'s segments of 6 * (m_Subdiv + 1)',
                         'textureAlong': '(m_Slack + m_RopeLength - 100) / m_TextureScale',
                         'segments': 'm_nSegments is clamped into 2..10 where a rope is built '
                                     '(0x863f4c-0x863f5c); the restore path writes the same members '
                                     '(0x8640c9, 0x8640d4)',
                         'meaning': ('The rope is drawn as a tube of three vertices per centreline '
                                     'point with m_Subdiv + 1 points per simulated segment, so this '
                                     'map\'s Subdiv 2 gives three vertices and two triangles per '
                                     'sub-segment; m_Width is what the tube is sized by, and the '
                                     'simulated segments themselves are between two and ten. How a '
                                     'rope\'s length is turned into that segment count is not read, '
                                     'nor is the field the renderer reads its point count from '
                                     '([rope + 0xfc8]).')},
                'physics': {'gravityAt': hex(GRAVITY_AT), 'gravity': gravity,
                            'setup': ('The client\'s rope init hands `this + 0x378` two whole vectors - '
                                      '(-10, -10, -10) and (10, 10, 10), three floats each - through '
                                      '0x8d0980, and then hands the entity itself the -1293.0 at '
                                      '0x19358c0 through the virtual at [vtable + 0x528] (0x85d9fb, '
                                      '0x85da03; also called from 0x86427f). An earlier note here said '
                                      '"two scalars of 10"; the listing shows a second vector, and this '
                                      'corrects it.'),
                            'meaning': ('These are the rope physics\' own numbers. What the two vectors '
                                        'and the single float each configure has not been read - the '
                                        'setter they go to compares two vec3s and stores them, which '
                                        'says it takes two vectors and not what they mean - so no rope '
                                        'shape may be built from them.')},
                'clientInit': {
                    'at': '0x85d930',
                    'segments': ('The rope clamps its own segment count into 2..10 where it initialises, '
                                 'reading m_nSegments (0x1298) and writing it back (0x85d98b-0x85d9a5), '
                                 'so whatever the server networks is used between those bounds.'),
                    'simulation': ('It then initialises the simulation object at `this + 0xfb0` '
                                   '(0xaa9340) and hands it the two vectors through 0x8d0980.'),
                    'material': ('The material comes off the *model* the server resolved the map\'s '
                                 '`RopeMaterial` into: it is looked up through the interface call at '
                                 '0x85d958 with the string `Other textures`, stored at `this + 0x12d8`, '
                                 'and the rope takes its flags from it (0x12e0). The shadow-depth '
                                 'material `cable/rope_shadowdepth` is looked up the same way on the '
                                 'path taken when that first lookup fails (0x85da38-0x85da78).'),
                    'meaning': ('This is the client\'s side of a rope: the count it clamps, the object it '
                                'simulates with, and where its material actually comes from. It does not '
                                'give the derivation the port needs, because the client is handed the '
                                'length and the count over the network.')},
                'nSegmentsProxy': {
                    'function': hex(PROXY_AT),
                    'slot': hex(SLOT_AT),
                    'slotStrings': slot_strings,
                    'whatItIs': ('Its address is patched into a `.data` slot inside a 36-byte record whose '
                                 'other two relocated fields point at `InputFadeIn` and `FadeIn`, so it is '
                                 'the handler an entity input is registered with; the value and type it '
                                 'reads come out of that input\'s own argument.'),
                    'whatItIsNot': ('It is not a receive proxy for the rope. The rope\'s own m_nSegments '
                                    'registration pushes a null proxy (0x9cbfdd) and the helper reads that '
                                    'argument as a pointer compared against a default proxy (0xabcf81, '
                                    '0xabcfa8, 0xabd02b), so it cannot be that prop\'s proxy - the two '
                                    'offsets it writes are that other class\'s fields. Matching a raw '
                                    'offset across classes proves nothing, which is why the port acts on '
                                    'the map\'s keys.'),
                    'expression': '25600 / (5 * n), with n clamped to at most 100',
                    'neighbours': {'at': hex(OUT_AT), 'slot': hex(OUT_SLOT),
                                   'slotStrings': neighbour_strings},
                    'region': ('The class whose input handlers these are also owns the update function '
                               'at 0x72ab60, which nothing points at, so its owner cannot be read off '
                               'it; the map\'s rope keeps its own key handling at 0x9d1850. The whole '
                               '0x72a7xx-0x72b6xx region is therefore that other class\'s until shown '
                               'otherwise, and its use of the same offsets is not evidence about the '
                               'rope in either direction.'),
                    'meaning': ('Recorded because it was read, and kept apart from the rope. What a rope\'s '
                                'segment count is computed from remains unread; the only thing read about '
                                'it is the client\'s own clamp into 2..10 where it builds a rope '
                                '(0x863f4c).')},
                'derivation': {
                    'frameBounds': ('Where each function begins is not guessed: the binary ships its own '
                                    'frame information and this probe walks it, so the functions named '
                                    'here are named as whole functions.'),
                    'classTable': {'at': hex(ROPE_VTABLE_AT), 'entries': len(rope_vtable),
                                   'anchor': ('Every entry of a virtual table is a relocation and the '
                                              'slot before the table points at the class\'s type '
                                              'information, whose name is a string - so the rope\'s '
                                              'table is found by name, and membership in it is what '
                                              'says a function is the class\'s own. Offsets cannot say '
                                              'that: another class in this binary keeps members at the '
                                              'same numbers.')},
                    'typeKey': {'handledAt': hex(KEY_HANDLING_AT),
                                'keys': ['Breakable', 'Collide', 'Barbed', 'UseWind', 'Dangling',
                                         'Type', 'RopeShader', 'RopeMaterial'],
                                'segments': TYPE_SEGMENTS,
                                'at0': ('`Type 0` sets m_nSegments to 10, `Type 1` to 4, anything else '
                                        'to 2 - the count is derived from a key rather than stored '
                                        'under one, which is why the datamap gives m_nSegments no key '
                                        'at all.'),
                                'map': ('All 142 of the map\'s ropes write `Type 0`, so their segment '
                                        'count is 10; the client then uses it between 2 and 10.')},
                    'spawnValidation': {'at': hex(SPAWN_VALIDATION_AT), 'segments': [2, 10],
                                        'textureScale': [0.1, 10.0],
                                        'says': warning_texts[0].strip()},
                    'length': {'at': hex(LENGTH_CALC_AT), 'calledFrom': hex(SPAWN_VALIDATION_AT),
                               'rule': ('m_RopeLength = trunc(|endPointPos - startPointPos|), the '
                                        'three-component distance between the two resolved endpoints '
                                        'in source units, and 0 while the end point is not valid.'),
                               'withSlack': {'at': hex(TRACKED_UPDATE_AT),
                                             'rule': ('The tracked update - a virtual of the same class, '
                                                      'which bumps m_nChangeCount - sets the same member '
                                                      'to trunc(distance) + m_Slack.')},
                               'open': ('Both formulas are read and both are reachable; which one a '
                                        'static map rope ends up with is not, so the port does not '
                                        'pick one. The renderer\'s own texture coordinate adds '
                                        '`m_Slack` to `m_RopeLength`, which reads as two separate '
                                        'parts of one length - the opposite of folding the slack into '
                                        'the member - and that disagreement is not resolved here.')},
                    'runtimeCreate': {'at': hex(CREATE_ROPE_AT),
                                      'calledBy': {'at': '0x6ab080', 'class': 'CRopeAnchor'},
                                      'length': ('The vertical distance between the anchor and the '
                                                 'entity it is attached to, or 384 when it is attached '
                                                 'to nothing.'),
                                      'className': 'keyframe_rope',
                                      'material': 'cable/cable.vmt'},
                    'deadCode': {'at': hex(DEAD_LENGTH_AT),
                                 'why': ('A function that computes both numbers for itself - the '
                                         'distance and its own slack - is in no virtual table, is '
                                         'called from nowhere and is pointed at by no relocation in the '
                                         'file. It is left in the build and reached by nothing, so it is '
                                         'not the rule the game follows, however right it looks.')}},
                'convars': {name: values for name, values in sorted(registrations.items())}},
    'reading': ('Dust2 hangs 142 ropes in chains of `keyframe_rope` segments with `move_rope` movers, '
                'all of them the same `cable/nuke_cable` material, each with its own width and slack. '
                'The map\'s own links say what the network is: 120 of them name a next key and hang '
                'from their own origin to that rope\'s origin, 22 end a chain, and following the 33 '
                'movers reaches all 142 in chains whose hops are 7.7 to 26.5 m. The client draws them '
                'with `CRopeKeyframe::DrawModel` through `CRopeManager`, simulates them with a '
                'ten-pass `CRopePhysics` whose own numbers are in this report, and builds their '
                'material chain from `cable/cable` plus `cable/rope_shadowdepth`.'),
    'boundary': ('The keys, the links and the two numbers a rope is made of are read; the sag they '
                 'are hung on is not. The map\'s `Type 0` gives every one of the 142 ropes 10 '
                 'simulated points, and the length is the three-component distance between its two '
                 'resolved endpoints truncated to whole units - either on its own (the calculation the '
                 'spawn calls, 0x9cfda0) or with `m_Slack` added (the tracked update, 0x9d2c00) - and '
                 'which of those two a static map rope ends up with is not read. Whether `Slack` is a '
                 'length or a percentage of one is likewise not read; it is added to the distance, '
                 'which is all that is known. The tube the renderer builds is in this report, but not '
                 'the offsets its vertices sit on around the centre line (only how many there are), '
                 'and not the solver: the ten constraint passes and the -1293.0 are named without '
                 'being attributed. No renderer may assume a rope shape yet.'),
}
OUT.write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n')
print(json.dumps({'format': report['format'], 'ropes': len(ropes), 'classes': dict(classes),
                  'chained': len(named), 'materials': dict(materials),
                  'members': len(MEMBERS), 'tableAt': hex(table_at),
                  'subdiv': sorted({row['Subdiv'] for row in from_bsp}),
                  'textureScale': sorted({row['TextureScale'] for row in from_bsp}),
                  'convars': {name: row['default'] for name, row in sorted(registrations.items())},
                  'rope_smooth_enlarge': registrations['rope_smooth_enlarge']},
                 ensure_ascii=False, indent=1))
