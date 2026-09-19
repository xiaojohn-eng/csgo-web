"""Stage the exported rifle/AWP muzzle closure as production data.

Only what the runtime actually fetches is staged: the PCF closure, the original
native operator defaults for the operators that closure reaches, and the one
decoded original texture the rifle's own sprite flash draws. Every staged byte
carries its SHA-256, and the staged `native-defaults.json` records the SHA of the
unfiltered original table it was taken from.

Run: python3 scripts/stage-source-muzzle-particles.py
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPORT = ROOT / '.reference-assets/source-exports/muzzle-flash-particles'
DEST = ROOT / 'public/source/csgo-12426148/muzzle-particles'
RESOURCES = ROOT / 'game/source-muzzle-particle-resources.json'

graph = json.loads((EXPORT / 'graph.json').read_text())
receipt = json.loads((EXPORT / 'receipt.json').read_text())
assert graph['format'] == 'source-pistol-particles-v1' and graph['build'] == 12426148
assert [r['name'] for r in graph['roots']] == receipt['roots']
graph_bytes = (EXPORT / 'graph.json').read_bytes()
assert hashlib.sha256(graph_bytes).hexdigest() == receipt['graph']['sha256']

native_source = EXPORT / 'native-defaults.json'
native = json.loads(native_source.read_text())
assert native['format'] == 'source-pistol-particle-native-defaults-v1'
assert native['status'] == 'original-unpack-getters-executed'
# The closure's own operator table: an operator schema is only resolvable from the
# names a graph uses, so this closure is probed for itself instead of reusing the
# pistol closure's table.
needed = sorted(receipt['functionNames'])
available = {row['functionName']: row for row in native['operators']}
# A shipped PCF can name an operator by the lowercase class-style spelling its authoring
# tool wrote while the registry holds the display name; the runtime resolves those by a
# normalised, unique match. The same rule is applied here so the staged table reports
# what the runtime will actually find, and a name that is still ambiguous is recorded.
def normalise(value):
    return ''.join(character for character in value.lower() if character not in ' _')
aliased = {}
for name in needed:
    if name in available:
        continue
    matches = [row['functionName'] for row in native['operators'] if normalise(row['functionName']) == normalise(name)]
    if len(matches) == 1:
        aliased[name] = matches[0]
missing = [name for name in needed if name not in available and name not in aliased]
# The alias target has to ship too: the runtime resolves the file's legacy spelling to
# it, so a target the closure never names directly would otherwise be missing.
stagedNames = sorted(set(name for name in needed if name in available) | set(aliased.values()))
# A name with no schema at all and a name this build cannot tell apart are both
# recorded; the runtime fails closed on any system that needs one of them.
probeUnresolved = sorted({row['functionName'] for row in native.get('unresolved', []) if row['functionName'] in needed})
unresolved = sorted(set(probeUnresolved) - set(aliased))
print('operators resolved by a legacy alias:', sorted(aliased.items()))
print('operators still without a unique schema:', sorted(set(missing) | set(unresolved)))
filtered = dict(native, operators=[available[name] for name in stagedNames],
                stagedFor=dict(format=graph['format'], roots=receipt['roots']),
                sourceFile=native_source.relative_to(ROOT).as_posix(),
                sourceSha256=hashlib.sha256(native_source.read_bytes()).hexdigest(),
                sourceOperatorCount=len(native['operators']),
                absentOperators=sorted(set(missing) | set(unresolved)),
                unresolvedOperators=unresolved,
                aliasedOperators=[dict(requested=name, resolved=target) for name, target in sorted(aliased.items())],
                probeUnresolvedOperators=probeUnresolved)

# The original textures the rifle's own third-person subsystems draw: the vent's
# sprite flash, the glow's flare, the rolling flame's fire sheet, and the smoke the
# same dispatcher emits — the muzzle smoke's own atlas, the shell-eject smoke's
# `vistasmokev1_emods` atlas and the sparks' single frame. Each atlas is this one
# image; the frames it addresses come from the sheet beside it.
TEXTURES = ['textures/muzzleflashx-frame-0.png', 'textures/particle_flare_004-frame-0.png',
            'textures/fire_particle_4-frame-0.png', 'textures/particle_glow_04-frame-0.png',
            'textures/smoke1-frame-0.png', 'textures/vistasmokev1_emods-frame-0.png',
            'textures/spark-frame-0.png']
# The original sheets those textures address (`VTF_RSRC_SHEET`). The runtime decodes
# every frame's UV rect from these bytes itself, so they ship with their own receipt,
# checked against the graph's own record of them rather than re-measured here.
SHEETS = sorted({row['sheetFile']['path']: row['sheetFile'] for texture in graph['textures']
                 for row in texture['resources'] if row.get('sheetFile')}.values(), key=lambda row: row['path'])
for row in SHEETS:
    data = (EXPORT / row['path']).read_bytes()
    if len(data) != row['bytes'] or hashlib.sha256(data).hexdigest() != row['sha256']:
        raise ValueError('Staged original sheet differs from the graph record: ' + row['path'])
FILES = {'graph.json': graph_bytes,
         'native-defaults.json': (json.dumps(filtered, indent=2, ensure_ascii=False) + '\n').encode(),
         **{name: (EXPORT / name).read_bytes() for name in TEXTURES},
         **{row['path']: (EXPORT / row['path']).read_bytes() for row in SHEETS}}

DEST.mkdir(parents=True, exist_ok=True)
rows = []
for name, data in sorted(FILES.items()):
    path = DEST / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    if path.read_bytes() != data:
        raise ValueError('Staged muzzle particle readback differs: ' + name)
    rows.append(dict(path=name, bytes=len(data), sha256=hashlib.sha256(data).hexdigest()))
RESOURCES.write_text(json.dumps(rows, indent=2) + '\n')

for row in rows:
    print(f'{row["path"]:34s} {row["bytes"]:>9,d}  {row["sha256"][:16]}…')
print(f'staged {len(rows)} files to {DEST.relative_to(ROOT)}, resources {RESOURCES.relative_to(ROOT)}')
