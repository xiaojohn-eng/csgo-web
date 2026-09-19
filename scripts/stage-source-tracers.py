"""Stage the tracer systems: the runtime table, the spark texture and the byte receipts.

Why this exists
---------------
`scripts/export-source-tracers.py` reads the three systems and their operators out of the
shipped PCF, and this build's own schema and default for every operator they use. The table
this writes is the **effective** value of each field: the shipped block where it states one,
this build's own default where it does not. That makes the runtime a statement about the
shipped file rather than about the export.

The one reading that is not data is the meaning of `Alpha Fade and Decay for Tracers`' four
times. They are taken as fractions of the particle's own flight, and the table carries the
reason: read as absolute seconds they would be larger than the whole flight of any real shot
(the streak would never be visible), and this build's own default for `end_fade_out_time` is
exactly 1.

Run: python3 scripts/stage-source-tracers.py
"""
from __future__ import annotations
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPORT = ROOT / '.reference-assets/source-exports/tracers/tracers.json'
DEST = ROOT / 'public/source/csgo-12426148/tracers'
TABLE = ROOT / 'game/source-tracers.json'
RESOURCES = ROOT / 'game/source-tracer-resources.json'
BUILD = 12426148


def fail(message: str):
    raise SystemExit('stage-source-tracers: ' + message)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


receipt = json.loads(EXPORT.read_text())
if receipt.get('format') != 'source-tracers-v1' or receipt.get('build') != BUILD:
    fail('the export is not this build\'s tracer export')
if receipt.get('nativeUndocumented'):
    fail('the export left operators unresolved: ' + str(receipt['nativeUndocumented']))
effects, schemas = receipt['effects'], receipt['nativeSchemas']
resolutions = receipt.get('operatorResolutions', {})

TRAIL_OPERATOR = 'move particles between 2 control points'


def defaults(name: str) -> dict:
    """This build's own default for every field of one operator, by its PCF name.

    The export already keys the native schemas by the name the PCF uses, so a name that this
    build registers differently is carried in `operatorResolutions` beside it.
    """
    if name not in schemas:
        resolved = resolutions.get(name)
        if resolved is None or resolved not in schemas:
            fail('no native schema for operator ' + name)
        name = resolved
    return {field['name']: field['default'] for field in schemas[name]['fields']}


def field(operator: str, name: str, record: dict):
    """The shipped block's value for a field, or this build's own default for it."""
    if name in record:
        return record[name]
    table = defaults(operator)
    if name not in table:
        fail(f'{operator} has no field {name} in this build')
    return table[name]


def number(value, where: str) -> float:
    if isinstance(value, str):
        text = value.strip()
        if text.startswith('.') or text.startswith('-.'):
            text = ('-0' if text.startswith('-') else '0') + text
        try:
            return float(text)
        except ValueError:
            fail(f'{where} is not a number: {value!r}')
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        fail(f'{where} is not a number: {value!r}')
    return float(value)


def vector(value, where: str, size: int = 3) -> list:
    if isinstance(value, str):
        parts = value.split()
    elif isinstance(value, list):
        parts = value
    else:
        fail(f'{where} is not a vector: {value!r}')
    if len(parts) != size:
        fail(f'{where} has {len(parts)} components, not {size}')
    return [number(part, where) for part in parts]


def flag(value, where: str) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str) and value.strip() in ('0', '1'):
        return value.strip() == '1'
    fail(f'{where} is not a 0/1 flag: {value!r}')


systems = {}
for name, row in sorted(effects.items()):
    operators = row['operators']
    collections = row['collections']
    if collections['renderers'] != ['render_sprite_trail']:
        fail(f'{name} is not drawn by the sprite-trail renderer: {collections["renderers"]}')
    for required in ('Movement Basic', 'Alpha Fade and Decay for Tracers', TRAIL_OPERATOR,
                     'Trail Length Random', 'Alpha Random', 'Color Random', 'Radius Random',
                     'emit_instantaneously'):
        if required not in operators:
            fail(f'{name} is missing {required}')
    trail, render = operators[TRAIL_OPERATOR], operators['render_sprite_trail']
    length, alpha, colour = operators['Trail Length Random'], operators['Alpha Random'], operators['Color Random']
    radius, fade = operators['Radius Random'], operators['Alpha Fade and Decay for Tracers']
    emit, movement = operators['emit_instantaneously'], operators['Movement Basic']
    offset = operators.get('Position Modify Offset Random')
    sphere = operators.get('Position Within Sphere Random')

    minimum = number(field(TRAIL_OPERATOR, 'minimum speed', trail), f'{name} minimum speed')
    maximum = number(field(TRAIL_OPERATOR, 'maximum speed', trail), f'{name} maximum speed')
    if not 0 < minimum <= maximum:
        fail(f'{name} has no usable flight speed')
    gravity = vector(field('Movement Basic', 'gravity', movement), f'{name} gravity')
    drag = number(field('Movement Basic', 'drag', movement), f'{name} drag')
    fade_times = {key: number(field('Alpha Fade and Decay for Tracers', key, fade), f'{name} {key}')
                  for key in ('start_fade_in_time', 'end_fade_in_time', 'start_fade_out_time', 'end_fade_out_time')}
    fade_alpha = {key: number(field('Alpha Fade and Decay for Tracers', key, fade), f'{name} {key}')
                  for key in ('start_alpha', 'end_alpha')}
    for key, value in fade_times.items():
        if not 0 <= value <= 1:
            fail(f'{name} {key} is outside the particle\'s own flight: {value}')
    if not (fade_times['start_fade_in_time'] <= fade_times['end_fade_in_time']
            <= fade_times['start_fade_out_time'] <= fade_times['end_fade_out_time']):
        fail(f'{name} fade windows are out of order: {fade_times}')
    if not (0 <= fade_alpha['start_alpha'] <= 1 and 0 <= fade_alpha['end_alpha'] <= 1):
        fail(f'{name} fade alpha is not a scale: {fade_alpha}')

    alpha_min = number(field('Alpha Random', 'alpha_min', alpha), f'{name} alpha_min')
    alpha_max = number(field('Alpha Random', 'alpha_max', alpha), f'{name} alpha_max')
    radius_min = number(field('Radius Random', 'radius_min', radius), f'{name} radius_min')
    radius_max = number(field('Radius Random', 'radius_max', radius), f'{name} radius_max')
    length_min = number(field('Trail Length Random', 'length_min', length), f'{name} length_min')
    length_max = number(field('Trail Length Random', 'length_max', length), f'{name} length_max')
    render_max = number(field('render_sprite_trail', 'max length', render), f'{name} max length')
    render_min = number(field('render_sprite_trail', 'min length', render), f'{name} min length')
    for label, low, high in (('alpha', alpha_min, alpha_max), ('radius', radius_min, radius_max),
                             ('trail length', length_min, length_max)):
        if not 0 <= low <= high:
            fail(f'{name} {label} range is not a range: {low}..{high}')
    if not 0 <= render_min <= render_max:
        fail(f'{name} render length range is not a range: {render_min}..{render_max}')

    emitted = int(number(field('emit_instantaneously', 'num_to_emit', emit), f'{name} num_to_emit'))
    if emitted < 1:
        fail(f'{name} emits nothing')

    entry = {
        'material': row['material'], 'shader': receipt['materials'][
            'materials/' + str(row['material']).replace('\\', '/').removesuffix('.vmt') + '.vmt']['shader'],
        'maxParticles': int(row['max_particles']),
        'maximumDrawDistanceUnits': number(row['maximum draw distance'], f'{name} max draw distance'),
        'aggregationRadiusUnits': number(row['aggregation radius'], f'{name} aggregation radius'),
        'emitCount': emitted,
        'speedUnitsPerSecond': [minimum, maximum],
        'endControlPoint': int(number(field(TRAIL_OPERATOR, 'end control point', trail), f'{name} end cp')),
        'endSpread': number(field(TRAIL_OPERATOR, 'end spread', trail), f'{name} end spread'),
        'startOffsetUnits': number(field(TRAIL_OPERATOR, 'start offset', trail), f'{name} start offset'),
        'endOffsetUnits': number(field(TRAIL_OPERATOR, 'end offset', trail), f'{name} end offset'),
        'biasLifetimeByTrailLength': flag(field(TRAIL_OPERATOR, 'bias lifetime by trail length', trail),
                                          f'{name} bias lifetime'),
        'radiusUnits': [radius_min, radius_max],
        'radiusExponent': number(field('Radius Random', 'radius_random_exponent', radius), f'{name} radius exponent'),
        'trailLengthSeconds': [length_min, length_max],
        'trailLengthExponent': number(field('Trail Length Random', 'length_random_exponent', length),
                                     f'{name} trail length exponent'),
        'renderLengthUnits': [render_min, render_max],
        'lengthFadeInSeconds': number(field('render_sprite_trail', 'length fade in time', render),
                                     f'{name} length fade in time'),
        'constrainRadiusToLength': flag(field('render_sprite_trail', 'constrain radius to length', render),
                                        f'{name} constrain radius to length'),
        'animationRate': number(field('render_sprite_trail', 'animation rate', render), f'{name} animation rate'),
        'tailColorAlphaScale': vector(field('render_sprite_trail', 'tail color and alpha scale factor', render),
                                     f'{name} tail colour scale', 4),
        'alphaRange': [alpha_min, alpha_max],
        'alphaExponent': number(field('Alpha Random', 'alpha_random_exponent', alpha), f'{name} alpha exponent'),
        'color1': vector(field('Color Random', 'color1', colour), f'{name} color1', 4),
        'color2': vector(field('Color Random', 'color2', colour), f'{name} color2', 4),
        'gravityUnitsPerSecondSquared': gravity,
        'drag': drag,
        'fade': dict(startAlpha=fade_alpha['start_alpha'], endAlpha=fade_alpha['end_alpha'], **fade_times),
    }
    if offset:
        entry['offsetUnits'] = vector(field('Position Modify Offset Random', 'offset min', offset),
                                      f'{name} offset min')
        entry['offsetUnitsMax'] = vector(field('Position Modify Offset Random', 'offset max', offset),
                                         f'{name} offset max')
        entry['offsetInLocalSpace'] = flag(field('Position Modify Offset Random', 'offset in local space 0/1', offset),
                                           f'{name} offset in local space')
        entry['offsetControlPoint'] = int(number(field('Position Modify Offset Random', 'control_point_number', offset),
                                                f'{name} offset control point'))
    else:
        # A system with no such operator leaves the particle at its control point.
        entry['offsetUnits'] = [0.0, 0.0, 0.0]
        entry['offsetUnitsMax'] = [0.0, 0.0, 0.0]
        entry['offsetInLocalSpace'] = False
        entry['offsetControlPoint'] = 0
    if sphere:
        # The sphere initialiser places the particle and gives it its own speed; both are
        # recorded because a system that used them would not start on the control point.
        entry['sphereDistanceUnits'] = [number(field('Position Within Sphere Random', 'distance_min', sphere),
                                               f'{name} distance_min'),
                                       number(field('Position Within Sphere Random', 'distance_max', sphere),
                                              f'{name} distance_max')]
        entry['sphereSpeedUnitsPerSecond'] = [
            vector(field('Position Within Sphere Random', 'speed_in_local_coordinate_system_min', sphere),
                   f'{name} local speed min'),
            vector(field('Position Within Sphere Random', 'speed_in_local_coordinate_system_max', sphere),
                   f'{name} local speed max')]
    if entry['offsetUnits'] != [0.0, 0.0, 0.0] and not entry['offsetInLocalSpace']:
        fail(f'{name} offsets its particles in world space, which this table does not carry')
    for axis in range(3):
        if entry['offsetUnits'][axis] != entry['offsetUnitsMax'][axis]:
            fail(f'{name} has a random offset on axis {axis}, which this table does not carry')
    if any(value != 0 for value in gravity) or drag != 0:
        fail(f'{name} moves under a force, which this table does not carry')
    systems[name] = entry

material_path = 'materials/' + str(effects[sorted(effects)[0]]['material']).replace('\\', '/') \
    .removesuffix('.vmt') + '.vmt'
material = receipt['materials'][material_path]
texture = material['textures'][0]
body = material['body'] or {}
if '$additive' not in body:
    fail('the tracer material does not state whether it is additive')

table = {
    'format': 'source-tracers-v1', 'build': BUILD,
    'sourceUnitsToMetres': 0.0254,
    'material': {'path': material_path, 'shader': material['shader'],
                 'additive': flag(body['$additive'], 'material $additive'),
                 'splineType': int(number(body.get('$splinetype', 0), 'material $splinetype')),
                 'texture': {'parameter': texture['parameter'], 'source': texture['source'],
                             'width': texture['width'], 'height': texture['height'],
                             'vtfFlags': texture['vtfFlags'], 'png': 'spark.png'}},
    'systems': systems,
    'weapons': {weapon: row['tracer_effect'] for weapon, row in json.loads(
        (ROOT / 'public/source/csgo-12426148/weapon-effects/effect-map.json').read_text())['weapons'].items()},
    'fadeTimeBasis': {
        'read as': 'a fraction of the particle\'s own flight',
        'evidence': ['read as absolute seconds the windows would exceed the whole flight of any real shot, '
                     'so the streak could never be visible',
                     'this build\'s own default for `end_fade_out_time` is exactly 1'],
        'boundary': 'the operator\'s own arithmetic was not executed, so this reading is stated rather than measured',
    },
    'limitations': [
        'The sprite trail is drawn as one ribbon along the shot\'s own line: the particle\'s path is that '
        'line by construction, because `move particles between 2 control points` sweeps it at the speed the '
        'operator states.',
        'The four fade times are read as fractions of the particle\'s flight; see fadeTimeBasis.',
        'The local offset is taken along the shot\'s own direction: the operator says local space and this '
        'build does not hold the emitter\'s frame, which the PCF does not name.',
        '`$splinetype 2` smooths the trail through its sampled points; the path here is a straight line, so '
        'there is nothing to smooth.',
        '`aggregation radius` batches these systems with others in the same radius; the port draws its own '
        'tracers individually.',
        '`Movement Basic` states no gravity and no drag for these systems, so a tracer travels the shot\'s '
        'line rather than falling.',
        'The trail is drawn while the system\'s `maximum draw distance` allows, which is 10000 units for all '
        'three systems.',
    ],
}

DEST.mkdir(parents=True, exist_ok=True)
rows = []


def stage(relative: str, payload: bytes, kind: str, name: str) -> dict:
    target = DEST / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(payload)
    if target.read_bytes() != payload:
        fail('staged bytes differ from the export: ' + relative)
    row = dict(kind=kind, name=name, path=relative, bytes=len(payload), sha256=digest(payload))
    rows.append(row)
    return row


png = ROOT / '.reference-assets/source-exports/tracers' / texture['png']['path']
stage(texture['png']['path'], png.read_bytes(), 'texture', 'spark')
stage('provenance.json', (json.dumps(dict(
    format='source-tracers-provenance-v1', build=BUILD,
    pcf=receipt['pcf'], material=material_path, shader=material['shader'], body=body,
    texture={key: texture[key] for key in ('source', 'width', 'height', 'vtfFlags', 'vtfMipCount',
                                           'vtfVersion', 'rgbaSha256')},
    nativeSource=receipt['nativeSource'], operatorResolutions=resolutions,
    limitations=table['limitations']), indent=2, ensure_ascii=False) + '\n').encode(),
    'provenance', 'provenance.json')

TABLE.write_text(json.dumps(table, separators=(',', ':'), ensure_ascii=False) + '\n')
RESOURCES.write_text(json.dumps(rows, indent=2) + '\n')

for row in rows:
    print(f'{row["kind"]:9s} {row["name"]:14s} {row["bytes"]:>8,d}  {row["sha256"][:16]}…')
print('table bytes', len(TABLE.read_bytes()))
print('systems', {name: (row['material'], row['speedUnitsPerSecond'], row['radiusUnits'],
                         row['trailLengthSeconds'], row['alphaRange'],
                         row['offsetUnits'], row['renderLengthUnits'])
                  for name, row in systems.items()})
print('weapons', table['weapons'])
