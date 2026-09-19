"""Stage Dust2's soundscapes: the table the runtime reads, generated from the probe's own report.

`scripts/probe-source-soundscapes.py` reads the map's 57 `env_soundscape` entities out of the frozen
BSP (twice, against the reviewed export), the definitions they name out of the shipped pak, and the
engine's own gate on both sides. This script copies those read numbers into
`game/source-soundscape-data.ts`, and refuses to write anything unless the report still carries the
numbers the runtime will act on - so a change to the probe's reading cannot become a change to the
game without failing here first.
"""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'research/source-soundscapes.json'
TABLE = ROOT / 'game/source-soundscape-data.ts'
BSP_SHA = 'b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc'

report = json.loads(REPORT.read_text())
assert report['format'] == 'source-soundscapes-v1', report['format']
assert report['sources']['sourceBspSha256'] == BSP_SHA
entities = report['map']['soundscapeSet']
assert len(entities) == 57, len(entities)
assert report['map']['names'] == 18 and report['map']['disabled'] == 0
assert report['map']['radii'] == {'distinct': 40, 'min': 76, 'max': 478}, report['map']['radii']
assert len({row['hammerId'] for row in entities}) == 57, 'an entity lost its own identity'
assert all(row['startDisabled'] == 0 for row in entities)
assert all(len(row['origin']) == 3 for row in entities)
assert all(row['radius'] > 0 for row in entities)

used = report['definitions']['used']
assert len(used) == 18, sorted(used)
assert report['definitions']['blocks'] == 20
assert report['definitions']['duplicates'] == ['dust2_new.MidDoors']
assert sorted({row['dsp'] for row in used.values()}) == [0, 5, 7, 9, 17, 18, 20, 21, 22]
# Every name the map writes resolves to a definition, and every chain link is itself defined.
folded = {name.casefold(): name for name in used}
for written in {row['name'] for row in entities}:
    assert written.casefold() in folded, written
# The two soundscapes the nine inheriting ones build on are not named by any entity themselves, so
# they are not in `used`; a chain link has to be one of them or another used name.
BASES = ['dust2_new.indoors', 'dust2_new.outdoors']
for name, row in used.items():
    assert row['chain'][0] == name and len(row['chain']) <= 4, (name, row['chain'])
    for link in row['chain']:
        assert link.casefold() in folded or link in BASES, (name, link)
    assert row['asWritten'].casefold() == name.casefold(), (name, row['asWritten'])
assert sum(1 for row in used.values() if len(row['chain']) > 1) == 15, 'the inheritance moved'
assert sorted(name for name, row in used.items() if len(row['chain']) == 1) == \
    ['dust2_new.LongTunnel', 'dust2_new.lowertunnel', 'dust2_new.topmidtunnel'], 'the standalone set'
assert sorted({link for row in used.values() for link in row['chain'][1:]}) == BASES, \
    sorted({link for row in used.values() for link in row['chain'][1:]})
assert all(item['waves'] for row in used.values() for item in row['loops'] + row['randoms']), \
    'a block stopped naming a wave'

waves = report['waves']
assert len(waves) == 66, len(waves)
assert sum(1 for row in waves if row['soundscript']) == 15
assert all(row['path'].startswith('sound/') for row in waves), 'a wave left the sound folder'
assert all(row['bytes'] > 0 for row in waves)

manifest = report['manifest']
assert manifest['key'] == 'soundscaples_manifest', manifest['key']
assert 'scripts/soundscapes_dust2_new.vsc' in manifest['files']
assert manifest['files'].count('scripts/soundscapes_dust2_new.vsc') == 1
assert manifest['notShipped'] == ['scripts/soundscapes_general.vsc',
                                  'scripts/soundscapes_tides.vsc'], manifest['notShipped']
assert len(manifest['dspPresets']) == 29 and manifest['dspPresets']['22'] == 'Big 3'
assert len(manifest['soundLevels']) == 21
assert manifest['soundLevels']['SNDLVL_75dB'] == {'db': 75, 'attenuation': 0.8}
assert manifest['attentions']['ATTN_NORM'] == 0.8

server = report['server']
assert server['tableAt'] == '0x19cea38' and server['updateAt'] == '0xa19fe0'
fields = {row['field']: row for row in server['datamap']}
assert fields['m_flRadius'] == {'field': 'm_flRadius', 'offset': 0x4f8,
                                'typeCode': 0x00060001, 'key': 'radius'}
assert fields['m_bDisabled']['offset'] == 0x554 and fields['m_bDisabled']['key'] == 'StartDisabled'
assert fields['m_soundscapeName']['offset'] == 0x500 and fields['m_soundscapeName']['key'] is None
client = report['client']
assert client['tableAt'] == '0x20c0f18' and client['entries'] == 17
assert client['parsers']['playlooping'] == [0x86dcc0, 0x870250]

# The table the runtime reads: the map's own numbers and the definitions' own numbers, copied
# verbatim. Nothing is derived, because the choice out of several containing spheres and how a
# sound level becomes a distance are not read (see the report's boundary).
staged_definitions = {}
for name, row in sorted(used.items()):
    staged_definitions[name] = {'asWritten': row['asWritten'], 'dsp': row['dsp'],
                                'chain': row['chain'], 'loops': row['loops'],
                                'randoms': row['randoms'], 'namedByMap': True}
for name, row in sorted(report['definitions']['bases'].items()):
    staged_definitions[name] = {'asWritten': name, 'dsp': row['dsp'], 'chain': row['chain'],
                                'loops': row['loops'], 'randoms': row['randoms'],
                                'namedByMap': False}
assert len(staged_definitions) == 20, sorted(staged_definitions)
assert sum(1 for row in staged_definitions.values() if row['namedByMap']) == 18
table = {
    'format': 'source-soundscape-data-v1',
    'metresPerSourceUnit': 0.0254,
    'definitions': staged_definitions,
    'entities': [{'hammerId': row['hammerId'], 'origin': row['origin'], 'radius': row['radius'],
                  'name': row['name']} for row in entities],
    'waves': [{'path': row['path'], 'soundscript': row['soundscript'], 'bytes': row['bytes'],
               'crc32': row['crc32']} for row in waves],
    'dspPresets': manifest['dspPresets'],
    'soundLevels': manifest['soundLevels'],
    'attentions': manifest['attentions'],
    'definitionsFile': 'scripts/soundscapes_dust2_new.vsc',
    'manifestFile': manifest['file'],
}
literal = json.dumps(table, ensure_ascii=False, separators=(',', ':'))
sources = {
    'source': 'research/source-soundscapes.json',
    'reportSha256': hashlib.sha256(REPORT.read_bytes()).hexdigest(),
    'sourceBspSha256': report['sources']['sourceBspSha256'],
    'client64Sha256': report['sources']['client64Sha256'],
    'server64Sha256': report['sources']['server64Sha256'],
    'definitionSha256': report['sources']['definitionSha256'],
    'manifestSha256': report['sources']['manifestSha256'],
}
contents = (
    '/** Dust2\'s own soundscapes, generated by `scripts/stage-source-soundscapes.py` from\n'
    ' * `research/source-soundscapes.json`. Do not edit: the probe reads the map twice, the shipped\n'
    ' * pak and both binaries, and this table is what it read. */\n'
    'export const SOURCE_SOUNDSCAPE_DATA = ' + literal + ' as const;\n\n'
    'export const SOURCE_SOUNDSCAPE_SOURCES = ' + json.dumps(sources, indent=2) + ' as const;\n')
TABLE.write_text(contents)
print(json.dumps({'table': str(TABLE), 'bytes': len(contents), 'entities': len(table['entities']),
                  'definitions': len(table['definitions']), 'waves': len(table['waves']),
                  'reportSha256': sources['reportSha256']}, indent=1))
