"""Stage Dust2's ropes: the table the runtime reads, generated from the probe's own report.

`scripts/probe-source-ropes.py` reads every rope out of the frozen BSP (twice, against the
reviewed export) and the class the client draws them with. This script copies the map's own
numbers into `game/source-ropes-data.ts`, and refuses to write anything unless the report still
carries the numbers the runtime will act on - so a change to the probe's reading cannot become a
change to the game without failing here first.
"""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'research/source-ropes.json'
TABLE = ROOT / 'game/source-ropes-data.ts'
BSP_SHA = 'b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc'

report = json.loads(REPORT.read_text())
assert report['format'] == 'source-ropes-v1', report['format']
assert report['sources']['sourceBspSha256'] == BSP_SHA
ropes = report['map']['ropeSet']
assert len(ropes) == 142, len(ropes)

# Only what the runtime acts on is copied, and each number is re-asserted here.
assert report['map']['classes'] == {'keyframe_rope': 109, 'move_rope': 33}
assert report['map']['materials'] == {'cable/nuke_cable': 142}
assert {row['subdiv'] for row in ropes} == {2}, 'the map no longer states one subdivision'
assert {row['textureScale'] for row in ropes} == {1.0}
assert {row['type'] for row in ropes} == {0}
assert {row['material'] for row in ropes} == {'cable/nuke_cable'}
assert {row['classname'] for row in ropes} == {'keyframe_rope', 'move_rope'}
assert len({row['hammerId'] for row in ropes}) == 142, 'a rope lost its own identity'
slacks = sorted({row['slack'] for row in ropes})
assert (slacks[0], slacks[-1], len(slacks)) == (25, 147, 39), slacks
widths = sorted({row['width'] for row in ropes})
assert (widths[0], widths[-1], len(widths)) == (0.7, 2.0, 12), widths
speeds = sorted({row['moveSpeed'] for row in ropes})
assert speeds == [64.0, 83.0], speeds
assert all(len(row['origin']) == 3 and len(row['angles']) == 3 for row in ropes)
assert all(row['nextKey'] is None or isinstance(row['nextKey'], str) for row in ropes)
assert sum(1 for row in ropes if row['nextKey']) == 120
assert sum(1 for row in ropes if row['positionInterpolator']) == 33

members = report['class']['members']
assert len(members) == 16
by_name = {row['name']: row for row in members}
for name in ('m_Width', 'm_Slack', 'm_RopeLength', 'm_Subdiv', 'm_TextureScale', 'm_nSegments',
             'm_RopeFlags', 'm_flScrollSpeed', 'm_bConstrainBetweenEndpoints'):
    assert name in by_name, name
assert by_name['m_Width']['offset'] == 0x12c0 and by_name['m_Slack']['offset'] == 0x12b0
assert by_name['m_Subdiv']['offset'] == 0x12a8 and by_name['m_nSegments']['offset'] == 0x1298
assert by_name['m_bConstrainBetweenEndpoints']['type'] == 1

drawing = report['drawing']
assert drawing['solver'] == 'CRopePhysicsILi10EE (ten constraint passes)'
assert drawing['materials'] == ['cable/cable', 'cable/rope_shadowdepth', 'missing_rope_material']
assert drawing['serverMaterials'] == ['cable/cable.vmt', 'cable/rope.vmt', 'cable/chain.vmt']
assert 'cable/nuke_cable.vmt' in drawing['materialRule'], drawing['materialRule']
assert set(drawing['methods']) == {'C_RopeKeyframe::DrawModel', 'CRopeManager::DrawRenderCache',
                                   'C_RopeKeyframe::CalculateEndPointAttachment',
                                   'CPhysicsDelegate::ApplyConstraints'}
convars = {name: row['default'] for name, row in drawing['convars'].items()}
assert len(convars) == 21, len(convars)
assert convars['rope_subdiv'] == '2' and convars['rope_smooth_enlarge'] == '1.4'
assert convars['rope_smooth_minwidth'] == '0.3' and convars['rope_smooth_minalpha'] == '0.2'
assert convars['rope_smooth_maxalphawidth'] == '1.75' and convars['rope_smooth_maxalpha'] == '0.5'
assert convars['rope_wind_dist'] == '1000' and convars['r_drawropes'] == '1'
assert convars['rope_collide'] == '1' and convars['rope_smooth'] == '1'

# The table the runtime reads. The map's numbers are copied verbatim; nothing is derived, because
# the rules that turn them into a rope are not read (see the report's boundary).
table = {
    'format': 'source-ropes-data-v1',
    'metresPerSourceUnit': 0.0254,
    'material': 'cable/nuke_cable',
    'ropes': [{'hammerId': row['hammerId'], 'classname': row['classname'], 'origin': row['origin'],
               'angles': row['angles'], 'width': row['width'], 'slack': row['slack'],
               'subdiv': row['subdiv'], 'type': row['type'], 'textureScale': row['textureScale'],
               'moveSpeed': row['moveSpeed'], 'targetname': row['targetname'],
               'nextKey': row['nextKey'], 'positionInterpolator': row['positionInterpolator']}
              for row in ropes],
}
literal = json.dumps(table, ensure_ascii=False, separators=(',', ':'))
sources = {
    'source': 'research/source-ropes.json',
    'reportSha256': hashlib.sha256(REPORT.read_bytes()).hexdigest(),
    'sourceBspSha256': report['sources']['sourceBspSha256'],
    'client64Sha256': report['sources']['client64Sha256'],
}
contents = (
    '/** Dust2\'s own ropes, generated by `scripts/stage-source-ropes.py` from\n'
    ' * `research/source-ropes.json`. Do not edit: the probe reads the map twice and the client, and\n'
    ' * this table is what it read. */\n'
    'export const SOURCE_ROPES_DATA = ' + literal + ' as const;\n\n'
    'export const SOURCE_ROPES_SOURCES = ' + json.dumps(sources, indent=2) + ' as const;\n')
TABLE.write_text(contents)
print(json.dumps({'table': str(TABLE), 'bytes': len(contents), 'ropes': len(table['ropes']),
                  'reportSha256': sources['reportSha256']}, indent=1))
