"""Export all original Dust2 BSP overlays without changing base GLBs or receipts.

Run: blender --background --factory-startup --python scripts/export-source-overlays.py
Output: public/source/csgo-12426148/fidelity-world-20260913/overlays (exclusive sidecar).
"""
from pathlib import Path
import collections
import hashlib
import importlib.util
import io
import json
import runpy
import struct
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/source/csgo-12426148/fidelity-world-20260913/overlays'
BSP = ROOT / '.reference-assets/csgo-legacy/csgo/maps/de_dust2.bsp'
WORLD = ROOT / '.reference-assets/source-exports/dust2-lightmapped/world.glb'
BSP_SHA = 'b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc'
WORLD_SHA = '91b52e52b988e1b41b07b9cd365c159d615934fa49f07c3fa1e438d43269ffa8'
METRES = .0254
sha = lambda b: hashlib.sha256(b).hexdigest()


def main():
    helpers = runpy.run_path(str(ROOT / 'scripts/inventory-source-items.py'))
    environment = helpers['initialize']()
    sources = helpers['Sources']()
    from SourceIO.library.utils.pylib.vtf import load_vtf_texture
    from SourceIO.library.utils.pylib.image import encode_png
    import numpy as np
    spec = importlib.util.spec_from_file_location('overlay_geometry', ROOT / 'scripts/source-overlay-geometry.py')
    geometry = importlib.util.module_from_spec(spec); spec.loader.exec_module(geometry)

    bsp, world = BSP.read_bytes(), WORLD.read_bytes()
    assert sha(bsp) == BSP_SHA and sha(world) == WORLD_SHA
    def lump(i):
        offset, size, version, compressed = struct.unpack_from('<4I', bsp, 8 + i * 16)
        assert not compressed and offset + size <= len(bsp), (i, 'unreadable lump')
        return bsp[offset:offset + size]
    pak = zipfile.ZipFile(io.BytesIO(lump(40)))
    embedded = {name.lower(): name for name in pak.namelist()}
    def read(path):
        path = path.replace('\\', '/').lower()
        return pak.read(embedded[path]) if path in embedded else sources.read(path)

    overlay_bytes, texinfo, texdata, strings, names = [lump(i) for i in (45, 6, 2, 43, 44)]
    assert len(overlay_bytes) == 90 * 352
    fades = lump(60)
    assert len(fades) in (0, 90 * 8)
    overlays = []
    for i in range(90):
        at = i * 352
        ident, tindex, packed = struct.unpack_from('<ihH', overlay_bytes, at)
        dindex = struct.unpack_from('<i', texinfo, tindex * 72 + 68)[0]
        nindex = struct.unpack_from('<i', texdata, dindex * 32 + 12)[0]
        start = struct.unpack_from('<i', names, nindex * 4)[0]
        material = strings[start:strings.index(0, start)].decode().lower()
        points = np.array(struct.unpack_from('<12f', overlay_bytes, at + 280)).reshape(4, 3).tolist()
        origin = list(struct.unpack_from('<3f', overlay_bytes, at + 328))
        normal = list(struct.unpack_from('<3f', overlay_bytes, at + 340))
        overlays.append(dict(id=ident, material=material, renderOrder=packed >> 14,
            faces=list(struct.unpack_from('<64i', overlay_bytes, at + 8))[:packed & 0x3fff],
            u=list(struct.unpack_from('<2f', overlay_bytes, at + 264)),
            v=list(struct.unpack_from('<2f', overlay_bytes, at + 272)),
            points=points, origin=origin, normal=normal,
            fadeSquared=list(struct.unpack_from('<2f', fades, i * 8)) if fades else [-1, -1]))
    assert {o['id'] for o in overlays} == set(range(90))

    size = struct.unpack_from('<I', world, 12)[0]
    gltf = json.loads(world[20:20 + size]); binary = world[28 + size:]
    def accessor(index):
        a = gltf['accessors'][index]; v = gltf['bufferViews'][a['bufferView']]
        dtype = {5121: '<u1', 5123: '<u2', 5125: '<u4', 5126: '<f4'}[a['componentType']]
        width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        stride = v.get('byteStride', np.dtype(dtype).itemsize * width)
        return np.ndarray((a['count'], width), dtype=dtype, buffer=binary,
            offset=v.get('byteOffset', 0) + a.get('byteOffset', 0),
            strides=(stride, np.dtype(dtype).itemsize))
    wanted = set(f for o in overlays for f in o['faces'])
    receiver = collections.defaultdict(list)
    for mesh in gltf['meshes']:
        for primitive in mesh['primitives']:
            attrs = primitive['attributes']
            pos, norm, lm, ids = [accessor(attrs[k]) for k in ('POSITION', 'NORMAL', 'TEXCOORD_1', 'TEXCOORD_2')]
            indices = accessor(primitive['indices']).reshape(-1, 3)
            face_ids = ids[indices[:, 0], 0].astype(np.int32)
            selected = indices[np.isin(face_ids, list(wanted))]
            for tri in selected:
                fid = int(ids[tri[0], 0])
                assert all(ids[v, 0] == fid for v in tri)
                # glTF already uses Y-up; the sole parent applies metres/unit.
                receiver[fid].append([[*map(float, pos[v]), *map(float, norm[v]), *map(float, lm[v])] for v in tri])

    OUT.mkdir(parents=True, exist_ok=True)
    def save(name, data):
        (OUT / name).write_bytes(data)
        return dict(file=name, bytes=len(data), sha256=sha(data))
    textures, materials = {}, []
    for name in sorted({o['material'] for o in overlays}):
        raw = read('materials/' + name + '.vmt')
        parsed = helpers['parse_kv'](raw, name)
        assert len(parsed) == 1
        shader, parameters = next(iter(parsed.items()))
        shader = shader.lower(); parameters = {k.lower(): v for k, v in parameters.items()}
        assert shader in ('lightmappedgeneric', 'decalmodulate'), (name, shader)
        path = parameters['$basetexture'].replace('\\', '/').lower().removesuffix('.vtf')
        if path not in textures:
            vtf = read('materials/' + path + '.vtf')
            pixels, w, h, is_float = load_vtf_texture(vtf)
            assert not is_float and struct.unpack_from('<H', vtf, 24)[0] == 1
            assert (w, h) == struct.unpack_from('<HH', vtf, 16)
            flags = struct.unpack_from('<I', vtf, 20)[0]
            png = encode_png(pixels, w, h, 4)
            textures[path] = dict(**save('texture-' + sha(vtf)[:16] + '.png', png),
                source=path, sourceSha256=sha(vtf), rgbaSha256=sha(pixels), width=w, height=h,
                clampS=bool(flags & 4), clampT=bool(flags & 8))
        # The pinned SourceIO KeyValues parser normalizes material keys; retain
        # the original raw VMT hash and its parsed opacity without art edits.
        materials.append(dict(source=name, shader=shader, parameters=parameters,
            vmtSha256=sha(raw), texture=path, opacity=float(parameters.get('$alpha', 1)),
            translucent=parameters.get('$translucent', '0') == '1',
            alphaTest=float(parameters.get('$alphatestreference', .5)) if parameters.get('$alphatest') == '1' else 0))

    rows = []
    for o in overlays:
        uaxis, vaxis = geometry.basis(o['points'], o['normal'])
        quad = [p[:2] for p in o['points']]
        positions, normals, uv, lightmap, face_ids = [], [], [], [], []
        faces_touched = set()
        for fid in o['faces']:
            if fid not in receiver:
                raise ValueError(f'Overlay {o["id"]} receiver face {fid} is absent from verified base geometry')
            for triangle in receiver[fid]:
                projected = []
                for vertex in triangle:
                    x, y, z = vertex[:3]
                    relative = geometry.sub([x, -z, y], o['origin'])
                    projected.append([geometry.dot(relative, uaxis), geometry.dot(relative, vaxis), *vertex])
                polygon = geometry.clip_triangle(projected, quad)
                for k in range(1, len(polygon) - 1):
                    triangle = [polygon[0], polygon[k], polygon[k + 1]]
                    e1 = np.subtract(triangle[1][2:5], triangle[0][2:5])
                    e2 = np.subtract(triangle[2][2:5], triangle[0][2:5])
                    if float(np.linalg.norm(np.cross(e1, e2))) < 1e-7:
                        continue
                    for vertex in triangle:
                        s, t = geometry.quad_coordinates(vertex[:2], quad)
                        positions.extend(x * METRES for x in vertex[2:5])
                        normals.extend(vertex[5:8]); lightmap.extend(vertex[8:10])
                        uv.extend([o['u'][0] + s * (o['u'][1] - o['u'][0]),
                                   o['v'][0] + t * (o['v'][1] - o['v'][0])])
                        face_ids.append(fid)
                    faces_touched.add(fid)
        if not positions:
            raise ValueError(f'Original overlay {o["id"]} clips to no receiver')
        rows.append(dict(**o, positions=positions, normals=normals, uv=uv,
            lightmapUV=lightmap, faceIds=face_ids, clippedFaces=sorted(faces_touched),
            triangles=len(face_ids) // 3))
    encoded = json.dumps(dict(format='source-bsp-overlays-geometry-v1', sourceBspSha256=BSP_SHA,
        sourceWorldSha256=WORLD_SHA, metresPerSourceUnit=METRES, overlays=rows), separators=(',', ':')).encode()
    manifest = dict(format='source-bsp-overlays-v1', sourceBspSha256=BSP_SHA, sourceWorldSha256=WORLD_SHA,
        overlays=90, triangles=sum(o['triangles'] for o in rows), geometry=save('geometry.json', encoded),
        materials=materials, textures=list(textures.values()),
        provenance=dict(environment=environment, overlayLumpSha256=sha(overlay_bytes),
            basisEncoding='ValveSoftware/source-sdk-2013 src/utils/vbsp/overlay.cpp lines 224-234',
            receiver='unchanged verified world.glb triangles + original Source face IDs and HDR UVs',
            projection='clip each receiver triangle to authored overlay quad; interpolate receiver HDR UV; invert bilinear quad for texture UV',
            vtf='original native decode to RGBA8 PNG; no colour/alpha edits'))
    data = (json.dumps(manifest, indent=2) + '\n').encode()
    receipt = save('manifest.json', data)
    table = ROOT / 'game/source-overlays-data.ts'
    table.write_text('// Generated by scripts/export-source-overlays.py; original base assets are unchanged.\n'
        + 'export const SOURCE_OVERLAYS_RECEIPT = ' + json.dumps(receipt, indent=2) + ' as const;\n')
    print('SOURCE_OVERLAYS ' + json.dumps(dict(overlays=90, triangles=manifest['triangles'],
        materials=len(materials), textures=len(textures), manifest=receipt,
        target=str(OUT), landmarkTriangles={o['id']: o['triangles'] for o in rows if o['id'] in (29,30,31,40)})))

if __name__ == '__main__':
    main()
