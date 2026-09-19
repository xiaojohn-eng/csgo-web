"""Stage the map's own environment: a runtime table, a staged descriptor, and a receipt.

`scripts/probe-source-environment.py` reads the values out of the frozen BSP and the shipped
build. This script copies the numbers the runtime actually uses into one reviewed table
(`game/source-environment-data.ts`), writes the same descriptor next to the map's other
staged files for `scripts/stage-source-map.py` to list, and refuses to write anything unless
the probe's own report still carries the values the runtime will act on.
"""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'research/source-environment.json'
EXPORT = ROOT / '.reference-assets/source-exports/dust2/environment.json'
PUBLIC = ROOT / 'public/source/csgo-12426148/dust2/environment.json'
TABLE = ROOT / 'game/source-environment-data.ts'
BSP_SHA = 'b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc'
sha = lambda data: hashlib.sha256(data).hexdigest()  # noqa: E731

report = json.loads(REPORT.read_text())
assert report['format'] == 'source-environment-v1', report['format']
assert report['id'] == 'de_dust2' and report['sourceBspSha256'] == BSP_SHA

fog, light = report['fogController'], report['lightEnvironment']
tonemap, sun, shadow = report['tonemapController'], report['sun'], report['shadowControl']
lut = report['colorCorrection']['lut']

# Only the numbers the runtime acts on are copied, and each one is re-asserted here so a
# change to the probe's reading cannot silently become a change to the game.
assert fog['enabled'] is True and fog['color'] == [213, 203, 172] and fog['blend'] is False
assert (fog['sourceStart'], fog['sourceEnd'], fog['maxDensity']) == (512.0, 9000.0, 0.4)
assert light['lightScaleHDR'] == 1.0, light['lightScaleHDR']
assert light['sunColor'] == [254, 230, 197] and light['sunBrightness'] == 575.0
assert light['ambientColor'] == [211, 226, 248] and light['ambientBrightness'] == 245.0
assert tonemap['targetname'] == 'AutoInstance1-tonemap_global'
assert report['postProcess']['allStrengthsZero'] is True
assert lut['againstNeutral']['maxChannelDelta'] <= 2
# The sun sprite: its member table, and the one key the build cannot read. `glowdistancescale` is
# carried by none of the shipped binaries, so the value the map writes is authoring metadata and is
# staged as such rather than as a number the runtime may act on.
assert len(sun['members']) == 8, sun['members'].keys()
assert set(sun['members']['size']) == {'member', 'offset', 'typeCode', 'entry'}
assert sun['members']['size']['member'] == 'm_nSize' and sun['members']['size']['offset'] == 0x4FC
assert sun['members']['angle']['member'] == 'm_flYaw', sun['members']['angle']
assert sun['keyCarriers']['glowdistancescale'] == [], sun['keyCarriers']['glowdistancescale']
assert sun['keyCarriers']['hdrcolorscale'], 'the hdrColorScale key moved out of the client'

environment = {
    'id': report['id'],
    'sourceBspSha256': BSP_SHA,
    'metersPerSourceUnit': report['metersPerSourceUnit'],
    'fog': {
        'enabled': True,
        'color': fog['color'],
        'sourceStart': fog['sourceStart'],
        'sourceEnd': fog['sourceEnd'],
        'maxDensity': fog['maxDensity'],
        'nearMetres': fog['nearMetres'],
        'farMetres': fog['farMetres'],
    },
    'light': {
        'sunColor': light['sunColor'],
        'sunBrightness': light['sunBrightness'],
        'ambientColor': light['ambientColor'],
        'ambientBrightness': light['ambientBrightness'],
        'lightScaleHDR': light['lightScaleHDR'],
        'sunSourceAngles': light['sunSourceAngles'],
        'sunSourcePitch': light['sunSourcePitch'],
        'sunSpreadAngle': light['sunSpreadAngle'],
        'sunSourceDirection': light['sunSourceDirection'],
    },
    'tonemap': {
        'targetname': tonemap['targetname'],
        'percentTarget': tonemap['onMapSpawn']['SetTonemapPercentTarget'],
        'percentBrightPixels': tonemap['onMapSpawn']['SetTonemapPercentBrightPixels'],
        'rate': tonemap['onMapSpawn']['SetTonemapRate'],
        'bloomScale': tonemap['onMapSpawn']['SetBloomScale'],
        'autoExposureMin': tonemap['onMapSpawn']['SetAutoExposureMin'],
        'autoExposureMax': tonemap['onMapSpawn']['SetAutoExposureMax'],
    },
    'sun': {'material': sun['material'], 'size': sun['size'], 'renderColor': sun['renderColor'],
            'overlayMaterial': sun['overlayMaterial'], 'overlaySize': sun['overlaySize'],
            'overlayColor': sun['overlayColor'],
            'sourceAngles': sun['sourceAngles'], 'sourcePitch': sun['sourcePitch'],
            'hdrColorScale': sun['hdrColorScale'],
            'glowDistanceScaleAsWritten': sun['glowDistanceScale'],
            'members': {key: {'member': row['member'], 'offset': row['offset']}
                        for key, row in sun['members'].items()},
            'membersFrom': sun['membersFrom'],
            'note': ('`glowdistancescale` is carried by none of the shipped binaries, so the build '
                     'cannot match that key and the value above is authoring metadata, not a number this '
                     'port can act on. `use_angles 1` means the direction is the entity\'s own `angles` '
                     'with `m_flPitch` replacing the pitch.')},
    'shadow': {'color': shadow['color'], 'distance': shadow['distance'],
               'disableAllShadows': shadow['disableAllShadows'], 'sourceAngles': shadow['sourceAngles']},
    'colorCorrection': {'filename': report['colorCorrection']['filename'],
                        'maxWeight': report['colorCorrection']['maxWeight'],
                        'maxChannelDeltaVsNeutral': lut['againstNeutral']['maxChannelDelta'],
                        'channelsMovedVsNeutral': lut['againstNeutral']['channelsMoved'],
                        'lutSha256': lut['sha256']},
    'postProcess': {'targetname': report['postProcess']['targetname'], 'allStrengthsZero': True},
    'declaredButUnapplied': [
        'The original auto-exposes from a frame histogram: the client carries `mat_dynamic_tonemapping`, '
        '`mat_autoexposure_min`, `mat_autoexposure_max`, `mat_exposure_center_region_x`/`_y` and '
        '`mat_show_histogram`, and the map pushes the operating range into that system on spawn. The port '
        'renders with a fixed exposure, so the map\'s range is recorded and not applied.',
        'The original draws the sun sprite `env_sun` names and the port draws none. What is read is the '
        'map\'s own entity, the build\'s member table for it (`m_strMaterial` 0x4e0 through `m_clrOverlay` '
        '0x504) and the fact that `glowdistancescale` is a key no shipped binary carries. What is not read '
        'is the client\'s draw arithmetic - how `m_nSize` becomes a screen size, when the '
        '`m_nOverlaySize -1` overlay is skipped - and `sprites/light_glow02_add_noz` is not exported, so '
        'nothing is drawn rather than something approximated.',
        'The original fades a projected shadow with the receiver\'s height above the shadow\'s own '
        'plane and lets the viewmodel project its own shadow; the port draws each actor\'s '
        'silhouette on the first surface below it and neither fades with height nor draws the '
        'viewmodel\'s shadow.',
        'The original grades the finished frame through the colour-correction lookup; the port applies '
        'none, which costs at most one step of 255 on 13% of the cube (measured in the report).',
    ],
}

EXPORT.write_text(json.dumps(environment, ensure_ascii=False, separators=(',', ':')) + '\n')
PUBLIC.write_bytes(EXPORT.read_bytes())

sources = report['sources']
table = f'''/**
 * The original Dust2 environment, generated from the shipped map and build.
 *
 * Generated by `scripts/stage-source-environment.py` from `research/source-environment.json`,
 * which `scripts/probe-source-environment.py` produced by reading the frozen BSP's own entity
 * lump twice (here and in the reviewed SourceIO export) and the shipped build's own key tables.
 * `tests/source-environment.test.ts` reads the report back and compares, so this table cannot
 * drift from the measurement silently.
 *
 * Source hashes at generation:
 *   de_dust2.bsp     {BSP_SHA}
 *   entities.json    {sources['entitiesJsonSha256']}
 *   server.dll       {sources['serverDllSha256']}
 *   server_client.so {sources['serverClientSoSha256']}
 *   client.dll       {sources['clientDllSha256']}
 *   cc_dust2.raw     {lut['sha256']}
 */
export const SOURCE_DUST2_ENVIRONMENT_DATA: unknown = {json.dumps(environment, ensure_ascii=False, indent=2)};

export const SOURCE_DUST2_ENVIRONMENT_SOURCES = {{
  sourceBspSha256: '{BSP_SHA}',
  entitiesJsonSha256: '{sources['entitiesJsonSha256']}',
  serverDllSha256: '{sources['serverDllSha256']}',
  serverClientSoSha256: '{sources['serverClientSoSha256']}',
  clientDllSha256: '{sources['clientDllSha256']}',
  colorCorrectionLutSha256: '{lut['sha256']}',
  environmentJsonSha256: '{sha(EXPORT.read_bytes())}',
}} as const;
'''
TABLE.write_text(table)
print(json.dumps({'table': str(TABLE), 'staged': str(PUBLIC), 'bytes': PUBLIC.stat().st_size,
                  'fog': environment['fog'], 'lightScaleHDR': environment['light']['lightScaleHDR'],
                  'unapplied': len(environment['declaredButUnapplied'])}, ensure_ascii=False))
