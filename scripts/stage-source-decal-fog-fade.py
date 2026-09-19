"""Stage the original's decal fog fade as a runtime table.

`scripts/probe-source-decal-fog-fade.py` reads the fade out of the shipped `DecalModulate` and the
shipped decal materials. This script copies the numbers the runtime acts on into one reviewed table
(`game/source-decal-fog-fade-data.ts`), with the program it transcribes and the sheets it applies
to, and refuses to write unless the probe's report still says what the runtime will do.
"""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'research/source-decal-fog-fade.json'
TABLE = ROOT / 'game/source-decal-fog-fade-data.ts'
sha = lambda data: hashlib.sha256(data).hexdigest()  # noqa: E731

report = json.loads(REPORT.read_text())
assert report['format'] == 'source-decal-fog-fade-v1', report['format']

shader = report['shader']
parameters = {row['name']: row['default'] for row in shader['parameters']}
assert parameters == {'$FOGEXPONENT': '0.4', '$FOGSCALE': '1.0',
                      '$FOGFADESTART': None, '$FOGFADEEND': None}, parameters
assert [row['define'] for row in shader['flags']] == ['VERTEXALPHA', 'FOGFADE', 'PIXELFOGTYPE'], shader

programs = report['container']['programs']
fade = programs['0x2/0']
plain = programs['0x0/0']
vertex = programs['0x1/1']
assert report['container']['statics'] == ['0x0', '0x1', '0x2', '0x3'], report['container']['statics']
assert len(fade['instructions']) == 21 and len(plain['instructions']) == 16, (fade, plain)
# The two programs differ exactly by the fade: the fade program carries the lerp toward the
# neutral value the others do not.
assert 'lrp r2.xyz, r1.yyyy, c1.xxxx, r0.xyzw' in fade['instructions'], fade
assert not [line for line in plain['instructions'] if ', c1.xxxx,' in line], plain

atlases = report['reachableAtlases']
sheet = atlases['decals/decals_bulletsheet']
other = atlases['decals/decals_mod2x']
assert sheet['stated'] == {'fogfadeend': 0.5} and other['stated'] == {}, (sheet, other)
assert sheet['materials'] + other['materials'] == 42, (sheet, other)
assert report['sources']['sheets']['decals/decals_bulletsheet']['named'][-1] == 'sRGB'

# The fade a material asks for is the shader's own defaults with the material's own numbers laid
# over them: `$FOGSCALE` 1.0 and `$FOGEXPONENT` 0.4 are declared with those values, and the two
# bounds are declared with none, so a material that states its end value is the only place the
# fade can come from.
DEFAULTS = {'fadeStart': 0.0, 'scale': 1.0, 'exponent': 0.4}
fade_atlases = {}
for name, row in sorted(atlases.items()):
    if not row['stated']:
        fade_atlases[name] = None
        continue
    assert set(row['stated']) == {'fogfadeend'}, row
    fade_atlases[name] = {'fadeStart': DEFAULTS['fadeStart'], 'fadeEnd': row['stated']['fogfadeend'],
                          'scale': DEFAULTS['scale'], 'exponent': DEFAULTS['exponent']}

data = {
    'format': 'source-decal-fog-fade-v1',
    'shaderSha256': shader['sha256'],
    # What the shader declares for each of the four: two state a value and two state none, which is
    # why a material that wants the fade has to state its own end. An unstated float is zero, so the
    # effective start of a sheet that states only its end is zero.
    'declared': {'exponent': '0.4', 'scale': '1.0', 'fadeStart': None, 'fadeEnd': None},
    'neutral': 0.5,
    'programs': {
        'fade': {'static': fade['static'], 'dynamic': fade['dynamic'], 'sha256': fade['sha256'],
                 'instructions': fade['instructions']},
        'plain': {'static': plain['static'], 'dynamic': plain['dynamic'], 'sha256': plain['sha256'],
                  'instructions': plain['instructions']},
        'vertexAlpha': {'static': vertex['static'], 'dynamic': vertex['dynamic'],
                        'sha256': vertex['sha256'], 'instructions': vertex['instructions']},
    },
    'fadeAtlases': fade_atlases,
    'limitations': [
        'The shader\'s own `VERTEXALPHA` variant scales the decal texel toward its neutral by the '
        'vertex alpha; this renderer\'s decal quads carry no vertex colour, so that factor is one '
        'and the variant is not drawn separately.',
        'The shipped `$nofog` dynamic combo - the same decal with no fog arithmetic at all - is not '
        'asked for by either sheet this map draws from, so this renderer always computes the fog.',
        'The engine\'s static combo key was not read: the port keys the fade off the material\'s own '
        'stated bound, which is the value the arithmetic requires and which every shipped material '
        'that uses the fade states.',
        'The sheet carries the sRGB flag, and the port samples it as stored: DX9 has no sRGB sampler '
        'decode for the DXT formats these sheets ship as, and the shipped program carries no '
        'conversion of its own, so the texel it multiplies is the stored one and the port must '
        'multiply in the same encoding the framebuffer holds.',
    ],
}

table = f'''/**
 * The original decal fog fade, generated from the shipped build and materials.
 *
 * Generated by `scripts/stage-source-decal-fog-fade.py` from `research/source-decal-fog-fade.json`,
 * which `scripts/probe-source-decal-fog-fade.py` produced by reading the shipped `DecalModulate`'s
 * own parameter declarations, its `ps_2_b` combos and the decal materials this map's impacts reach.
 * `tests/source-decal-fog-fade.test.ts` reads the report back and compares, so this table cannot
 * drift from the measurement silently.
 *
 * Source hashes at generation:
 *   stdshader_dx9_client.so  {shader['sha256']}
 *   decalmodulate_ps20b.vcs  {report['container']['sha256']}
 */
export const SOURCE_DECAL_FOG_FADE_DATA: unknown = {json.dumps(data, ensure_ascii=False, indent=2)};

export const SOURCE_DECAL_FOG_FADE_SOURCES = {{
  shaderSha256: '{shader['sha256']}',
  containerSha256: '{report['container']['sha256']}',
  fadeProgramSha256: '{fade['sha256']}',
}} as const;
'''
TABLE.write_text(table)

print(json.dumps({'table': str(TABLE), 'bytes': TABLE.stat().st_size,
                  'fadeSha': fade['sha256'][:16], 'fadeInstructions': len(fade['instructions']),
                  'plainSha': plain['sha256'][:16], 'plainInstructions': len(plain['instructions']),
                  'atlases': {name: row for name, row in fade_atlases.items()}}, ensure_ascii=False))
