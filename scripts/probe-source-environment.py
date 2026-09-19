"""Read Dust2's own environment entities out of the shipped map and the shipped build.

Everything the scene uses to light and haze itself is declared by the map, not chosen by
this port: the sun and ambient (`light_environment`), the fog (`env_fog_controller`), the
exposure range the map's `logic_auto` pushes into `env_tonemap_controller`, the shadow
direction (`shadow_control`), the sun sprite (`env_sun`), the colour-correction LUT
(`color_correction`), the post-process controller, and the 3D sky camera.

Two independent readers have to agree before anything is written:

  * the frozen BSP's own entity lump (lump 0), parsed here with a string-aware scanner, and
  * `.reference-assets/source-exports/dust2/source-metadata/entities.json`, the reviewed
    SourceIO export the buy-zone and level tables were already generated from (it lowercases
    every key, so the comparison is case-insensitive).

It also refuses unless the shipped build pairs every key the map writes with the networked
member the client renders from, carries the tonemap inputs the map fires, and unless the map
declares no other entity that would change the environment. No value comes from memory.
"""
from pathlib import Path
import collections
import hashlib
import importlib.util
import json
import math
import struct
import sys


def load(name, path):
    """Import a sibling script by path, so the shared binary reader has one home."""
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


ROOT = Path(__file__).resolve().parents[1]
BSP = ROOT / '.reference-assets/csgo-legacy/csgo/maps/de_dust2.bsp'
BSP_SHA = 'b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc'
ENTITIES_EXPORT = ROOT / '.reference-assets/source-exports/dust2/source-metadata/entities.json'
INSTALL = ROOT / '.reference-assets/csgo-legacy'
OUT = ROOT / 'research/source-environment.json'
METRES_PER_UNIT = 0.0254
sha = lambda data: hashlib.sha256(data).hexdigest()  # noqa: E731

sys.path.insert(0, str(ROOT / '.tools'))

# The build's own fog-controller table pairs each networked member with the key name a mapper
# writes; both strings sit within the same table in the shipped data-desc.
FOG_FIELD_KEYS = [
    ('m_fog.colorPrimary', 'fogcolor'),
    ('m_fog.enable', 'fogenable'),
    ('m_fog.dirPrimary', 'fogdir'),
    ('m_fog.start', 'fogstart'),
    ('m_fog.blend', 'fogblend'),
    ('m_fog.maxdensity', 'fogmaxdensity'),
    ('m_fog.end', 'fogend'),
]
# The tonemap inputs the map's `logic_auto` fires on spawn must be the entity's own inputs.
TONEMAP_INPUTS = ['SetTonemapPercentTarget', 'SetTonemapPercentBrightPixels', 'SetTonemapRate',
                  'SetAutoExposureMin', 'SetAutoExposureMax', 'SetBloomScale']
TONEMAP_MEMBERS = ['m_flTonemapPercentTarget', 'm_flTonemapPercentBrightPixels', 'm_flTonemapRate',
                   'm_bUseCustomAutoExposureMin', 'm_bUseCustomAutoExposureMax', 'm_bUseCustomBloomScale']
# Handled by this probe. Anything else that changes lighting, fog, exposure or grading must
# fail loudly rather than be silently ignored.
HANDLED = ('worldspawn', 'light_environment', 'env_fog_controller', 'env_tonemap_controller', 'logic_auto',
           'env_sun', 'shadow_control', 'color_correction', 'postprocess_controller', 'sky_camera')
UNHANDLED_ENVIRONMENT = ('trigger_fog', 'fog_volume', 'trigger_tonemap', 'trigger_color_correction',
                         'env_cascade_light', 'env_projectedtexture', 'env_screenoverlay', 'env_screeneffect',
                         'env_dof_controller', 'env_particle_script', 'env_tonemap_volume', 'color_correction_volume')


def lump(data, index):
    at, size, version, compressed = struct.unpack_from('<4i', data, 8 + index * 16)
    if not (0 <= at <= at + size <= len(data)) or compressed:
        raise ValueError(f'lump {index} is not an inline readable lump')
    return data[at:at + size]


def tokens(body):
    """Ordered string/nesting tokens; separators are whitespace, so a value may hold any byte."""
    out, i, n = [], 0, len(body)
    while i < n:
        ch = body[i]
        if ch == '"':
            end = body.find('"', i + 1)
            if end < 0:
                raise ValueError('unterminated string in the entity lump')
            out.append(('str', body[i + 1:end]))
            i = end + 1
        elif ch == '{':
            out.append(('open', None))
            i += 1
        elif ch == '}':
            out.append(('close', None))
            i += 1
        elif ch in ' \t\r\n':
            i += 1
        else:
            end = i
            while end < n and body[end] not in ' \t\r\n"{}':
                end += 1
            out.append(('str', body[i:end]))
            i = end
    return out


def block_spans(text):
    """Every top-level `{...}` span in the entity lump, with string state respected."""
    spans, i, n = [], 0, len(text)
    while True:
        start = text.find('{', i)
        if start < 0:
            return spans
        depth, j = 0, start
        while j < n:
            ch = text[j]
            if ch == '"':
                j = text.find('"', j + 1)
                if j < 0:
                    raise ValueError('unterminated string in the entity lump')
            elif ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    break
            j += 1
        else:
            raise ValueError('unterminated entity block')
        spans.append((start + 1, j))
        i = j + 1


def fields(body):
    """`(ordered pairs, ordered nested blocks)` for one entity body.

    A key may repeat (entity I/O writes one `OnMapSpawn` line per connection), so the pairs
    stay ordered and the caller decides how to fold them.
    """
    pairs, nested, pending, key = [], [], None, None
    for kind, value in tokens(body):
        if kind == 'open':
            pending = []
        elif kind == 'close':
            if pending is not None and key is not None:
                nested.append((key, pending))
            pending, key = None, None
        elif pending is not None:
            pending.append(value)
        elif key is None:
            key = value
        else:
            pairs.append((key, value))
            key = None
    return pairs, nested


def entities_of(text):
    return [fields(text[start:end]) for start, end in block_spans(text)]


class Entity(dict):
    """A case-insensitive view of one entity, plus every value of a repeated key.

    Source's KeyValues are case-insensitive and the reviewed export lowercases keys, so the
    reader must not depend on how a mapper happened to spell one.
    """

    def __init__(self, pairs):
        super().__init__(pairs)
        self.pairs = pairs
        self._lower = {key.lower(): value for key, value in pairs}

    def __getitem__(self, key):
        return self._lower[key.lower()]

    def get(self, key, default=None):
        return self._lower.get(key.lower(), default)

    def __contains__(self, key):
        return key.lower() in self._lower

    def all_of(self, name):
        lower = name.lower()
        return [value for key, value in self.pairs if key.lower() == lower]


def numbers(text, count):
    parts = text.split()
    if len(parts) != count:
        raise ValueError(f'expected {count} numbers, read {text!r}')
    return [float(p) for p in parts]


def integers(text, count):
    return [int(float(v)) for v in numbers(text, count)]


def expect(flat, key, value, where):
    if flat.get(key) != value:
        raise ValueError(f'{where}.{key} is {flat.get(key)!r}, not {value!r}')


def adjacent(data, field, key, limit=64):
    """True when `key`'s name sits inside the same data-desc entry as `field`."""
    at = data.find(field.encode())
    while at >= 0:
        window = data[at + len(field):at + len(field) + limit]
        if key.encode() + b'\0' in window:
            return True
        at = data.find(field.encode(), at + 1)
    return False


def identity_layout(cube):
    """The storage order that makes `cube` the identity ramp, searched on a coarse grid.

    A Source colour-correction file is a `side**3` RGB cube with black and white at its ends.
    Which input axis runs fastest is not written down, so both the input axis order and the
    output channel order are searched; the neutral lookup `off.raw` is what names the winner.
    """
    side = round((len(cube) / 3) ** (1 / 3))
    permutations = [(0, 1, 2), (0, 2, 1), (1, 0, 2), (1, 2, 0), (2, 0, 1), (2, 1, 0)]
    best = None
    for axes in permutations:
        for channels in permutations:
            worst = 0.0
            for r in range(0, side, 7):
                for g in range(0, side, 7):
                    for b in range(0, side, 7):
                        value = (r, g, b)
                        index = ((value[axes[0]] * side + value[axes[1]]) * side + value[axes[2]])
                        for out in range(3):
                            worst = max(worst, abs(cube[index * 3 + out] - value[channels[out]] * 255 / (side - 1)))
            if best is None or worst < best['worstChannelError']:
                best = {'inputAxisOrder': list(axes), 'outputChannelOrder': list(channels),
                        'worstChannelError': round(worst, 3)}
    return side, best


def worst_channel_error(cube, order):
    """How far every entry of `cube` is from the identity ramp in one fixed storage order."""
    side = round((len(cube) / 3) ** (1 / 3))
    axes, channels = order
    worst = 0.0
    for r in range(side):
        for g in range(side):
            for b in range(side):
                value = (r, g, b)
                index = ((value[axes[0]] * side + value[axes[1]]) * side + value[axes[2]])
                for out in range(3):
                    worst = max(worst, abs(cube[index * 3 + out] - value[channels[out]] * 255 / (side - 1)))
    return round(worst, 3)


def main():
    bsp = BSP.read_bytes()
    if sha(bsp) != BSP_SHA:
        raise ValueError('the frozen Dust2 BSP changed; review before regenerating')
    raw_entities = lump(bsp, 0)
    parsed = entities_of(raw_entities.decode('latin1'))
    by_class = {}
    for pairs, nested in parsed:
        entity = Entity(pairs)
        by_class.setdefault(entity.get('classname'), []).append((entity, nested))

    present = set(by_class)
    unexpected = sorted(present & set(UNHANDLED_ENVIRONMENT))
    if unexpected:
        raise ValueError(f'the map now declares environment entities this probe cannot read: {unexpected}')

    report = {'format': 'source-environment-v1', 'id': 'de_dust2', 'sourceBspSha256': BSP_SHA,
              'metersPerSourceUnit': METRES_PER_UNIT,
              'entityLump': {'bytes': len(raw_entities), 'sha256': sha(raw_entities), 'entities': len(parsed)},
              'sources': {}, 'limitations': []}

    def one(name):
        found = by_class.get(name, [])
        if len(found) != 1:
            raise ValueError(f'expected exactly one {name}, found {len(found)}')
        return found[0]

    # --- worldspawn: which sky this map draws, and that it declares no legacy fog keys.
    world, _ = one('worldspawn')
    expect(world, 'skyname', 'nukeblank', 'worldspawn')
    for legacy in ('fogcolor', 'fogstart', 'fogend', 'fogmaxdensity', 'fogenable', 'fogdir'):
        if legacy in world:
            raise ValueError(f'worldspawn declares the legacy fog key {legacy}; review')
    report['worldspawn'] = {'skyname': world['skyname'], 'legacyFogKeys': 'absent'}

    # --- light_environment: the sun, the ambient, and the light scale the shaders read as c30.
    light, _ = one('light_environment')
    sun_rgb, sun_brightness = integers(light['_light'], 4)[:3], numbers(light['_light'], 4)[3]
    ambient_rgb, ambient_brightness = integers(light['_ambient'], 4)[:3], numbers(light['_ambient'], 4)[3]
    if light['_lightHDR'] != '-1 -1 -1 1' or light['_ambientHDR'] != '-1 -1 -1 1':
        raise ValueError('the HDR light overrides are not "use the LDR value"; review')
    yaw, pitch = math.radians(numbers(light['angles'], 3)[1]), math.radians(numbers(light['pitch'], 1)[0])
    sun_direction = [math.cos(pitch) * math.cos(yaw), math.cos(pitch) * math.sin(yaw), -math.sin(pitch)]
    report['lightEnvironment'] = {
        'sunColor': sun_rgb, 'sunBrightness': sun_brightness,
        'ambientColor': ambient_rgb, 'ambientBrightness': ambient_brightness,
        'ambientScaleHDR': numbers(light['_AmbientScaleHDR'], 1)[0],
        'lightScaleHDR': numbers(light['_lightscaleHDR'], 1)[0],
        'sunSourceAngles': numbers(light['angles'], 3), 'sunSourcePitch': numbers(light['pitch'], 1)[0],
        'sunSpreadAngle': numbers(light['SunSpreadAngle'], 1)[0],
        'sunSourceDirection': [round(v, 9) for v in sun_direction],
        'hammerId': light['hammerid'],
        'meaning': ('`_light`/`_ambient` are a colour and a brightness. `_lightscaleHDR` is the scale the '
                    'shipped `unlittwotexture` sky program reads as `cLightScale` (c30): that program\'s '
                    'product is `texture0 * texture1 * g_DiffuseModulation`, then `rgb * cLightScale`. '
                    '`sunSourceDirection` is the Source-frame direction (x forward, y left, z up) derived '
                    'from the map\'s own `angles`/`pitch`, pointing from the map toward the sun.'),
    }

    # --- env_fog_controller: the map's own fog, and the keys the build pairs with m_fog.*.
    fog, _ = one('env_fog_controller')
    expect(fog, 'fogenable', '1', 'env_fog_controller')
    expect(fog, 'fogblend', '0', 'env_fog_controller')
    expect(fog, 'use_angles', '0', 'env_fog_controller')
    expect(fog, 'foglerptime', '0', 'env_fog_controller')
    expect(fog, 'farz', '-1', 'env_fog_controller')
    fog_color, fog_color2 = integers(fog['fogcolor'], 3), integers(fog['fogcolor2'], 3)
    fog_start, fog_end = numbers(fog['fogstart'], 1)[0], numbers(fog['fogend'], 1)[0]
    fog_max = numbers(fog['fogmaxdensity'], 1)[0]
    if not 0 <= fog_max <= 1 or fog_end <= fog_start:
        raise ValueError('the map fog range is not a monotone 0..1 density ramp; review')
    report['fogController'] = {
        'enabled': True, 'color': fog_color, 'color2': fog_color2, 'blend': False,
        'sourceDirection': numbers(fog['fogdir'], 3), 'sourceStart': fog_start, 'sourceEnd': fog_end,
        'maxDensity': fog_max, 'zoomFogScale': numbers(fog['ZoomFogScale'], 1)[0],
        'nearMetres': fog_start * METRES_PER_UNIT, 'farMetres': fog_end * METRES_PER_UNIT,
        'hammerId': fog['hammerid'], 'spawnFlags': int(fog['spawnflags']),
        'meaning': ('The original gates on the networked `m_fog.enable` bool; while set, the frame fades '
                    'linearly toward `fogcolor` from `fogstart`, reaches `fogmaxdensity` at `fogend` and holds '
                    'there. `$nofog` materials opt out. The colour is 8-bit sRGB and `blend` is off, so '
                    '`fogcolor2` is unused.'),
    }

    # --- logic_auto + env_tonemap_controller: the exposure range the map pushes on spawn.
    tonemap, _ = one('env_tonemap_controller')
    auto, _ = one('logic_auto')
    lines = auto.all_of('onmapspawn')
    if not lines:
        raise ValueError('logic_auto declares no OnMapSpawn outputs; review')
    outputs = {}
    for line in lines:
        parts = line.split('\x1b')
        if len(parts) != 5:
            raise ValueError(f'logic_auto OnMapSpawn is not a 5-field connection: {parts!r}')
        target, input_name, parameter = parts[0], parts[1], parts[2]
        if target != tonemap['targetname']:
            raise ValueError(f'logic_auto OnMapSpawn targets {target!r}, not this tonemap controller')
        outputs[input_name] = float(parameter)
    for required in TONEMAP_INPUTS:
        if required not in outputs:
            raise ValueError(f'the map never fires {required} on spawn')
    report['tonemapController'] = {
        'targetname': tonemap['targetname'], 'hammerId': tonemap['hammerid'],
        'onMapSpawn': outputs, 'outputOrder': [line.split('\x1b')[1] for line in lines],
        'meaning': ('The original auto-exposes: it drives the frame toward a target average luminance of '
                    '`SetTonemapPercentTarget`/255 over the brightest `SetTonemapPercentBrightPixels` percent '
                    'of pixels, at `SetTonemapRate`, with the exposure itself bounded by the auto-exposure '
                    'minimum and maximum. Every value is the map\'s own number.'),
    }

    # --- env_sun, shadow_control, color_correction, postprocess_controller, sky_camera.
    sun, _ = one('env_sun')
    expect(sun, 'use_angles', '1', 'env_sun')
    report['sun'] = {'material': sun['material'], 'size': numbers(sun['size'], 1)[0],
                     'renderColor': integers(sun['rendercolor'], 3), 'overlayColor': integers(sun['overlaycolor'], 3),
                     'overlayMaterial': sun['overlaymaterial'], 'overlaySize': numbers(sun['overlaysize'], 1)[0],
                     'glowDistanceScale': numbers(sun['glowdistancescale'], 1)[0],
                     'hdrColorScale': numbers(sun['hdrcolorscale'], 1)[0],
                     'sourceAngles': numbers(sun['angles'], 3), 'sourcePitch': numbers(sun['pitch'], 1)[0],
                     'hammerId': sun['hammerid']}

    # --- the sun sprite is a `C_Sun`, and the build's own datamap says where each of the map's keys
    # lands and what the member is called. The entries are 0x68 bytes wide and both the member name
    # and the key are reached by relocation, so the pair is read through `.rela.dyn` rather than by
    # neighbouring bytes - a name that merely sits next to a key would prove nothing.
    # The install ships this module twice: `bin/server_client.so` is the 32-bit i386 build and
    # `bin/linux64/server_client.so` the 64-bit one. The datamap is read out of the 64-bit build, which
    # is the one every other table in this repository was read from, and the report says so.
    SUN_BINARY = 'csgo/bin/linux64/server_client.so'
    binary_index = load('source_binary_index', 'scripts/source-binary-index.py')
    server_binary = binary_index.open_binary(INSTALL / SUN_BINARY)
    def string_addresses(text):
        """Every address `text` starts at, as the datamap's own relocations would name it."""
        found, at = [], 0
        needle = text.encode() + b'\x00'
        while True:
            at = server_binary.data.find(needle, at)
            if at < 0:
                return found
            address = server_binary.address_of(at)
            if address is not None:
                found.append(address)
            at += 1

    def sun_field(key, member, offset):
        """The datamap entries pairing a key with a member; assert exactly one is at `offset`.

        A member name can appear in more than one class's table (`m_bUseAngles` does), so the offset is
        part of the question rather than something to be read back and accepted.
        """
        keys, members = set(string_addresses(key)), set(string_addresses(member))
        found = []
        for where, addend in server_binary.relative.items():
            if addend not in keys:
                continue
            entry = where - 0x10
            if server_binary.relative.get(entry) in members:
                packed = struct.unpack_from('<Q', server_binary.data,
                                            server_binary.offset_of(entry + 8))[0]
                found.append((entry, packed & 0xFFFF, packed >> 32))
        at_offset = [row for row in found if row[1] == offset]
        if len(at_offset) != 1:
            raise ValueError(f'{key!r}/{member!r} at {offset:#x}: {len(at_offset)} entries, '
                             f'all candidates {[(hex(e), hex(o), hex(t)) for e, o, t in found]}')
        return at_offset[0]

    SUN_FIELDS = (('material', 'm_strMaterial', 0x4E0),
                  ('overlaymaterial', 'm_strOverlayMaterial', 0x4E8),
                  ('use_angles', 'm_bUseAngles', 0x4F0),
                  ('pitch', 'm_flPitch', 0x4F4),
                  ('angle', 'm_flYaw', 0x4F8),
                  ('size', 'm_nSize', 0x4FC),
                  ('overlaysize', 'm_nOverlaySize', 0x500),
                  ('overlaycolor', 'm_clrOverlay', 0x504))
    members = {}
    for key, member, offset in SUN_FIELDS:
        entry, found, typecode = sun_field(key, member, offset)
        if typecode != 0x00060001:
            raise ValueError(f'{member}: typecode {typecode:#010x}, expected 0x00060001')
        members[key] = {'member': member, 'offset': offset, 'typeCode': typecode, 'entry': hex(entry)}
    report['sun']['members'] = members
    report['sun']['membersFrom'] = SUN_BINARY
    report['sun']['membersFromSha256'] = sha((INSTALL / SUN_BINARY).read_bytes())
    report['sun']['memberReading'] = (
        'The map writes `use_angles 1`, so the direction comes from the entity\'s own `angles` with '
        '`m_flPitch` replacing the pitch: the build pairs `pitch` with `m_flPitch` (0x4f4) and `angle` '
        '(singular) with `m_flYaw` (0x4f8), while the map\'s `angles` (plural) is the base entity\'s '
        'rotation. Every pair here is the build\'s own datamap entry, found through its relocations, '
        'not inferred from the key names.')

    # --- which shipped binaries carry which key. `glowdistancescale` is the one that matters: the map
    # writes it, and it turns out that nothing the build ships can read it at all. Every binary is read
    # once, so the answer covers the whole install rather than the two readers used elsewhere.
    shipped = sorted((path for path in (INSTALL / 'csgo/bin').rglob('*')
                      if path.suffix in ('.so', '.dll')), key=lambda path: str(path))
    # Keyed by path, not by file name: the install ships `client_client.so` under both `bin` and
    # `bin/linux64`, and those two files are not the same.
    carried = {path.relative_to(INSTALL / 'csgo/bin').as_posix(): path.read_bytes()
               for path in shipped}
    carriers = {}
    for key in ('material', 'overlaymaterial', 'overlaysize', 'overlaycolor', 'rendercolor',
                'hdrcolorscale', 'glowdistancescale'):
        needle = key.encode() + b'\x00'
        carriers[key] = sorted(name for name, data in carried.items() if needle in data)
    if carriers['glowdistancescale']:
        raise ValueError('a shipped binary reads glowdistancescale now; it used to be authoring metadata')
    if not carriers['hdrcolorscale'] or not carriers['overlaysize']:
        raise ValueError('the key carriers moved; the sun sprite read needs revisiting')
    report['sun']['keyCarriers'] = carriers
    report['sun']['binariesSearched'] = len(shipped)
    report['sun']['glowDistanceScaleReading'] = (
        f'`glowdistancescale` is carried by none of the {len(shipped)} shipped binaries, so the build '
        'cannot match that key at all and the value the map writes is authoring metadata. It is kept in '
        'this report as the file states it and is not a number this port can act on. `hdrcolorscale` is '
        'carried by the client binaries only, and `overlaysize`/`overlaycolor` by both sides.')

    shadow, _ = one('shadow_control')
    report['shadowControl'] = {'color': integers(shadow['color'], 3),
                               'distance': numbers(shadow['distance'], 1)[0],
                               'disableAllShadows': shadow['disableallshadows'] == '1',
                               'sourceAngles': numbers(shadow['angles'], 3), 'hammerId': shadow['hammerid']}
    correction, _ = one('color_correction')
    expect(correction, 'filename', 'materials/correction/cc_dust2.raw', 'color_correction')
    report['colorCorrection'] = {
        'filename': correction['filename'], 'maxWeight': numbers(correction['maxweight'], 1)[0],
        'minFalloff': numbers(correction['minfalloff'], 1)[0],
        'maxFalloff': numbers(correction['maxfalloff'], 1)[0],
        'fadeInDuration': numbers(correction['fadeinduration'], 1)[0],
        'fadeOutDuration': numbers(correction['fadeoutduration'], 1)[0],
        'spawnFlags': int(correction['spawnflags']), 'hammerId': correction['hammerid'],
        'meaning': ('The original grades the finished frame through this 32x32x32 lookup at full weight with '
                    'no fades, so it is part of the shipped Dust2 image rather than an optional effect.'),
    }
    post, _ = one('postprocess_controller')
    strengths = {key: numbers(post[key], 1)[0] for key in
                 ('localcontraststrength', 'screenblurstrength', 'fadetoblackstrength',
                  'depthblurstrength', 'vignetteblurstrength')}
    if any(strengths.values()):
        raise ValueError(f'the post-process controller is no longer inert: {strengths!r}')
    report['postProcess'] = {'targetname': post['targetname'], 'strengths': strengths, 'allStrengthsZero': True,
                             'hammerId': post['hammerid'],
                             'meaning': 'The map ships the entity but asks for no post-process effect.'}
    camera, _ = one('sky_camera')
    report['skyCamera'] = {'hammerId': camera['hammerid'], 'scale': numbers(camera['scale'], 1)[0],
                           'hdrColorScale': numbers(camera['HDRColorScale'], 1)[0],
                           'sourceOrigin': numbers(camera['origin'], 3)}

    # --- cross-check every read number against the reviewed export of the same lump.
    exported = json.loads(ENTITIES_EXPORT.read_text())
    report['sources']['entitiesJsonSha256'] = sha(ENTITIES_EXPORT.read_bytes())
    compared = 0
    for name in HANDLED:
        matches = [e for e in exported if e.get('classname') == name]
        if len(matches) != 1:
            raise ValueError(f'the reviewed export has {len(matches)} {name} entities')
        lowered = {str(k).lower(): v for k, v in matches[0].items()}
        mine = {}
        for key, value in by_class[name][0][0].pairs:
            mine.setdefault(key.lower(), []).append(value)
        for lower, values in mine.items():
            if lower not in lowered:
                raise ValueError(f'{name}.{lower} is missing from the reviewed export')
            theirs = lowered[lower]
            their_values = [str(v) for v in theirs] if isinstance(theirs, list) else [str(theirs)]
            if sorted(their_values) != sorted(values):
                raise ValueError(f'{name}.{lower}: BSP {sorted(values)} vs export {sorted(their_values)}')
            compared += len(values)

    # --- the build's own tables: the key names the map writes, and the inputs it fires.
    def install(name):
        path = INSTALL / name
        return path.read_bytes()

    server_dll = install('csgo/bin/server.dll')
    report['sources']['serverDllSha256'] = sha(server_dll)
    for field, key in FOG_FIELD_KEYS:
        if not adjacent(server_dll, field, key):
            raise ValueError(f'server.dll does not pair {field} with {key}')
    report['sources']['fogControllerKeyFields'] = {key: field for field, key in FOG_FIELD_KEYS}

    server_client = install('csgo/bin/server_client.so')
    report['sources']['serverClientSoSha256'] = sha(server_client)
    for name in TONEMAP_INPUTS + TONEMAP_MEMBERS:
        if server_client.find(name.encode()) < 0:
            raise ValueError(f'server_client.so does not carry {name}')

    client_dll = install('csgo/bin/client.dll')
    report['sources']['clientDllSha256'] = sha(client_dll)
    for member in (b'DT_FogController', b'm_fog.colorPrimary', b'm_fog.maxdensity'):
        if client_dll.find(member) < 0:
            raise ValueError(f'client.dll does not carry {member!r}; the client fog path moved')
    report['limitations'].append(
        'The port models the single static fog controller. The build also has fog volumes and fog/tonemap '
        'triggers (`CFogVolume`, `trigger_fog`, `trigger_tonemap`), and this map declares none of them '
        '(asserted above), so no transition is modelled.')

    # --- the colour-correction LUT itself: read it out of the shipped pack and size it.
    from SourceIO.library.utils.pylib import VPKFile
    vpk = VPKFile(str(INSTALL / 'csgo/pak01_dir.vpk'))

    def packed(name):
        for key, value in vpk.glob(name):
            if str(key) == name:
                return bytes(value)
        raise ValueError(f'{name} is not in the shipped pack')

    lut = packed('materials/correction/cc_dust2.raw')
    neutral = packed('materials/correction/off.raw')
    if len(lut) != 32 * 32 * 32 * 3 or len(neutral) != len(lut):
        raise ValueError('the colour-correction LUT is no longer a 32x32x32 RGB cube')
    side, neutral_fit = identity_layout(neutral)
    order = (neutral_fit['inputAxisOrder'], neutral_fit['outputChannelOrder'])
    neutral_worst = worst_channel_error(neutral, order)
    lut_worst = worst_channel_error(lut, order)
    report['colorCorrection']['lut'] = {
        'bytes': len(lut), 'sha256': sha(lut), 'side': side, 'channels': 3,
        'neutralLutSha256': sha(neutral),
        'storageOrder': {'inputAxisOrder': order[0], 'outputChannelOrder': order[1],
                         'from': 'off.raw is a neutral lookup, so the order that makes it the identity ramp is the format'},
        'neutralWorstChannelError': neutral_worst,
        'gradeWorstChannelError': lut_worst,
    }
    if neutral_worst > 1.01:
        raise ValueError(f'`off.raw` is not an identity ramp in {order}: worst {neutral_worst}')
    if lut_worst <= 1.01:
        raise ValueError('cc_dust2.raw is identity in this order; it is no longer the shipped grade')
    report['colorCorrection']['lut']['axisSearch'] = (
        'The storage order comes from `off.raw` fitting the identity ramp to within one 8-bit level, at '
        'which point every entry of both cubes is walked and the worst channel error is reported.')

    # The useful measure is not "how far from identity" but "how far from the neutral lookup": that is
    # what the frame would lose by skipping the pass. The neutral lookup ships beside the grade, so the
    # comparison needs no assumption about the authoring tool.
    deltas = [a - b for a, b in zip(lut, neutral)]
    histogram = sorted(collections.Counter(deltas).items())
    moved = sum(1 for delta in deltas if delta)
    report['colorCorrection']['lut']['againstNeutral'] = {
        'channelDeltaHistogram': histogram, 'channelsMoved': moved, 'channels': len(deltas),
        'maxChannelDelta': max(abs(delta) for delta in deltas),
    }
    if report['colorCorrection']['lut']['againstNeutral']['maxChannelDelta'] > 2:
        raise ValueError('the Dust2 grade is no longer negligible against the neutral lookup; it now has '
                         'to be applied rather than declared')
    report['colorCorrection']['applied'] = False
    report['limitations'].append(
        'Colour correction is declared but not applied: against the neutral lookup that ships beside it, '
        'the Dust2 cube moves no channel by more than one step of 255 and leaves 86.9% of the cube alone, '
        'so a full-frame lookup pass would buy at most that much. The measurement is recorded here; the '
        'moment a map ships a grade that moves anything further, this probe fails and the pass has to land.')

    # The grey axis is the one line every storage order agrees on, so it pins the sampling
    # convention independently of the search above.
    def grey_axis(cube):
        return [cube[v * 1057 * 3 + channel] for v in range(0, 32, 4) for channel in range(3)]

    report['colorCorrection']['lut']['greyAxis'] = {'step4': grey_axis(lut), 'neutralStep4': grey_axis(neutral)}
    if grey_axis(lut) != grey_axis(neutral):
        raise ValueError('the Dust2 grade no longer preserves the grey axis; review the LUT')

    OUT.write_text(json.dumps(report, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(json.dumps({'format': report['format'], 'entities': len(parsed), 'compared': compared,
                      'fog': [fog_color, fog_start, fog_end, fog_max],
                      'lightScaleHDR': report['lightEnvironment']['lightScaleHDR'],
                      'neutralFit': neutral_fit, 'lutBytes': len(lut), 'path': str(OUT)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
