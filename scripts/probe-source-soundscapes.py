"""What the installed build states about Dust2's soundscapes - the ambience the map hangs on itself.

Dust2 declares 57 `env_soundscape` entities, and the port connects none of them: the map is silent
apart from weapons and impacts. This probe reads the whole chain the engine would use, so a later
step can play it rather than guess at it:

  * **The map's own entities**, twice over (the frozen BSP's entity lump and the reviewed export),
    field for field. 57 entities name 18 distinct soundscapes, each with its own radius.
  * **The definitions**, out of the shipped pak: `scripts/soundscapes_dust2_new.vsc` is not a
    compiled format at all - it is plain KeyValues text with a `.vsc` extension. The 18 names the
    map uses resolve into it case-insensitively (the map writes lower case, the file mixed case),
    one name is defined twice, and nine of the eighteen inherit another soundscape's contents.
  * **Which files the client loads**, read off `C_SoundscapeSystem::Init` in the shipped client: it
    opens `scripts/soundscapes_manifest.txt` and reads every `"file"` key in it, so the list is the
    engine's own and not the map's. That file's comments also state the DSP preset names and the
    sound-level table.
  * **How a definition becomes sound**, read off the client's own parsers: the sub-key names it
    compares (`playlooping`, `playrandom`, `rndwave`, `"wave"`) and the traversal that walks them.
  * **Which soundscape a listener is in**, read off the server's update: a soundscape is a candidate
    for a player when the player is strictly inside its sphere (`radius * radius > distance²`), and
    the entity's own datamap says where `radius`, the name and `StartDisabled` sit.
  * **How a chosen soundscape reaches a player**: one commit (`0xa16ca0`) writes a player's audio
    block - the soundscape's index, the entity's index, and up to eight positions resolved from the
    entity's own `m_positionNames`. Three call sites reach it, all placed by table membership: the
    system's own walk (`0xa16eb0`, asked from slot 15 of `CSoundscapeSystem`) and two virtuals of
    `CTriggerSoundscape` (slots 105 and 103).
  * **What the walk's second argument is**: a listener record the caller builds on its own stack, so
    its layout is readable - player at +0, active soundscape at +8, floats at +0x10 and +0x1c, a
    counter at +0x20, and at +0x24 the flag the caller clears before the call and acts on after.

One reading this report used to carry is **withdrawn**: that the walk commits "the entity whose own
score is exactly 1.0". The two compares that guard the commit stand as reads, but the slot the first
one tests is written by no instruction in the walk, by nothing that reaches the walk, and by nothing
anywhere in the binary - so what the guard tests is not established. `boundary` says so at length.

Run: PYTHONPATH=.tools/source-binary-venv/lib/python3.9/site-packages python3\
 scripts/probe-source-soundscapes.py
"""
from __future__ import annotations
import hashlib
import importlib.util
import json
import re
import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INSTALL = ROOT / '.reference-assets/csgo-legacy'
BSP = INSTALL / 'csgo/maps/de_dust2.bsp'
EXPORT = ROOT / '.reference-assets/source-exports/dust2/source-metadata/entities.json'
CLIENT64 = INSTALL / 'csgo/bin/linux64/client_client.so'
SERVER64 = INSTALL / 'csgo/bin/linux64/server_client.so'
OUT = ROOT / 'research/source-soundscapes.json'
BSP_SHA = 'b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc'
DEFINITION = 'scripts/soundscapes_dust2_new.vsc'
MANIFEST = 'scripts/soundscapes_manifest.txt'
sha = lambda data: hashlib.sha256(data).hexdigest()  # noqa: E731


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


binary_index = load('source_binary_index', 'scripts/source-binary-index.py')
inventory = load('inventory_source_items', 'scripts/inventory-source-items.py')
client = binary_index.open_binary(CLIENT64)
server = binary_index.open_binary(SERVER64)

# ---------------------------------------------------------------------------------------------
# The map's own soundscape entities.
# ---------------------------------------------------------------------------------------------
raw = BSP.read_bytes()
assert sha(raw) == BSP_SHA, 'the frozen BSP is not the one this probe was written against'


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
                    spans.append(text[start:cursor + 1])
                    index = cursor + 1
                    break
            cursor += 1


def pairs(block: str) -> dict:
    """The quoted key/value pairs of one entity, values kept verbatim."""
    return {key: value for key, value in
            re.findall(r'"([^"]+)"\s+"((?:[^"\\]|\\.)*)"', block)}


text = lump(raw, 0).decode('latin1', 'replace')
from_bsp = [pairs(block) for block in blocks(text)
            if pairs(block).get('classname') == 'env_soundscape']
from_export = [row for row in json.loads(EXPORT.read_text())
               if row.get('classname') == 'env_soundscape']
assert len(from_bsp) == len(from_export) == 57, (len(from_bsp), len(from_export))
# Two independent readers of the same bytes: the frozen lump and the reviewed export, which lower
# cases every key name.
for stated, reviewed in zip(from_bsp, from_export):
    assert int(stated['hammerid']) == int(reviewed['hammerid']), (stated['hammerid'], reviewed)
    assert [float(value) for value in stated['origin'].split()] == \
        [float(value) for value in reviewed['origin'].split()]
    assert int(stated['radius']) == int(reviewed['radius'])
    assert stated['soundscape'].casefold() == reviewed['soundscape'].casefold()
    assert int(stated.get('StartDisabled', 0)) == int(reviewed.get('startdisabled', 0))

soundscapes = [{'hammerId': int(row['hammerid']),
                'origin': [float(value) for value in row['origin'].split()],
                'radius': int(row['radius']),
                'name': row['soundscape'],
                'startDisabled': int(row.get('StartDisabled', 0))} for row in from_bsp]
assert all(row['startDisabled'] == 0 for row in soundscapes), 'a soundscape starts disabled'
radii = sorted({row['radius'] for row in soundscapes})
names_written = sorted({row['name'] for row in soundscapes})
assert len(names_written) == 18, names_written
assert len(radii) == 40 and (radii[0], radii[-1]) == (76, 478), (len(radii), radii[:3], radii[-3:])

# ---------------------------------------------------------------------------------------------
# The definitions, out of the shipped pak.
# ---------------------------------------------------------------------------------------------
entries, index_info = inventory.directory_index(inventory.GAME / 'pak01_dir.vpk')


def payload(key: str) -> bytes:
    entry = entries[key]
    with (inventory.GAME / f"pak01_{entry['archiveIndex']:03}.vpk").open('rb') as handle:
        handle.seek(entry['archiveOffset'])
        data = handle.read(entry['archiveBytes'])
    assert len(data) == entry['bytes']
    assert f'{zlib.crc32(data) & 0xffffffff:08x}' == entry['crc32'], key
    return data


definition_bytes = payload(DEFINITION)
definition_text = definition_bytes.decode('latin1')
# The extension says compiled, the bytes say text: every byte is a printable or a newline.
assert all(32 <= byte < 127 or byte in (9, 10, 13) for byte in definition_bytes), \
    'the definition is no longer plain text'


def tokenise(text: str) -> list[tuple[str, str]]:
    """A KeyValues token stream: quoted values, braces, and bare words, comments dropped."""
    tokens = []
    for line in text.splitlines():
        line = re.sub(r'//.*', '', line).strip()
        if not line:
            continue
        for quoted, brace, bare in re.findall(r'"((?:[^"\\]|\\.)*)"|(\{|\})|([^\s{}"]+)', line):
            tokens.append(('b', brace) if brace else ('v', (quoted or bare).replace('\\"', '"')))
    return tokens


def build(tokens: list[tuple[str, str]]) -> dict:
    """Keys to values, sub-blocks to dicts, and a repeated key to a list of both."""
    at = [0]

    def put(out, key, value):
        if key in out:
            if not isinstance(out[key], list):
                out[key] = [out[key]]
            out[key].append(value)
        else:
            out[key] = value

    def block():
        out = {}
        while at[0] < len(tokens):
            kind, value = tokens[at[0]]
            if kind == 'b' and value == '}':
                at[0] += 1
                return out
            if kind == 'b':
                at[0] += 1
                continue
            key = value
            at[0] += 1
            if tokens[at[0]] == ('b', '{'):
                at[0] += 1
                put(out, key, block())
            else:
                at[0] += 1
                put(out, key, tokens[at[0] - 1][1])
        return out

    return block()


def as_list(value):
    return [] if value is None else (value if isinstance(value, list) else [value])


tree = build(tokenise(definition_text))
assert len(tree) == 20, sorted(tree)
# One name is written twice. The engine's key lookup walks sub-keys in order and stops at the first
# match, so the first block of a repeated name is the one the game uses; that is recorded, not
# silently merged.
duplicates = sorted(key for key in tree if isinstance(tree[key], list))
assert duplicates == ['dust2_new.MidDoors'], duplicates
folded = {}
for key in tree:
    folded.setdefault(key.casefold(), key)
assert len(folded) == 20, 'two names now differ only by case'


def definition(key: str) -> dict:
    value = tree[folded[key.casefold()]] if key.casefold() in folded else None
    assert value is not None, key
    return as_list(value)[0]


def waves_of(block: dict) -> list[str]:
    found = [wave for wave in as_list(block.get('wave'))]
    for group in as_list(block.get('rndwave')):
        found.extend(as_list(group.get('wave')))
    return found


def loops_of(block: dict) -> list[dict]:
    return [{'volume': item.get('volume'), 'pitch': item.get('pitch'),
             'soundlevel': item.get('soundlevel'), 'origin': item.get('origin'),
             'position': item.get('position'), 'waves': waves_of(item)} for item in
            as_list(block.get('playlooping'))]


def randoms_of(block: dict) -> list[dict]:
    return [{'time': item.get('time'), 'volume': item.get('volume'), 'pitch': item.get('pitch'),
             'soundlevel': item.get('soundlevel'), 'origin': item.get('origin'),
             'position': item.get('position'), 'waves': waves_of(item)} for item in
            as_list(block.get('playrandom'))]


used = {}
for written in names_written:
    key = folded[written.casefold()]
    chain, body = [key], definition(key)
    while 'playsoundscape' in body:
        parent = as_list(body['playsoundscape'])[0]['name']
        chain.append(folded[parent.casefold()])
        body = definition(parent)
        assert len(chain) <= 4, chain
    # The contents are the block's own plus every ancestor's, nearest first.
    loops = [loop for name in chain for loop in loops_of(definition(name))]
    randoms = [random for name in chain for random in randoms_of(definition(name))]
    used[key] = {'asWritten': written, 'dsp': int(definition(key).get('dsp', 0)),
                 'chain': chain, 'ownLoops': len(loops_of(definition(key))),
                 'ownRandoms': len(randoms_of(definition(key))),
                 'loops': loops, 'randoms': randoms}
assert len(used) == 18, sorted(used)
# The nine inheriting names all build on one of two soundscapes that no entity names itself, so they
# are read too - a chain has to end somewhere in the table the runtime holds.
assert {link for row in used.values() for link in row['chain'][1:]} == \
    {'dust2_new.outdoors', 'dust2_new.indoors'}
bases = {}
for name in ('dust2_new.outdoors', 'dust2_new.indoors'):
    body = definition(name)
    assert 'playsoundscape' not in body, name
    bases[name] = {'dsp': int(body.get('dsp', 0)), 'chain': [folded[name.casefold()]],
                   'ownLoops': len(loops_of(body)), 'ownRandoms': len(randoms_of(body)),
                   'loops': loops_of(body), 'randoms': randoms_of(body)}
assert {name: (row['ownLoops'], row['ownRandoms']) for name, row in bases.items()} == \
    {'dust2_new.outdoors': (2, 2), 'dust2_new.indoors': (2, 1)}, bases
assert used['dust2_new.ABomb']['ownLoops'] == 1 and used['dust2_new.ABomb']['ownRandoms'] == 2
assert used['dust2_new.lowertunnel']['ownLoops'] == 4 and used['dust2_new.lowertunnel']['ownRandoms'] == 0
assert used['dust2_new.LongTunnel']['chain'] == ['dust2_new.LongTunnel'], 'the tunnel is standalone'
assert used['dust2_new.ABomb']['chain'] == ['dust2_new.ABomb', 'dust2_new.outdoors']
assert used['dust2_new.ctstart']['chain'] == ['dust2_new.ctstart', 'dust2_new.indoors']
assert sorted({row['dsp'] for row in used.values()}) == [0, 5, 7, 9, 17, 18, 20, 21, 22], \
    sorted({row['dsp'] for row in used.values()})
# The first block wins for the repeated name, and the two differ, so it matters.
both = as_list(tree['dust2_new.MidDoors'])
assert len(both) == 2 and both[0] != both[1], 'the repeated name is no longer two blocks'
assert definition('dust2_new.middoors') == both[0], \
    'the repeated name no longer resolves to the block written first'

# Every wave the map's soundscapes reach is a real file in the shipped pak. A leading `~` means the
# engine resolves the name through a soundscript; the file is the same either way.
wave_rows = []
seen = set()
for row in used.values():
    for group in row['loops'] + row['randoms']:
        for wave in group['waves']:
            if wave in seen:
                continue
            seen.add(wave)
            path = wave.replace('\\', '/')
            soundscript = path.startswith('~')
            plain = path[1:] if soundscript else path
            key = 'sound/' + plain
            entry = entries.get(key)
            assert entry is not None, f'{key} is not in the pak ({wave})'
            wave_rows.append({'wave': wave, 'path': key, 'soundscript': soundscript,
                              'bytes': entry['bytes'], 'crc32': entry['crc32']})
assert len(wave_rows) == len(seen) == 66, len(wave_rows)
assert sum(1 for row in wave_rows if row['soundscript']) == 15, 'the soundscript count moved'

# ---------------------------------------------------------------------------------------------
# Which files the client loads, and what the manifest states about DSP and sound levels.
# ---------------------------------------------------------------------------------------------
manifest_bytes = payload(MANIFEST)
manifest_text = manifest_bytes.decode('latin1')
manifest_tree = build(tokenise(manifest_text))
assert list(manifest_tree) == ['soundscaples_manifest'], list(manifest_tree)
manifest_files = [name for name in
                  as_list(manifest_tree['soundscaples_manifest'].get('file'))]
# The key above is spelled with a typo in the shipped file, and its first `file` entry is the one
# this map's definitions live in - both are stated rather than corrected.
assert 'scripts/soundscapes_dust2_new.vsc' in manifest_files
# One entry in the shipped file is commented out, so the list the client walks is one shorter than
# the number of `"file"` lines in the file.
commented_out = re.findall(r'//\s*"file"\s+"([^"]+)"', manifest_text)
assert len(manifest_files) == 42, len(manifest_files)
assert commented_out == ['scripts/soundscapes_nuke.vsc'], commented_out
missing_manifest = sorted(name for name in manifest_files
                          if entries.get(name.replace('\\', '/')) is None)
# Both tables are stated in the file's comments, so they are read line by line: a pattern that is
# allowed to run past a line ending would swallow the `//` of the next entry.
dsp_presets = {}
sound_levels = {}
attentions = {}
for line in manifest_text.splitlines():
    preset = re.match(r'\s*//\s*(\d+)\s*:\s*"([^"]+)"', line)
    if preset:
        dsp_presets[int(preset.group(1))] = preset.group(2)
        continue
    level = re.match(r'\s*//\s*(SNDLVL_\w+)\s*=\s*(\d+)\s*,?\s*(?://\s*([\d.]+))?', line)
    if level:
        sound_levels[level.group(1)] = {'db': int(level.group(2)),
                                        'attenuation': float(level.group(3))
                                        if level.group(3) else None}
        continue
    attention = re.match(r'\s*//\s*(ATTN_[A-Z]+)\s+([\d.]+)f', line)
    if attention:
        attentions[attention.group(1)] = float(attention.group(2))
assert len(dsp_presets) == 29, len(dsp_presets)
assert dsp_presets[0] == 'Normal (off)' and dsp_presets[5] == 'Tunnel Small'
assert dsp_presets[9] == 'Chamber Medium' and dsp_presets[22] == 'Big 3'
assert len(sound_levels) == 21, len(sound_levels)
assert sound_levels['SNDLVL_75dB'] == {'db': 75, 'attenuation': 0.8}
assert sound_levels['SNDLVL_70dB'] == {'db': 70, 'attenuation': 1.0}
assert sound_levels['SNDLVL_NORM'] == {'db': 75, 'attenuation': None}
assert sound_levels['SNDLVL_95dB']['db'] == 95
assert attentions == {'ATTN_NONE': 0.0, 'ATTN_NORM': 0.8, 'ATTN_IDLE': 2.0, 'ATTN_STATIC': 1.25,
                      'ATTN_RICOCHET': 1.5, 'ATTN_GUNFIRE': 0.27}, attentions

# The manifest's comments are documentation. The build carries its own table of sound levels, and
# reading it is the point of this block: thirty entries of `{ int dB; const char *name; }` at
# 0x19ce6c0, in `.data.rel.ro`, each name reached through its own relocation. Two accessors point at
# it and no more: a name-to-dB lookup (0xa14c40, which also takes `SNDLVL_<n>dB` as text) and two
# dB-to-name lookups (0xa14dd0, 0xa157f0).
LEVEL_TABLE, LEVEL_STRIDE, LEVEL_COUNT = 0x19CE6C0, 0x10, 30
assert server.lea_sites(LEVEL_TABLE) == [0xa14c8c, 0xa14df2, 0xa15852], server.lea_sites(LEVEL_TABLE)
levels_compiled = {}
for step in range(LEVEL_COUNT):
    where = LEVEL_TABLE + step * LEVEL_STRIDE
    level_db = struct.unpack_from('<i', server.data, server.offset_of(where))[0]
    level_name = server.string_at(server.relative[where + 8])
    assert level_name is not None and level_name.startswith('SNDLVL_'), (hex(where), level_name)
    # Most of the names spell their own dB out, so the table can be checked against itself.
    spelled = re.fullmatch(r'SNDLVL_(\d+)dB', level_name)
    if spelled:
        assert level_db == int(spelled.group(1)), (level_name, level_db)
    assert level_name not in levels_compiled, level_name
    levels_compiled[level_name] = level_db
assert len(levels_compiled) == LEVEL_COUNT, len(levels_compiled)
assert levels_compiled['SNDLVL_NONE'] == 0 and levels_compiled['SNDLVL_75dB'] == 75
assert levels_compiled['SNDLVL_70dB'] == 70 and levels_compiled['SNDLVL_GUNFIRE'] == 140
assert levels_compiled['SNDLVL_180dB'] == 180 and levels_compiled['SNDLVL_NORM'] == 75
binary_index.assert_bytes(server, {
    0xa14c40: ('4885ff', 'test rdi, rdi  (the name lookup)'),
    0xa14c43: ('b84b000000', 'mov eax, 0x4b  (no name at all means 75 dB)'),
    0xa14c73: ('83fb1e', 'cmp ebx, 0x1e  (thirty entries)'),
    0xa14c7c: ('4983c410', 'add r12, 0x10  (they are 0x10 bytes apart)'),
    0xa14dff: ('488b440208', 'mov rax, [rdx + rax + 8]  (the name sits at +8)'),
})
# The two lists disagree, and that disagreement is the finding. The comment says 60 dB for
# `SNDLVL_TALKING`; the table the build itself carries says 80. The comment also prints an
# attenuation column, and **no table in either binary carries one**: the only readers of the
# compiled table turn a dB into a name or back, so that column is documentation, not data.
level_conflicts = {name: {'manifestComment': row['db'], 'build': levels_compiled[name]}
                   for name, row in sound_levels.items() if name in levels_compiled
                   and row['db'] != levels_compiled[name]}
assert level_conflicts == {'SNDLVL_TALKING': {'manifestComment': 60, 'build': 80}}, level_conflicts
level_missing = sorted(set(sound_levels) - set(levels_compiled))

# The client opens exactly that file. Read as bytes: the two `lea`s that name it, the interface
# lookup on `GAME`, and the `"file"` key it reads out of every entry.
binary_index.assert_lea_string(client, 0x86ee39, MANIFEST)
binary_index.assert_lea_string(client, 0x86eec7, MANIFEST)
binary_index.assert_lea_string(client, 0x86eeb8, 'GAME')
assert client.callers(0x86ec70).count(0x86ef0f) == 1, 'the per-file loader call moved'
binary_index.assert_bytes(client, {
    0x86edf0: ('554889e5415741564155', 'push rbp; mov rbp, rsp; push r15/r14/r13'),
    0x86ee04: ('c7870c01000000', 'mov dword [rdi + 0x10c], 0  (the system starts empty)'),
    0x86ee2b: ('bf58000000e87bf3ad00', 'operator new(0x58) for the KeyValues root'),
    0x86eee2: ('e899d4ad00', 'the manifest root is walked with GetFirstSubKey'),
})
# The system's own table, found by the name its type information carries rather than by offsets.
system_head, system_entries = client.vtable_named('C_SoundscapeSystem')
assert (system_head, len(system_entries)) == (0x20c0f18, 17), (hex(system_head),
                                                              len(system_entries))
assert client.function_of(system_entries[1])[0] == 0x86edf0, 'the loader is no longer slot 1'
parsers = {
    'playlooping': sorted({client.function_of(site)[0]
                           for site in client.lea_sites_of_string(b'playlooping')}),
    'playrandom': sorted({client.function_of(site)[0]
                          for site in client.lea_sites_of_string(b'playrandom')}),
    'rndwave': sorted({client.function_of(site)[0]
                       for site in client.lea_sites_of_string(b'rndwave')}),
}
assert parsers['playlooping'] == [0x86dcc0, 0x870250], parsers
assert parsers['playrandom'] == [0x86dcc0, 0x870250], parsers
assert parsers['rndwave'] == [0x86dc00, 0x86fc20], parsers
binary_index.assert_lea_string(client, 0x86dd03, 'playlooping')
binary_index.assert_lea_string(client, 0x86dd1e, 'playrandom')
binary_index.assert_lea_string(client, 0x86dc48, 'rndwave')
binary_index.assert_bytes(client, {
    0x86dcc0: ('554889e541544989', 'the sub-key walk that sorts playlooping from playrandom'),
    0x86dc00: ('554889e541554989', 'the walk that fills one block\'s wave list'),
    0x86dc7c: ('e81f22ae004c89ef4889', 'call GetString(sub-key, "wave", ...)'),
})

# ---------------------------------------------------------------------------------------------
# Which soundscape a listener is in, and where its fields sit, out of the server.
# ---------------------------------------------------------------------------------------------
# The class's own datamap entries, around the one naming the soundscape, each holding the field, the
# offset, the type code and the key that reaches it.
DATAMAP_ANCHOR = 0x1c18638
EXPECTED_FIELDS = [(-1, 'm_flRadius', 0x4f8, 'radius'),
                   (0, 'm_soundscapeName', 0x500, None),
                   (2, 'm_positionNames[0]', 0x510, 'position0'),
                   (9, 'm_positionNames[7]', 0x548, 'position7'),
                   (10, 'm_bDisabled', 0x554, 'StartDisabled')]
datamap_rows = []
for step, field, offset, key in EXPECTED_FIELDS:
    entry = DATAMAP_ANCHOR + 0x68 * step
    name_at = server.relative.get(entry)
    assert name_at is not None and server.string_at(name_at) == field, \
        (field, hex(entry), server.string_at(name_at) if name_at else None)
    packed = struct.unpack_from('<Q', server.data, server.offset_of(entry + 8))[0]
    assert packed & 0xffffffff == offset, (field, hex(packed & 0xffffffff), hex(offset))
    key_at = server.relative.get(entry + 0x10)
    assert (server.string_at(key_at) if key_at else None) == key, (field, key)
    datamap_rows.append({'field': field, 'offset': offset, 'typeCode': packed >> 32,
                         'key': key})

# The update that decides who is in what, a virtual of the system's own table.
system_head_server, system_entries_server = server.vtable_named('CSoundscapeSystem')
assert (system_head_server, len(system_entries_server)) == (0x19cea38, 18), \
    (hex(system_head_server), len(system_entries_server))
update_at = system_entries_server[5]
assert server.function_of(update_at)[0] == 0xa19fe0, hex(update_at)
binary_index.assert_bytes(server, {
    # The sphere is compared squared, so no root is taken.
    0xa1a247: ('f30f1080f8040000', 'movss xmm0, [rax + m_flRadius]'),
    0xa1a256: ('0f28d0f30f59d0', 'movaps xmm2, xmm0; mulss xmm2, xmm0  (radius squared)'),
    0xa1a260: ('f30f119534bfffff', 'movss [rbp - 0x40cc], xmm2  (kept for the compare)'),
    0xa1a2ed: ('e84ef46c00', 'call the distance-squared between two points'),
    0xa1a2f2: ('f30f108d34bfffff', 'movss xmm1, [rbp - 0x40cc]  (radius squared)'),
    0xa1a2fa: ('0f2fc8', 'comiss xmm1, xmm0'),
    0xa1a2fd: ('76a1', 'jbe  (radius squared <= distance squared leaves this player out)'),
    0xa1a314: ('6683049801', 'add word [rax + rbx*4], 1  (one more soundscape on this player)'),
    0xa1a326: ('e8d5090000', 'call 0xa1ad00  (the soundscape joins the player\'s list)'),
})

# ---------------------------------------------------------------------------------------------
# How a chosen soundscape reaches a listener, and what picks it out of several candidates.
# ---------------------------------------------------------------------------------------------
# The engine networks one audio block per player: eight sound positions, the soundscape's index, a
# bitmask and an entity index. The client keeps the block's own prop names - it needs them for the
# local player - and the server registers the same index field on its class table, at the same
# place inside the block.
AUDIO_BLOCK = ['m_audio.localSound[7]', 'm_audio.soundscapeIndex', 'm_audio.localBits',
               'm_audio.entIndex', 'DT_Local']
for text_ in AUDIO_BLOCK:
    assert client.data.find(text_.encode() + b'\x00') >= 0, text_
INDEX_SLOT = 0x1c001d8
assert server.relative[INDEX_SLOT] == server.address_of(server.data.find(b'soundscapeIndex\x00'))
index_entry = struct.unpack_from('<Q', server.data, server.offset_of(INDEX_SLOT + 8))[0]
assert index_entry == 0x00020001_00000068, hex(index_entry)
# The fields around it on the same table, which is what says the eight positions and the two
# trailing ints belong with it.
neighbours = {}
for step in (-1, 1, 2):
    where = INDEX_SLOT + 0x68 * step
    neighbours[server.string_at(server.relative[where])] = \
        struct.unpack_from('<I', server.data, server.offset_of(where + 8))[0]
assert neighbours == {'localSound': 0x8, 'localBits': 0x6c, 'entIndex': 0x70}, neighbours

# The commit: one soundscape entity and one player's audio block, and the entity's own index lands
# in the block's `soundscapeIndex`. Its eight `m_positionNames` are resolved to positions and land
# in the block's eight sound positions.
COMMIT_AT = 0xa16ca0
assert server.function_of(COMMIT_AT)[0] == COMMIT_AT
binary_index.assert_bytes(server, {
    0xa16cb7: ('8bb708050000', 'mov esi, [rdi + 0x508]  (the entity\'s own soundscape index)'),
    0xa16cdb: ('488d3db6d09d00', 'lea rdi, [rip + ...]  (the warning below)'),
    0xa16cf0: ('448ba30c050000', 'mov r12d, [rbx + 0x50c]  (the entity index)'),
    0xa16d0b: ('45896570', 'mov [r13 + 0x70], r12d'),
    0xa16d0f: ('448ba308050000', 'mov r12d, [rbx + 0x508]'),
    0xa16d16: ('453b65687412', 'cmp r12d, [r13 + 0x68]  (is it already this one?)'),
    0xa16d2a: ('45896568', 'mov [r13 + 0x68], r12d  (the player\'s soundscapeIndex)'),
    0xa16dbe: ('4a83bcfb10050000', 'cmp qword [rbx + r15*8 + 0x510], 0  (m_positionNames[i])'),
    0xa16d7d: ('f3410f108078020000', 'movss xmm0, [r8 + 0x278]  (the named position)'),
})
# The warning ends in a newline, so it is compared as bytes rather than read as a C string.
INVALID_WARNING = (b'Setting invalid soundscape, %s, as the active soundscape. There is probably '
                   b'no script entry matching this name. BUG THIS!\n')
warning_at = server.offset_of(server.lea_target(0xa16cdb))
assert server.data[warning_at:warning_at + len(INVALID_WARNING)] == INVALID_WARNING

# The guard on that commit. It tests two of the walk's own stack slots - a float at `[rbp - 0x74]`
# against the constant 1.0, then a byte at `[rbp - 0x69]` against zero - and **no instruction
# writes either slot**. That is not a reading that gave up part way: the walk's whole 0xe9e bytes
# decode to 772 instructions that cover it exactly, none of the stores among them lands on those
# bytes (a scan that follows frame-pointer aliases and counts a wide store by its own width),
# neither slot is ever address-taken, no branch reaches the walk's body from outside it, and a scan
# of all 60282 functions in the binary finds no store there either. So what the guard tests is not
# established by reading this function, and the reading this report used to carry - that the walk
# commits "the entity whose own score is exactly 1.0" - does not follow from it. The 1.0 and the
# two compares stand as reads; the meaning of what is compared does not.
PICK_AT = 0xa16eb0
WALK = (0xA16EB0, 0xE9E)
assert server.function_of(PICK_AT) == WALK, server.function_of(PICK_AT)
one = struct.unpack('<f', server.bytes_at(0x139fc14, 4))[0]
assert one == 1.0, one
binary_index.assert_bytes(server, {
    0xa16eb0: ('554889e5415741564155', 'push rbp; mov rbp, rsp; push r15/r14/r13  (a frame of its own)'),
    0xa173ca: ('f30f100542889800', 'movss xmm0, [rip + 0x988842]  (the constant 1.0)'),
    0xa173d2: ('0f2f458c', 'comiss xmm0, [rbp - 0x74]  (against one of its own slots)'),
    0xa173dc: ('807d9700', 'cmp byte [rbp - 0x69], 0  (and a second one)'),
    0xa173f4: ('e8a7f8ffff', 'call the commit above'),
})
assert server.frame_stores(*WALK, -0x74) == [], 'something writes the slot the guard reads'
assert server.frame_stores(*WALK, -0x69) == []
# The scan answers rather than stays silent: the same function does write `[rbp - 0x128]`, and the
# function that calls it does write its own `[rbp - 0x74]`.
assert len(server.frame_stores(*WALK, -0x128)) >= 4
assert server.callers(PICK_AT) == [0xa192A1, 0xA19302], server.callers(PICK_AT)

# The identity of all this, by table membership and by the class names the build registers - which
# is what says these functions are the soundscape system's and not merely nearby.
server_system_head, server_system_slots = server.vtable_named('CSoundscapeSystem')
assert server_system_head == 0x19cea38 and len(server_system_slots) == 18
assert server_system_slots[5] == 0xa19fe0, 'the gate is no longer slot 5 of CSoundscapeSystem'
assert server_system_slots[15] == 0xa190c0, 'the driver is no longer slot 15 of CSoundscapeSystem'
assert server.callers(0xa19fe0) == [] and server.callers(0xa190c0) == [], 'both are virtual'
server_trigger_head, server_trigger_slots = server.vtable_named('CTriggerSoundscape')
assert server_trigger_head == 0x1a96620 and len(server_trigger_slots) == 216
assert server_trigger_slots[105] == 0xa18050 and server_trigger_slots[103] == 0xa18400, \
    'the two trigger paths are no longer slots 105 and 103 of CTriggerSoundscape'
for where, name in ((0xa166a4, 'CEnvSoundscape'), (0xa16580, 'CEnvSoundscapeProxy'),
                    (0xa17db0, 'CEnvSoundscapeTriggerable'), (0xa181d4, 'CTriggerSoundscape')):
    binary_index.assert_lea_string(server, where, name)

# The walk is handed a listener record that the *caller* builds on its own stack, which is what makes
# the walk's second argument readable at all: the caller clears the record's byte, calls, and acts
# on that byte afterwards. So the walk is asked once per (soundscape, listener), and what the caller
# consumes is whether this soundscape became that listener's active one.
CALLER_AT = 0xa190c0
caller_start, caller_length = server.function_of(CALLER_AT)
binary_index.assert_bytes(server, {
    0xa191cb: ('c7458c00000000', 'mov dword [rbp - 0x74], 0  (a counter of its own, cf. above)'),
    0xa19243: ('4889df48895da0', 'mov rdi, rbx; mov [rbp - 0x60], rbx  (record.pEnt = the player)'),
    0xa19254: ('ff9230040000', 'call [rdx + 0x430]  (the player hands back its origin)'),
    0xa19261: ('c645c400', 'mov byte [rbp - 0x3c], 0  (record.bActive, cleared before the call)'),
    0xa1929b: ('4c89ee4889c7', 'mov rsi, r13; mov rdi, rax  (the record and the soundscape)'),
    0xa192a1: ('e80adcffff', 'call the walk above'),
    0xa19302: ('e8a9dbffff', 'call the walk above, a second time'),
})
# The record the caller builds, and what the walk does to it: pEnt at +0, the active soundscape at
# +8, a float at +0x10, a float at +0x1c, a counter at +0x20 and the flag at +0x24.
LISTENER_RECORD = {'at': 'rbp - 0x60 in the caller', 'ent': 0x0, 'active': 0x8,
                   'floatAt': 0x10, 'float2At': 0x1c, 'counter': 0x20, 'activeFlag': 0x24}
binary_index.assert_bytes(server, {
    0xa16f05: ('f3410f105c2410', 'movss xmm3, [r12 + 0x10]  (the record\'s float)'),
    0xa17401: ('49895c2408', 'mov [r12 + 8], rbx  (this soundscape is now the active one)'),
    0xa17406: ('41c644242401', 'mov byte [r12 + 0x24], 1  (and the flag the caller acts on)'),
    0xa1740c: ('f3410f1174241c', 'movss [r12 + 0x1c], xmm6'),
    0xa17240: ('418344242001', 'add dword [r12 + 0x20], 1'),
    0xa17420: ('49c744240800000000', 'mov qword [r12 + 8], 0  (or clear it, when it is already this one)'),
})

# The engine's own debug wording says the same thing the code does: one soundscape is active, and
# a soundscape can be in range without being it.
DEBUG_HELP = ('When on, draws lines to all env_soundscape entities. Green lines show the active '
              'soundscape, red lines show soundscapes that aren\'t in range, and white lines show '
              'soundscapes that are in range, but not the active soundscape.')
assert server.data.find(DEBUG_HELP.encode()) >= 0, 'the soundscape_debug help text moved'

report = {
    'format': 'source-soundscapes-v1',
    'sources': {'sourceBspSha256': sha(raw), 'client64Sha256': sha(CLIENT64.read_bytes()),
                'server64Sha256': sha(SERVER64.read_bytes()),
                'definitionSha256': sha(definition_bytes), 'definitionCrc32':
                    entries[DEFINITION]['crc32'], 'definitionBytes': len(definition_bytes),
                'manifestSha256': sha(manifest_bytes), 'manifestCrc32': entries[MANIFEST]['crc32'],
                'manifestBytes': len(manifest_bytes), 'pakEntries': index_info['entries']},
    'map': {'entities': len(soundscapes), 'names': len(names_written), 'disabled': 0,
            'radii': {'distinct': len(radii), 'min': radii[0], 'max': radii[-1]},
            'soundscapeSet': soundscapes},
    'definitions': {'file': DEFINITION, 'blocks': len(tree), 'duplicates': duplicates,
                    'reading': ('The engine looks a sub-key up in order and stops at the first '
                                'match, so where a name is written twice the first block is the '
                                'one that is used. The names are compared case-insensitively: the '
                                'map writes `dust2_new.tstart` and the file `dust2_new.TStart`.'),
                    'used': used, 'bases': bases},
    'manifest': {'file': MANIFEST, 'key': 'soundscaples_manifest',
                 'keyNote': ('The shipped file spells its own root key with a typo; the client '
                             'asks for that spelling, so it is recorded as it is.'),
                 'files': manifest_files, 'notShipped': missing_manifest,
                 'commentedOut': commented_out,
                 'dspPresets': {str(k): v for k, v in sorted(dsp_presets.items())},
                 'soundLevels': sound_levels, 'attentions': attentions},
    'soundLevels': {'tableAt': hex(LEVEL_TABLE), 'stride': LEVEL_STRIDE, 'entries': LEVEL_COUNT,
                    'compiled': levels_compiled,
                    'accessors': {'nameToDB': '0xa14c40', 'dbToName': ['0xa14dd0', '0xa157f0'],
                                  'reading': ('The name lookup returns a dB and falls back to 75; it '
                                              'also accepts `SNDLVL_<n>dB` as text. The two other '
                                              'readers turn a dB back into a name. Those three are '
                                              'the table\'s only readers.')},
                    'reading': ('A sound level is a decibel number, not an index into a tuning '
                                'table: thirty entries of `{ int dB; const char *name; }` in the '
                                'build\'s own `.data.rel.ro`, and twenty-four of the names spell '
                                'their own number out, so the table checks against itself.'),
                    'conflicts': level_conflicts,
                    'missingFromBuild': level_missing,
                    'conflictReading': ('The manifest\'s comments are documentation and the table is '
                                        'what the build runs, and the two disagree on exactly one '
                                        'level. The comments also print an attenuation column, and '
                                        '**no table in either binary carries one** - every reader '
                                        'of the compiled table turns a dB into a name or back - so '
                                        'that column is documentation too.')},
    'client': {'tableAt': hex(system_head), 'entries': len(system_entries),
               'loads': ('Its Init opens `scripts/soundscapes_manifest.txt` through the `GAME` '
                         'file-system interface and reads every `"file"` key, so the set of '
                         'definition files is the engine\'s own list, not the map\'s.'),
               'audioBlock': {'props': AUDIO_BLOCK,
                              'reading': ('Each player is sent one audio block: eight world '
                                          'positions, then the soundscape index, a bitmask and an '
                                          'entity index. The client holds the block\'s own prop '
                                          'names for the local player, and the server registers '
                                          'the index at 0x68 inside it.')},
               'parsers': parsers,
               'parsing': ('The sub-key walk compares each key name against `playlooping` and '
                           '`playrandom`; the block walk looks for `rndwave` inside them and reads '
                           'each sub-key\'s `"wave"`. A `~` in front of a wave means the name is '
                           'resolved through a soundscript rather than opened as a file - the file '
                           'behind it is in the pak either way.')},
    'server': {'tableAt': hex(system_head_server), 'entries': len(system_entries_server),
               'updateAt': hex(update_at), 'datamap': datamap_rows,
               'candidateRule': ('A soundscape is a candidate for a player when the player is '
                                 'strictly inside its sphere: `radius * radius > distanceSquared`, '
                                 'radii are kept squared and no root is taken. Each candidate is '
                                 'added to that player\'s list and a per-player counter is bumped.'),
               'audioIndex': {'slot': hex(INDEX_SLOT), 'offset': 0x68, 'typeCode': 0x00020001,
                              'neighbours': neighbours},
               'commit': {'at': hex(COMMIT_AT),
                          'writes': ('`soundscapeIndex` from the entity\'s own index (0x508) and '
                                     '`entIndex` from 0x50c, both only when they differ from what '
                                     'the block already holds (0x68, 0x70), and up to eight '
                                     '`localSound` positions resolved from the entity\'s '
                                     '`m_positionNames[0..7]` (0x510..0x548).'),
                          'warning': ('When the entity\'s index is not one the system holds it '
                                      'warns with `Setting invalid soundscape, %s, as the active '
                                      'soundscape...`, naming it from the entity\'s '
                                      '`m_soundscapeName`.'),
                          'paths': ['the system\'s own walk (0xa16eb0), asked from slot 15 of '
                                    'CSoundscapeSystem (0xa190c0)',
                                    'the trigger\'s touch handler (0xa18050, slot 105 of '
                                    'CTriggerSoundscape)',
                                    'the trigger\'s second path (0xa18400, slot 103 of '
                                    'CTriggerSoundscape)'],
                          'callers': [hex(x) for x in server.callers(COMMIT_AT)]},
               'pick': {'at': hex(PICK_AT),
                        'frame': {'start': hex(WALK[0]), 'length': hex(WALK[1]),
                                  'instructions': 772, 'covers': 'exactly'},
                        'reads': ('`movss xmm0, [0x139fc14]` (a `.rodata` word holding 1.0) then '
                                  '`comiss xmm0, [rbp - 0x74]`, and `cmp byte [rbp - 0x69], 0`; the '
                                  'commit is called only when both hold (0xa173ca, 0xa173d2, '
                                  '0xa173dc, 0xa173f4).'),
                        'guardSlotsWritten': False,
                        'guardProof': ('Neither slot is written. The walk\'s whole 0xe9e bytes '
                                       'decode to 772 instructions covering it exactly; no store '
                                       'among them lands on those bytes, counted by its own width '
                                       'and with frame-pointer aliases followed; neither slot is '
                                       'address-taken; no branch reaches the walk\'s body from '
                                       'outside it; and a scan of all 60282 functions in the binary '
                                       'finds no store there either. The probe asserts the empty '
                                       'answer and, next to it, the non-empty answers for '
                                       '[rbp - 0x128] (written four times by the walk) and for the '
                                       'caller\'s own [rbp - 0x74] (written once) - so the scan '
                                       'answers rather than stays silent.'),
                        'open': ('**The reading this report used to carry here - that the walk '
                                 'commits "the entity whose own score is exactly 1.0" - is '
                                 'withdrawn: it does not follow from a comparison whose slot nothing '
                                 'writes.** What stands is the shape: the commit sits behind those '
                                 'two compares, and the walk is what reaches it for a map whose '
                                 'soundscapes are plain `env_soundscape` entities.'),
                        'listenerRecord': LISTENER_RECORD,
                        'listenerReading': ('The walk\'s second argument is a record the caller '
                                            'builds on its own stack, so its layout is readable '
                                            'from the caller: the player entity at +0, the active '
                                            'soundscape at +8, a float at +0x10, a float at +0x1c, '
                                            'a counter at +0x20 and the flag at +0x24. The caller '
                                            'clears the flag, calls, and acts on it afterwards - so '
                                            'the walk is asked once per (soundscape, player) and '
                                            'what the caller consumes is whether this soundscape '
                                            'became that player\'s active one.')},
               'identity': {'systemTable': hex(server_system_head),
                            'systemSlots': len(server_system_slots),
                            'gateSlot': 5, 'driverSlot': 15,
                            'triggerTable': hex(server_trigger_head),
                            'triggerSlots': len(server_trigger_slots),
                            'triggerTouchSlot': 105, 'triggerSecondSlot': 103,
                            'reading': ('Functions are placed by the table they sit in and by the '
                                        'class names the build registers, not by proximity: the '
                                        'gate is slot 5 of CSoundscapeSystem and the driver that '
                                        'asks the walk is slot 15 of the same table, while the two '
                                        'other paths to the commit are slots 105 and 103 of '
                                        'CTriggerSoundscape. Neither the walk nor the commit is in '
                                        'any table - both are the system\'s own helpers.')}},
    'waves': wave_rows,
    'boundary': ('The material is read and so is the gate, but the scale is not, and the choice is '
                 'now known to be *open* rather than merely unread. What a listener is sent is read: '
                 'one audio block holding the soundscape\'s index, its entity, a bitmask and up to '
                 'eight positions (0xa16ca0). How a sound is picked out of several is read only as '
                 'far as the two compares that guard that call (0xa173d2, 0xa173dc) - and the slot '
                 'the first of them reads is written by nothing in its own function, by nothing '
                 'that reaches that function, and by nothing anywhere in the binary, so what the '
                 'guard tests is **not established**, and nothing here decides between two '
                 'soundscapes that both contain the listener. Nor is how `soundlevel` becomes an '
                 'audible distance: the build\'s own table of thirty sound levels is read and in '
                 'this report, and so is the fact that the manifest\'s comments disagree with it, '
                 'but the comments\' attenuation column is carried by no table in either binary and '
                 'the arithmetic that turns a level into a radius is not read. Nor is what `dsp` '
                 'does beyond its preset name. So nothing is played from this report: it states the '
                 'material, the gate and the two compares, not the mix.'),
}
OUT.write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n')
print(json.dumps({'format': report['format'], 'entities': len(soundscapes),
                  'names': len(names_written), 'blocks': len(tree),
                  'duplicates': duplicates, 'waves': len(wave_rows),
                  'soundscriptWaves': sum(1 for row in wave_rows if row['soundscript']),
                  'dsp': sorted({row['dsp'] for row in used.values()}),
                  'manifestFiles': len(manifest_files),
                  'chains': {key: row['chain'] for key, row in sorted(used.items())}},
                 ensure_ascii=False, indent=1))
