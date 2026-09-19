"""Extract the original Dust2 sky area/PVS without name or distance heuristics.

Reads only the frozen BSP and prior metadata; emits a private CPU descriptor.
Displacements have no normal leaffaces: classify their complete original vertex
envelope against the original BSP planes, with the same explicit 0.01u margin as
the visibility exporter. No render mesh, collision proxy or guessed island box.
"""
from pathlib import Path
import base64
import collections
import hashlib
import json
import math
import struct

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / '.reference-assets/source-exports/dust2'
OUT = BASE / 'sky'
BSP = ROOT / '.reference-assets/csgo-legacy/csgo/maps/de_dust2.bsp'
SHA = 'b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc'
source = BSP.read_bytes()
sha = lambda data: hashlib.sha256(data).hexdigest()
assert sha(source) == SHA and source[:4] == b'VBSP'
receipts = {}


def lump(i):
    at, size, version, compressed = struct.unpack_from('<4i', source, 8 + i * 16)
    assert 0 <= at <= at + size <= len(source) and not compressed
    data = source[at:at + size]
    receipts[i] = dict(offset=at, bytes=size, version=version, sha256=sha(data))
    return data


def rows(i, fmt):
    return list(struct.iter_unpack(fmt, lump(i)))


def save(name, data):
    (OUT / name).write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')


planes = rows(1, '<4fi')
nodes = rows(5, '<3i6h2H2h')
model = rows(14, '<9f3i')[0]
leaf_data = lump(10)
assert receipts[10]['version'] == 1 and len(leaf_data) % 32 == 0
leaves = [struct.unpack_from('<ihH6h4Hh', leaf_data, i) for i in range(0, len(leaf_data), 32)]
leaf_faces = [x[0] for x in rows(16, '<H')]
faces = rows(7, '<HBBihhhh4Bif4iiHHI')
texinfo = rows(6, '<16f2i')
areas = rows(20, '<2i')
portals = rows(21, '<4Hi')
world_ids = range(model[10], model[10] + model[11])


def point_leaf(point):
    node = model[9]
    while node >= 0:
        n = nodes[node]
        plane = planes[n[0]]
        d = sum(plane[i] * point[i] for i in range(3)) - plane[3]
        node = n[1 if d >= 0 else 2]
    return -1 - node


entity_bytes = lump(0)
metadata_entities = (BASE / 'source-metadata/entities.json').read_bytes()
entities = json.loads(metadata_entities)
cameras = [e for e in entities if e['classname'] == 'sky_camera']
assert len(cameras) == 1
camera = cameras[0]
assert camera['hammerid'] == '12482060' and camera['origin'].encode() in entity_bytes
f32 = lambda x: struct.unpack('<f', struct.pack('<f', float(x)))[0]
origin = [f32(x) for x in camera['origin'].split()]
sky_leaf = point_leaf(origin)
sky_cluster = leaves[sky_leaf][1]
sky_area = leaves[sky_leaf][2] & 511
vis = lump(4)
cluster_count = struct.unpack_from('<i', vis)[0]
offset = struct.unpack_from('<i', vis, 4 + sky_cluster * 8)[0]
row_bytes = (cluster_count + 7) // 8
row = bytearray()
assert offset >= 4 + cluster_count * 8
while len(row) < row_bytes:
    value = vis[offset]
    offset += 1
    if value:
        row.append(value)
    else:
        run = vis[offset]
        offset += 1
        assert run > 0 and len(row) + run <= row_bytes
        row.extend(bytes(run))
clusters = {i for i in range(cluster_count) if row[i >> 3] & (1 << (i & 7))}
sky_leaves = {i for i, leaf in enumerate(leaves) if leaf[2] & 511 == sky_area and leaf[1] in clusters}
direct_faces = {f for i in sky_leaves for f in leaf_faces[leaves[i][9]:leaves[i][9] + leaves[i][10]] if f in world_ids}

# Independently re-read all original displacement vertices, not rendered GLB
# bounds or the old SourceIO isclose(rtol) start-corner error.
vertices = rows(3, '<3f')
edges = rows(12, '<2H')
surfedges = [x[0] for x in rows(13, '<i')]
disp_info = lump(26)
disp_vertices = rows(33, '<5f')


def intersecting_leaves(mins, maxs):
    center = [(a + b) / 2 for a, b in zip(mins, maxs)]
    extent = [(b - a) / 2 for a, b in zip(mins, maxs)]
    stack, result = [model[9]], []
    while stack:
        node = stack.pop()
        if node < 0:
            result.append(-1 - node)
            continue
        n = nodes[node]
        p = planes[n[0]]
        distance = sum(p[i] * center[i] for i in range(3)) - p[3]
        radius = sum(abs(p[i]) * extent[i] for i in range(3))
        if distance + radius >= 0:
            stack.append(n[1])
        if distance - radius <= 0:
            stack.append(n[2])
    return result


sky_displacements = []
mixed_displacements = []
for face_id in world_ids:
    face = faces[face_id]
    disp = face[6]
    if disp < 0:
        continue
    assert face[4] == 4
    start = struct.unpack_from('<3f', disp_info, disp * 176)
    first, _, power = struct.unpack_from('<3i', disp_info, disp * 176 + 12)
    corners = [vertices[edges[abs(edge)][0 if edge >= 0 else 1]] for edge in surfedges[face[3]:face[3] + 4]]
    corner = min(range(4), key=lambda i: sum((corners[i][j] - start[j]) ** 2 for j in range(3)))
    assert sum((corners[corner][j] - start[j]) ** 2 for j in range(3)) < .01
    corners = corners[corner:] + corners[:corner]
    side = (1 << power) + 1
    mins, maxs = [math.inf] * 3, [-math.inf] * 3
    for y in range(side):
        for x in range(side):
            u, v = x / (side - 1), y / (side - 1)
            dv = disp_vertices[first + y * side + x]
            for axis in range(3):
                base = (1-u)*((1-v)*corners[0][axis]+v*corners[1][axis])+u*((1-v)*corners[3][axis]+v*corners[2][axis])
                value = base + dv[axis] * dv[3]
                mins[axis], maxs[axis] = min(mins[axis], value), max(maxs[axis], value)
    memberships = intersecting_leaves([v - .01 for v in mins], [v + .01 for v in maxs])
    if not sky_leaves.intersection(memberships):
        continue
    record = dict(face=face_id, displacement=disp, leafIds=memberships, sourceBounds=[mins, maxs])
    sky_displacements.append(record)
    if any(leaves[i][2] & 511 != sky_area for i in memberships):
        mixed_displacements.append(record)

# Read the original sprp dictionary/leaf table, including models whose origin is
# outside their occupied leaves. No substring classification of model names.
game = lump(35)
sprp = None
for i in range(struct.unpack_from('<i', game)[0]):
    key, flags, version, at, size = struct.unpack_from('<4sHHii', game, 4 + i * 16)
    if key[::-1] == b'sprp':
        assert flags == 0 and version == 11
        sprp = source[at:at + size]
assert sprp is not None
at = 0


def integer():
    global at
    result = struct.unpack_from('<i', sprp, at)[0]
    at += 4
    assert result >= 0
    return result


names = []
for _ in range(integer()):
    names.append(sprp[at:at + 128].split(b'\0')[0].decode())
    at += 128
count = integer()
links = struct.unpack_from('<' + str(count) + 'H', sprp, at)
at += count * 2
prop_count = integer()
assert len(sprp) - at == prop_count * 80
sky_props, mixed_props = [], []
for i in range(prop_count):
    pos = at + i * 80
    name, first, count = struct.unpack_from('<3H', sprp, pos + 24)
    leaf_ids = list(links[first:first + count])
    if not sky_leaves.intersection(leaf_ids):
        continue
    record = dict(id=i, model=names[name], sourceOrigin=list(struct.unpack_from('<3f', sprp, pos)), leafIds=leaf_ids)
    sky_props.append(record)
    if any(leaves[j][2] & 511 != sky_area for j in leaf_ids):
        mixed_props.append(record)

tool_mask = 0x2 | 0x4 | 0x80 | 0x100 | 0x200
candidate_faces = direct_faces | {d['face'] for d in sky_displacements}
render_faces = sorted(f for f in candidate_faces if not texinfo[faces[f][5]][16] & tool_mask)
sky_portals = sorted(f for f in direct_faces if texinfo[faces[f][5]][16] & (0x2 | 0x4))
assert (sky_leaf, sky_cluster, sky_area) == (2497, 0, 1)
assert clusters == {0} and render_faces == [9711, 9712, 9713, 9714]
assert len(sky_props) == 75 and not mixed_props and not mixed_displacements
area_count, area_first = areas[sky_area]
assert area_count == 0
visibility = json.loads((BASE / 'visibility/visibility.json').read_text())
assert visibility['sourceBspSha256'] == SHA
prop_ids = [p['id'] for p in sky_props]
descriptor = dict(format='source-sky-v1', sourceBspSha256=SHA, metersPerSourceUnit=.0254,
    skyName=next(e['skyname'] for e in entities if e['classname'] == 'worldspawn'),
    camera=dict(hammerId=camera['hammerid'], sourceOrigin=origin, scale=int(camera['scale']), leaf=sky_leaf,
        cluster=sky_cluster, area=sky_area,
        fog=dict(enabled=camera.get('fogenable') == '1', blend=camera.get('fogblend', '0') == '1',
            sourceDirection=[float(x) for x in camera['fogdir'].split()],
            color=[int(x) for x in camera['fogcolor'].split()], color2=[int(x) for x in camera['fogcolor2'].split()],
            sourceStart=float(camera['fogstart']), sourceEnd=float(camera['fogend']),
            maxDensity=float(camera['fogmaxdensity']), radial=camera.get('fogradial', '0') == '1',
            hdrColorScale=float(camera['hdrcolorscale']))),
    leafFlags=[leaf[2] >> 9 for leaf in leaves], skyLeafIds=sorted(sky_leaves), pvsClusterIds=sorted(clusters),
    worldFaceIds=render_faces, staticPropIds=prop_ids, skyPortalFaceIds=sky_portals,
    counts=dict(worldFaces=model[11], staticProps=prop_count, leaves=len(leaves)),
    clipSourceUnits=dict(near=2, far=1.732050807569 * 32768),
    contract=dict(pvsOrigin='sky_camera-origin', areaMask='camera-area-only', orientation='inherit-main-view',
        clear='sky-color-depth-then-main-depth', coordinateRule='browser=(Source.x,Source.z,-Source.y)*metersPerSourceUnit'))
materials = json.loads((BASE / 'props-manifest.json').read_text())['materials']
skydome_materials = [m for m in materials if m['source'].endswith('/sky_dust2') or m['source'].endswith('/nuke_clouds_002')]
assert len(skydome_materials) == 2
def staged_scrolls(m):
    """The material's own `texturescroll` proxy blocks, as the material files spell them.
    The client reads camel-case keys and the engine's KeyValues lookups ignore case, so the
    lower-case spelling here is the same key the installed proxy reads
    (scripts/probe-source-texture-scroll-apply.py)."""
    blocks = (m['parameters'].get('proxies') or {}).get('texturescroll') or []
    staged = []
    for block in blocks:
        variable = block['texturescrollvar']
        if variable not in ('$basetexturetransform', '$texture2transform'):
            raise AssertionError('Unexpected texturescroll variable: ' + variable)
        staged.append(dict(variable=variable, rate=float(block['texturescrollrate']),
            angle=float(block['texturescrollangle']), scale=float(block['texturescale'])))
    return staged


# Which of the installed shader's shipped branches a material that declares only
# `$translucent 1` lands on, and what that branch computes, are measured - not chosen here:
# scripts/probe-source-cloud-layer-branch.py reads the static combo the material's own flags
# select and its program. The descriptor carries that branch so the runtime applies the
# original's product, and a regenerated pair that disagrees fails here instead of rendering.
branch = json.loads((ROOT / 'research/source-cloud-layer-branch.json').read_text())
assert branch['format'] == 'source-cloud-layer-branch-v1'
combo = branch['cloudCombo']
assert combo['static'] == '0x1' and combo['dynamic'] == 1, combo
assert combo['program'][-4:] == ['mul r0.xyzw r0.xyzw, r1.xyzw', 'mul r0.xyzw r0.xyzw, c1.xyzw',
    'mul r0.xyz r0.xyzw, c30.xxxx', 'mov oc0.xyzw r0.xyzw'], combo['program']
# The second texture the same pass stored losslessly out of the original install.
second_texture = json.loads((BASE / 'sky/cloud-texture2.json').read_text())
assert second_texture['status'] == 'cloud_texture2_extracted'
assert second_texture['texture2'] == 'models/props/de_nuke/hr_nuke/nuke_skydome_001/nuke_clouds_001'
png_name = Path(second_texture['png']['file']).name


def second_texture_contract(m):
    """The two-texture material's own second texture and branch; `None` for a one-texture one."""
    if m['shader'] == 'unlitgeneric':
        if m['parameters'].get('$texture2'):
            raise AssertionError('A one-texture sky material now names a second texture')
        return None
    if second_texture['material'] != m['source'] or m['parameters'].get('$texture2') != second_texture['texture2']:
        raise AssertionError('The stored second texture is not this material\'s own')
    if m['parameters'].get('$translucent') != '1':
        raise AssertionError('The cloud material no longer declares the branch this pass measured')
    return dict(texture=second_texture['texture2'], file=png_name, bytes=second_texture['png']['bytes'],
        sha256=second_texture['png']['sha256'], width=second_texture['width'], height=second_texture['height'],
        clampS=second_texture['vtfClampS'], clampT=second_texture['vtfClampT'],
        sourceSha256=second_texture['source']['sha256'])


descriptor['unlitMaterials'] = [dict(source=m['source'], shader=m['shader'], noFog=m['parameters'].get('$nofog') == '1',
    alpha=float(m['parameters'].get('$alpha', '1')), rawVmtSha256=m['rawVmtSha256'], scrolls=staged_scrolls(m),
    second=second_texture_contract(m),
    translucent=m['parameters'].get('$translucent') == '1',
    program=(None if m['shader'] == 'unlitgeneric' else dict(static=combo['static'], dynamic=combo['dynamic'],
        rgb='texture0.rgb * texture1.rgb * c1.rgb', alpha='texture0.a * texture1.a * c1.a',
        unapplied=['cLightScale (c30): the program scales rgb by it and its runtime value is not read'])),
    limitations=([] if m['shader'] == 'unlitgeneric' else
        ['The cloud layer is drawn with its own program\'s product - texture0 * texture1 * c1, alpha '
         'texture0.a * texture1.a * c1.a where c1 is the material\'s colour and $alpha - and its own '
         'TextureScroll transform. The program\'s trailing cLightScale factor is not applied '
         '(scripts/probe-source-cloud-layer-branch.py).'])) for m in skydome_materials]
OUT.mkdir(parents=True, exist_ok=True)
save('sky.json', descriptor)
save('membership.json', dict(displacements=sky_displacements, staticProps=sky_props,
    directLeafFaceIds=sorted(direct_faces), mixedProps=mixed_props, mixedDisplacements=mixed_displacements,
    cameraEntity=camera, cameraAreaPortals=portals[area_first:area_first + area_count]))
save('skydome-materials.json', skydome_materials)
save('receipt.json', dict(sourceBsp=str(BSP.relative_to(ROOT)), sourceBspSha256=SHA,
    scriptSha256=sha(Path(__file__).read_bytes()), skySha256=sha((OUT / 'sky.json').read_bytes()), lumps=receipts,
    entitiesJsonSha256=sha(metadata_entities), sprpSha256=sha(sprp),
    originalPvsRowBase64=base64.b64encode(row).decode(),
    counts=dict(skyLeaves=len(sky_leaves), skyClusters=len(clusters), worldFaces=len(render_faces),
        skyPortalFaces=len(sky_portals), staticProps=len(sky_props)),
    originalAlwaysVisiblePropIds=visibility['alwaysVisiblePropIds'],
    alwaysVisiblePropsExactlySky=visibility['alwaysVisiblePropIds'] == prop_ids,
    extraAlwaysVisibleProps=sorted(set(visibility['alwaysVisiblePropIds']) - set(prop_ids)),
    limits=['Displacement leaf assignment uses complete original vertex AABB traversal with 0.01 Source-unit tolerance; all four lie exclusively in area 1.',
        'Fixed Valve SDK render contract; current CSGO client render instructions are not independently emulated.',
        'Two-texture cloud shader/scroll/fog exclusions are not restored by a camera descriptor.']))
print(json.dumps(dict(path=str(OUT / 'sky.json'), camera=descriptor['camera'],
    counts=json.loads((OUT / 'receipt.json').read_text())['counts'],
    alwaysVisiblePropsExactlySky=visibility['alwaysVisiblePropIds'] == prop_ids), ensure_ascii=False, indent=2))
