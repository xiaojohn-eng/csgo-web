"""Stage the exported original bullet-impact data as production assets.

Only what the runtime fetches is staged: the decal atlases an impact on this map can
reach, the original impact waves the surface table names, and one runtime table that
joins the map's own faces to that table. Every staged byte carries its SHA-256, and
the table records the SHA of the export it was cut from so the numbers stay derivable.

Run: python3 scripts/stage-source-impact.py
"""
from __future__ import annotations
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPORT = ROOT / '.reference-assets/source-exports/impact'
DEST = ROOT / 'public/source/csgo-12426148/impact'
AUDIO = ROOT / 'game/source-impact-audio.json'
TABLE = ROOT / 'game/source-impact-table.json'
# The same bytes reach the browser through the bundler and the Node server through the
# static web root, so the stage writes both and a test asserts they are identical.
PUBLIC_TABLE = ROOT / 'public/source/csgo-12426148/impact/surface-props.json'
LEVEL = ROOT / 'public/source/csgo-12426148/dust2/level.json'

source = EXPORT / 'surface-props.json'
source_bytes = source.read_bytes()
export = json.loads(source_bytes)
if export['format'] != 'source-surface-props-v1' or export['build'] != 12426148:
    raise ValueError('Unexpected impact export identity')
if not export['brushes'] or not export['props'] or not export['impact']:
    raise ValueError('Impact export is missing one of its three surface sources')
if export['coverage']['displacementChunks'] != export['coverage']['displacementChunkTotal']:
    raise ValueError('Only a partially resolved displacement table may not be staged')
level = json.loads(LEVEL.read_text())
source_bsp_sha = level['sourceBspSha256']


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_export(name: str, expected: dict) -> bytes:
    data = (EXPORT / name).read_bytes()
    if len(data) != expected['bytes'] or digest(data) != expected['sha256']:
        raise ValueError('Staged original file differs from the export receipt: ' + name)
    return data


# --------------------------------------------------------------------------- #
# atlases and the decals an impact on this map can reach
# --------------------------------------------------------------------------- #
# The shipped decal set covers effects this map never selects (blood, scorch); only
# the decimal materials an impact row actually names are carried, together with the
# atlases those decals address.
reachable = {entry['material'] for row in export['impact'].values() for entry in row['decals']}
missing = sorted(material for material in reachable if not export['decalMaterials'].get(material, {}).get('resolved'))
if missing:
    raise ValueError('An impact row names a decal this build cannot draw: ' + str(missing))

atlases = {}
atlas_files: dict[str, bytes] = {}
for material in sorted(reachable):
    row = export['decalMaterials'][material]
    atlas = row['atlas']
    if atlas in atlases:
        continue
    origin = export['decalAtlases'][atlas]
    data = read_export(origin['image']['path'], origin['image'])
    name = Path(origin['image']['path']).name
    atlas_files[name] = data
    atlases[atlas] = dict(url='atlas/' + name, width=origin['width'], height=origin['height'],
                          bytes=len(data), sha256=digest(data), source=origin['source'])

decals = {}
for material in sorted(reachable):
    row = export['decalMaterials'][material]
    decals[material] = dict(atlas=row['atlas'], pos=row['pos'], size=row['size'],
                            scale=row['decalScale'], scaleVariation=row['decalScaleVariation'],
                            modelMaterial=row['modelMaterial'], shader=row['shader'])

impact = {}
for surface, row in sorted(export['impact'].items()):
    impact[surface] = dict(
        gameMaterial=row['gameMaterial'], decalGroup=row['decalGroup'],
        decals=[dict(material=entry['material'], weight=entry['weight'])
                for entry in row['decals'] if entry['material'] in decals],
        bulletImpact=row['bulletImpact'])

# --------------------------------------------------------------------------- #
# impact waves
# --------------------------------------------------------------------------- #
slug = lambda value: re.sub(r'[^a-z0-9]+', '_', value.casefold()).strip('_')
records = []
sound_files: dict[str, bytes] = {}
for event, row in sorted(export['sounds'].items()):
    for index, wave in enumerate(row['waves'], start=1):
        data = read_export(wave['path'], wave)
        relative = wave['source'].removeprefix('sound/')
        sound_files[relative] = data
        records.append(dict(key=f'source_impact_{slug(event)}_{index}', event=event,
                            url='/source/csgo-12426148/impact/sounds/' + relative,
                            sha256=digest(data), bytes=len(data), pitch=row['pitch'],
                            volume=row['volume'], source=wave['source']))
if len(records) != sum(export['coverage']['impactSounds'].values()):
    raise ValueError('Staged impact wave count differs from the export coverage')
if len({row['event'] for row in records}) != len(export['sounds']):
    raise ValueError('Staged impact events differ from the export')

# --------------------------------------------------------------------------- #
# the runtime table
# --------------------------------------------------------------------------- #
surfaces = dict(brushes=export['brushes'], displacementChunks=export['displacementChunks'],
                props={name: row['surfaceProp'] for name, row in export['props'].items()})
for kind, entries in surfaces.items():
    unknown = sorted(set(entries.values()) - set(impact))
    if unknown:
        raise ValueError(f'Staged {kind} surfaces without an impact row: {unknown}')

table = dict(format='source-impact-table-v1', build=export['build'], sourceBspSha256=source_bsp_sha,
             # Each atlas entry carries its own `atlas/<file>.png` path, so the base names the
             # directory above it; the runtime joins the two once.
             atlasBaseUrl='/source/csgo-12426148/impact/',
             soundBaseUrl='/source/csgo-12426148/impact/sounds/',
             atlases=atlases, decalMaterials=decals, impact=impact, surfaces=surfaces,
             limitations=list(export['limitations']))

DEST.mkdir(parents=True, exist_ok=True)
rows = []


def place(relative: str, data: bytes, kind: str, name: str) -> None:
    path = DEST / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    if path.read_bytes() != data:
        raise ValueError('Staged impact readback differs: ' + relative)
    rows.append(dict(kind=kind, name=name, path=relative, bytes=len(data), sha256=digest(data)))


for name, data in sorted(atlas_files.items()):
    place('atlas/' + name, data, 'atlas', name)
for relative, data in sorted(sound_files.items()):
    place('sounds/' + relative, data, 'sound', relative)

place('provenance.json', (json.dumps(dict(
    format='source-impact-provenance-v1',
    export=dict(path=str(source.relative_to(ROOT)), bytes=len(source_bytes), sha256=digest(source_bytes)),
    sourceBspSha256=source_bsp_sha,
    surfaceScript=export['sourceFiles']['scripts/surfaceproperties_cs.txt'],
    decalScript=export['sourceFiles']['scripts/decals_subrect.txt'],
    embedMapPak=export['embeddedMapPak'],
    files=[{key: row[key] for key in ('kind', 'name', 'path', 'bytes', 'sha256')} for row in rows],
    coverage=export['coverage'], unresolvedBrushes=export['unresolvedBrushes'],
    unresolvedProps=export['unresolvedProps'], surfaceProps=sorted(impact),
    limitations=export['limitations']), indent=2, ensure_ascii=False) + '\n').encode(), 'provenance', 'provenance.json')

AUDIO.write_text(json.dumps(records, indent=2, ensure_ascii=False) + '\n')
table_bytes = json.dumps(table, separators=(',', ':'), ensure_ascii=False) + '\n'
TABLE.write_text(table_bytes)
place('surface-props.json', table_bytes.encode(), 'table', 'surface-props.json')
if TABLE.read_bytes() != PUBLIC_TABLE.read_bytes():
    raise ValueError('Staged runtime table differs between the bundle and the web root')

for row in rows:
    print(f'{row["kind"]:10s} {row["name"]:56s} {row["bytes"]:>9,d}  {row["sha256"][:16]}…')
print(f'staged {len(rows)} files, {len(records)} impact waves over {len(export["sounds"])} events, '
      f'{len(impact)} surfaces, {len(decals)} decals, {len(atlases)} atlases')
print('table bytes', len(TABLE.read_bytes()), 'audio records', len(records))
