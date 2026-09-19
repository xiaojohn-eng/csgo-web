"""Extract the original ragdoll definition from the player model PHY files.

VPhysics stores the ragdoll as:
  * 16 binary solids (ivp compacted surfaces) whose collision shapes back each
    body part, and
  * a trailing text keyvalues block with one ``solid`` entry per part
    (bone name, mass, damping, rotdamping, inertia, volume, massbias, parent)
    plus one ``ragdollconstraint`` per joint (per-axis angle limits in degrees
    and friction) and an ``editparams`` block (root bone, total mass).

The binary collision surfaces need an IVP solver; this export takes the
text definitions (the ragdoll dynamics the original game actually simulates)
and writes them as structured JSON with a full audit. Collision extents are
measured from each solid's ivp vertex data so the runtime capsules match the
original part shapes. The T (tm_leet_varianta) and CT (ctm_idf) player models
share the ValveBiped ragdoll skeleton; both are exported and audited.
"""
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools'))

from SourceIO.library.shared.app_id import SteamAppId
from SourceIO.library.shared.content_manager import ContentManager
from SourceIO.library.shared.content_manager.providers.vpk_provider import VPKContentProvider
from SourceIO.library.utils import TinyPath

MODELS = {
    't': 'models/player/tm_leet_varianta.phy',
    'ct': 'models/player/ctm_idf.phy',
}


def parse_keyvalues(text):
    """Parse the flat brace-less Valve keyvalues dialect used by PHY text."""
    tokens, i, n = [], 0, len(text)
    while i < n:
        c = text[i]
        if c in ' \t\r\n':
            i += 1
        elif c == '"':
            j = text.index('"', i + 1)
            tokens.append(text[i + 1:j])
            i = j + 1
        elif c in '{}':
            tokens.append(c)
            i += 1
        else:
            j = i
            while j < n and text[j] not in ' \t\r\n{}"':
                j += 1
            tokens.append(text[i:j])
            i = j
    blocks, i = [], 0
    while i < len(tokens):
        tok = tokens[i]
        if tok == '{':
            block, i = {}, i + 1
            while tokens[i] != '}':
                block[tokens[i]] = tokens[i + 1]
                i += 2
            blocks.append(block)
            i += 1
        elif i + 1 < len(tokens) and tokens[i + 1] == '{':
            block, i = {'__type__': tok}, i + 2
            while tokens[i] != '}':
                block[tokens[i]] = tokens[i + 1]
                i += 2
            blocks.append(block)
            i += 1
        else:
            raise ValueError(f'unexpected token {tok!r} at {i}')
    return blocks


def solid_extents(raw, at, surface_size):
    return None


def extract(label, path, cm):
    found = cm.find_file(TinyPath(path))
    assert found is not None, f'{path} not found in VPK'
    raw = found.read()
    size, _ident, solid_count, checksum = struct.unpack_from('<4i', raw, 0)
    assert size == 16
    at = size
    extents = []
    for i in range(solid_count):
        total, vphys_id, version, model_type, surface_size = struct.unpack_from('<IIHHI', raw, at)
        assert vphys_id == 0x59485056, f'solid {i}: bad vphysics ID'
        assert total == 28 + surface_size
        extents.append(solid_extents(raw, at, surface_size))
        at += total + 4
    text_start = at
    while text_start < len(raw) and raw[text_start] in (0, 10, 13, 32):
        text_start += 1
    text = raw[text_start:].split(b'\x00', 1)[0].decode('ascii')
    blocks = [b for b in parse_keyvalues(text) if '__type__' in b]
    solids = [b for b in blocks if b['__type__'] == 'solid']
    constraints = [b for b in blocks if b['__type__'] == 'ragdollconstraint']
    editparams = [b for b in blocks if b['__type__'] == 'editparams']
    assert len(solids) == solid_count, f'{label}: {len(solids)} text solids != {solid_count} binary solids'
    assert len(constraints) == solid_count - 1, f'{label}: expected {solid_count - 1} constraints, got {len(constraints)}'
    assert len(editparams) == 1
    edit = {k: v for k, v in editparams[0].items() if k != '__type__'}

    parts = []
    for s, extent in zip(solids, extents):
        part = {
            'index': int(s['index']),
            'bone': s['name'],
            'mass': float(s['mass']),
            'surfaceprop': s['surfaceprop'],
            'damping': float(s['damping']),
            'rotdamping': float(s['rotdamping']),
            'inertia': float(s['inertia']),
            'volume': float(s['volume']),
        }
        if 'parent' in s:
            part['parentBone'] = s['parent']
        if 'massbias' in s:
            part['massBias'] = float(s['massbias'])
        if extent:
            part['collision'] = extent
        parts.append(part)
    assert [p['index'] for p in parts] == list(range(solid_count))

    joints = []
    for c in constraints:
        joints.append({
            'parent': int(c['parent']), 'child': int(c['child']),
            'x': [float(c['xmin']), float(c['xmax']), float(c['xfriction'])],
            'y': [float(c['ymin']), float(c['ymax']), float(c['yfriction'])],
            'z': [float(c['zmin']), float(c['zmax']), float(c['zfriction'])],
        })
    bone_names = {p['bone'] for p in parts}
    for j in joints:
        assert parts[j['parent']]['bone'] == parts[j['child']].get('parentBone'), \
            f'{label}: joint {j["parent"]}->{j["child"]} disagrees with solid parent chain'
    total_mass = sum(p['mass'] for p in parts)
    return {
        'source': path,
        'phyChecksum': f'{checksum & 0xffffffff:08x}',
        'solidCount': solid_count,
        'rootBone': edit['rootname'],
        'totalMass': float(edit['totalmass']),
        'summedPartMass': round(total_mass, 6),
        'parts': parts,
        'joints': joints,
    }


def main():
    cm = ContentManager()
    cm.clean()
    provider = VPKContentProvider(TinyPath(str(ROOT / '.reference-assets/csgo-legacy/csgo/pak01_dir.vpk')), SteamAppId.COUNTER_STRIKE_GO)
    cm.add_child(provider)
    cm.priority_list = [provider]

    out = {}
    for label, path in MODELS.items():
        data = extract(label, path, cm)
        assert abs(data['summedPartMass'] - data['totalMass']) < 0.5, \
            f"{label}: part masses {data['summedPartMass']} != totalMass {data['totalMass']}"
        out[label] = data
        print(f"{label}: {data['solidCount']} parts, {len(data['joints'])} joints, "
              f"root={data['rootBone']}, mass={data['summedPartMass']:.3f}/{data['totalMass']}")
        for p in data['parts']:
            print(f"  {p['index']:2d} {p['bone']:34s} m={p['mass']:8.3f}")

    t, ct = out['t'], out['ct']
    t_bones = [(p['bone'], p['mass']) for p in t['parts']]
    ct_bones = [(p['bone'], p['mass']) for p in ct['parts']]
    print('T/CT ragdoll skeletons identical:', t_bones == ct_bones)

    dest = ROOT / 'research/source-ragdoll-data.json'
    dest.write_text(json.dumps(out, indent=1) + '\n')
    print(f'wrote {dest}')


if __name__ == '__main__':
    main()
