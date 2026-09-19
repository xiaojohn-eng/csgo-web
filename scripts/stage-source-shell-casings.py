"""Stage the original shell-casing systems and their models as production assets.

Three models, one material texture and one runtime table. The table is the shipped PCF's
own numbers, and it carries the one conversion the port has to state explicitly: the three
casing models are authored in millimetres while every other model in the depot is authored
in Source units (an inch). That reading is not a guess — the 9mm casing measures 19.15 by
9.7 and the 7.62 one 38.7 by 11.0, which are those cartridges' real dimensions, and the same
two shells also ship as `models/shells/shell_9mm.mdl` (0.893 long) and
`models/shells/shell_762nato.mdl` (2.355 long), which are the same objects authored in
inches. The system's own sprite fallback draws the same object at radius 1.25 / 2.0 / 3.5
units, which is the same few-centimetre size.

Run: python3 scripts/stage-source-shell-casings.py
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPORT = ROOT / '.reference-assets/source-exports/shell-casings'
MODELS = ROOT / '.reference-assets/source-exports/shell-models'
DEST = ROOT / 'public/source/csgo-12426148/shells'
TABLE = ROOT / 'game/source-shell-casings.json'
RESOURCES = ROOT / 'game/source-shell-resources.json'

source = EXPORT / 'shell-casings.json'
source_bytes = source.read_bytes()
export = json.loads(source_bytes)
if export['format'] != 'source-shell-casings-v1' or export['build'] != 12426148:
    raise ValueError('Unexpected shell casing export identity')
model_receipt = json.loads((MODELS / 'receipt.json').read_text())
effects = json.loads((ROOT / 'public/source/csgo-12426148/weapon-effects/effect-map.json').read_text())


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def check(path: Path, row: dict) -> bytes:
    data = path.read_bytes()
    if len(data) != row['bytes'] or digest(data) != row['sha256']:
        raise ValueError('Staged original file differs from its receipt: ' + str(path))
    return data


def numbers(value, count=None):
    if isinstance(value, str):
        parts = [float(part) for part in value.split()]
    else:
        parts = [float(part) for part in value]
    if count is not None and len(parts) != count:
        raise ValueError(f'Expected {count} numbers, got {parts}')
    return parts


systems = {}
for root, row in sorted(export['effects'].items()):
    operators = row['operators']
    renderer = operators['Render models']
    reference = renderer['sequence 0 model']
    # The three casing models carry an `_hr` (high-resolution) suffix; they are staged under
    # the stem the importer used for them.
    model = model_receipt['models'] and next(
        (name for name in model_receipt['models']
         if Path(reference.replace('\\', '/')).stem.startswith(name)), None)
    if model is None:
        raise ValueError('Casing system names a model that was not imported: ' + reference)
    motion = operators['Movement Basic']
    spin_roll = operators['Rotation Spin Roll']
    spin_yaw = operators['Rotation Spin Yaw']
    lifetime = operators['Lifetime Random']
    velocity = operators['Position Within Sphere Random']
    radius = operators['Radius Random']
    collision = operators['Collision via traces']
    emit = operators['emit_instantaneously']
    fallback = row.get('fallback') or {}
    fallback_radius = (fallback.get('operators') or {}).get('Radius Random', {})
    if fallback_radius.get('radius_min') != fallback_radius.get('radius_max'):
        raise ValueError('Casing fallback sprite radius is not a fixed size: ' + root)
    systems[root] = dict(
        model=model, modelUrl=f'/source/csgo-12426148/shells/{model}.glb',
        textureUrl='/source/csgo-12426148/shells/shells.png',
        material=row['material'], maxParticles=int(row['max_particles']),
        systemRadiusUnits=float(row['radius']), maxDrawDistanceUnits=float(row['maximum draw distance']),
        gravityUnitsPerSecondSquared=numbers(motion['gravity'], 3), drag=float(motion['drag']),
        lifetimeSeconds=[float(lifetime['lifetime_min']), float(lifetime['lifetime_max'])],
        spinRollDegreesPerSecond=float(spin_roll['spin_rate_degrees']),
        spinRollStopSeconds=float(spin_roll['spin_stop_time']),
        spinYawDegreesPerSecond=float(spin_yaw['yaw_rate_degrees']),
        spinYawStopSeconds=float(spin_yaw.get('yaw_stop_time', 0) or 0),
        spawnVelocityLocalUnitsPerSecondMin=numbers(velocity['speed_in_local_coordinate_system_min'], 3),
        spawnVelocityLocalUnitsPerSecondMax=numbers(velocity['speed_in_local_coordinate_system_max'], 3),
        spawnRadiusUnits=float(radius['radius_min']),
        emitCount=int(emit['num_to_emit']),
        collision=dict(group=str(collision['collision group']), brushOnly=bool(collision['brush only']),
                       bounce=float(collision['amount of bounce']), slide=float(collision['amount of slide'])),
        fallbackSpriteRadiusUnits=float(fallback_radius['radius_min']))

table = dict(
    format='source-shell-casings-v1', build=export['build'],
    # The three casing models are authored in millimetres; Source's unit is the inch. The
    # conversion is stated here rather than hidden in the renderer. Every other number these
    # systems carry (velocity, gravity, radius) is already in Source units.
    modelUnitsToSourceUnits=1 / 25.4,
    modelUnitsToMetres=0.0254 / 25.4,
    sourceUnitsToMetres=0.0254,
    modelUnitBasis=dict(
        authoredIn='millimetres',
        evidence=['9mm casing measures 19.15 by 9.7, a 9x19 case is 19.15 by 9.93 millimetres',
                  '7.62 casing measures 38.7 by 11.0, a 7.62x39 case is 38.7 by 11.35 millimetres',
                  'the same shells ship in inches as models/shells/shell_9mm.mdl at 0.893 and '
                  'models/shells/shell_762nato.mdl at 2.355',
                  'each system\'s own sprite fallback draws the same object at radius 1.25 / 2.0 / 3.5 units'],
        boundary='This build\'s client carries no 1/25.4 constant, so where the original applies the '
                 'conversion is not measured; the port applies it explicitly and states it here.'),
    systems=systems, weapons=dict(effects['weapons'] and
                                  {weapon: row['eject_brass_effect'] for weapon, row in effects['weapons'].items()}),
    limitations=list(export['limitations']) + [
        # The export already states the fallback is not drawn at distance and that the emitter
        # attachment is not named by the PCF; these are the port's own additions.
        'The attachment\'s rotation is applied as a pure rotation, so the speed the system states survives it; the '
        'original\'s own handling of any non-rotation part of that transform is not measured.',
        'A casing is simulated until its own lifetime ends, as the original\'s `Lifespan Decay` does; the audit\'s '
        '`resting` read-out is derived from a casing having all but stopped and is not a state the original has.'])

DEST.mkdir(parents=True, exist_ok=True)
rows = []


def place(relative: str, data: bytes, kind: str, name: str) -> None:
    path = DEST / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    if path.read_bytes() != data:
        raise ValueError('Staged shell readback differs: ' + relative)
    rows.append(dict(kind=kind, name=name, path=relative, bytes=len(data), sha256=digest(data)))


for name, row in sorted(model_receipt['models'].items()):
    place(f'{name}.glb', check(MODELS / f'{name}.glb', row['glb']), 'model', name)
for row in model_receipt['textures']:
    stem = Path(row['source']).stem
    place(f'{stem}.png', check(MODELS / f'{stem}.png', row['png']), 'texture', stem)

place('provenance.json', (json.dumps(dict(
    format='source-shell-provenance-v1',
    export=dict(path=str(source.relative_to(ROOT)), bytes=len(source_bytes), sha256=digest(source_bytes)),
    modelSource=dict(path=str((MODELS / 'receipt.json').relative_to(ROOT)),
                     sha256=digest((MODELS / 'receipt.json').read_bytes())),
    pcf=export['pcf'], nativeSource=export['nativeSource'],
    models={name: dict(source=row['source'], sourceSha256=row['sourceSha256']) for name, row in model_receipt['models'].items()},
    textures=model_receipt['textures'], files=[{key: row[key] for key in
      ('kind', 'name', 'path', 'bytes', 'sha256')} for row in rows],
    limitations=table['limitations']), indent=2, ensure_ascii=False) + '\n').encode(), 'provenance', 'provenance.json')

TABLE.write_text(json.dumps(table, separators=(',', ':'), ensure_ascii=False) + '\n')
RESOURCES.write_text(json.dumps(rows, indent=2) + '\n')

for row in rows:
    print(f'{row["kind"]:9s} {row["name"]:14s} {row["bytes"]:>8,d}  {row["sha256"][:16]}…')
print('table bytes', len(TABLE.read_bytes()))
print('systems', {name: (row['model'], row['maxParticles'], row['fallbackSpriteRadiusUnits'])
                  for name, row in sorted(systems.items())})
print('weapons', table['weapons'])
