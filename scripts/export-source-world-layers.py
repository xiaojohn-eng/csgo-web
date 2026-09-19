"""Add original material/displacement/directional-light sidecars to the immutable world GLB.

blender --background --factory-startup --python scripts/export-source-world-layers.py
"""
from pathlib import Path
import hashlib
import io
import json
import runpy
import struct
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/source/csgo-12426148/fidelity-world-20260913/world'
BASE = ROOT / '.reference-assets/source-exports/dust2-lightmapped'
BSP = ROOT / '.reference-assets/csgo-legacy/csgo/maps/de_dust2.bsp'
WORLD_SHA = '91b52e52b988e1b41b07b9cd365c159d615934fa49f07c3fa1e438d43269ffa8'
BSP_SHA = 'b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc'
sha = lambda b: hashlib.sha256(b).hexdigest()


def main():
    helpers = runpy.run_path(str(ROOT / 'scripts/inventory-source-items.py'))
    environment = helpers['initialize']()
    sources = helpers['Sources']()
    import numpy as np
    from SourceIO.library.utils.pylib.vtf import load_vtf_texture
    from SourceIO.library.utils.pylib.image import encode_png
    bsp, world = BSP.read_bytes(), (BASE / 'world.glb').read_bytes()
    assert sha(bsp) == BSP_SHA and sha(world) == WORLD_SHA
    def lump(i):
        offset, size, version, compressed = struct.unpack_from('<4I', bsp, 8 + i * 16)
        assert not compressed and offset + size <= len(bsp)
        return bsp[offset:offset + size]
    pak = zipfile.ZipFile(io.BytesIO(lump(40)))
    embedded = {p.lower(): p for p in pak.namelist()}
    def read(path):
        path = path.replace('\\', '/').lower()
        return pak.read(embedded[path]) if path in embedded else sources.read(path)
    OUT.mkdir(parents=True, exist_ok=True)
    def save(name, data):
        target = OUT / name
        if not target.exists() or target.read_bytes() != data: target.write_bytes(data)
        return dict(file=name, bytes=len(data), sha256=sha(data))
    lm = json.loads((BASE / 'lightmaps.json').read_text())
    face_lm = {f['id']: f for f in lm['faces']}
    atlases = []
    for receipt in lm['atlasFiles'][1:]:
        raw = (BASE / receipt['file']).read_bytes()
        assert sha(raw) == receipt['sha256'] and len(raw) == receipt['bytes']
        atlases.append(dict(layer=receipt['layer'], **save(receipt['file'], raw)))

    # Recover each original displacement grid through its original atlas UV,
    # then cross-check the recovered position against the raw BSP. No spatial
    # nearest-neighbour assignment and no rewritten base geometry.
    infos, verts, faces = lump(26), lump(33), lump(7)
    xyz = np.frombuffer(lump(3), '<f4').reshape(-1, 3)
    edges = np.frombuffer(lump(12), '<u2').reshape(-1, 2)
    surf = np.frombuffer(lump(13), '<i4')
    dispverts = np.frombuffer(verts, '<f4').reshape(-1, 5)
    native_alpha = json.loads((ROOT / 'tests/fixtures/source-world-alpha-native.json').read_text())
    assert native_alpha['sourceBspSha256'] == BSP_SHA and native_alpha['originalLumpSha256'] == sha(verts)
    quantize = runpy.run_path(str(ROOT / 'scripts/source-world-alpha.py'))['source_world_alpha_byte']
    quantized = {float(a): quantize(float(a)) for a in np.unique(dispverts[:, 4])}
    packed = bytes(quantized[float(a)] for a in dispverts[:, 4])
    assert sha(packed) == native_alpha['packedBytesSha256']
    alpha_values = np.frombuffer(packed, np.uint8).astype(np.float32) / 255
    grids = {}
    for at in range(0, len(infos), 176):
        start = np.array(struct.unpack_from('<3f', infos, at), np.float32)
        offset, _, power = struct.unpack_from('<3i', infos, at + 12)
        face = struct.unpack_from('<H', infos, at + 36)[0]
        first, count = struct.unpack_from('<ih', faces, face * 56 + 4)
        assert count == 4 and power in (2, 3, 4)
        se = surf[first:first + count]
        points = xyz[edges[np.abs(se), 1 - (se > 0).astype(np.uint8)]]
        corner = int(np.argmin(np.linalg.norm(points - start, axis=1)))
        assert np.linalg.norm(points[corner] - start) < .1
        side = (1 << power) + 1
        grid = np.empty((side * side, 3), np.float32)
        ls = (points[(corner + 1) & 3] - points[corner]) / (side - 1)
        rs = (points[(corner + 2) & 3] - points[(corner + 3) & 3]) / (side - 1)
        for row in range(side):
            left = ls * row + points[corner]
            right = rs * row + points[(corner + 3) & 3]
            step = (right - left) / (side - 1)
            for col in range(side):
                grid[row * side + col] = left + step * col
        source = dispverts[offset:offset + side * side]
        grid += source[:, :3] * source[:, 3:4]
        grids[face] = (side, grid[:, [0, 2, 1]] * np.array([1, 1, -1], np.float32), alpha_values[offset:offset + side * side])

    size = struct.unpack_from('<I', world, 12)[0]
    gltf = json.loads(world[20:20 + size]); binary = world[28 + size:]
    def accessor(index):
        a = gltf['accessors'][index]; v = gltf['bufferViews'][a['bufferView']]
        dtype = {5121: '<u1', 5123: '<u2', 5125: '<u4', 5126: '<f4'}[a['componentType']]
        width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        return np.ndarray((a['count'], width), dtype=dtype, buffer=binary,
            offset=v.get('byteOffset', 0) + a.get('byteOffset', 0),
            strides=(v.get('byteStride', np.dtype(dtype).itemsize * width), np.dtype(dtype).itemsize))
    attributes = bytearray(); primitives = []; worst = 0.; matched = 0; blended = 0
    for mi, mesh in enumerate(gltf['meshes']):
        for pi, primitive in enumerate(mesh['primitives']):
            a = primitive['attributes']; p, uv, ids = [accessor(a[k]) for k in ('POSITION', 'TEXCOORD_1', 'TEXCOORD_2')]
            values = np.zeros((len(p), 2), '<f4')
            for fid in np.unique(ids[:, 0]).astype(int):
                idx = np.flatnonzero(ids[:, 0] == fid); desc = face_lm.get(int(fid))
                if desc and desc['layers'] == 4: values[idx, 1] = 1
                if fid not in grids: continue
                side, grid, alpha = grids[fid]
                assert desc and desc['width'] > 1 and desc['height'] > 1
                luxels = uv[idx].astype(np.float64) * [lm['width'], lm['height']] - desc['atlas'] - .5
                coords = np.rint(luxels / [desc['width'] - 1, desc['height'] - 1] * (side - 1)).astype(int)
                assert np.all(coords >= 0) and np.all(coords < side)
                vi = coords[:, 1] * side + coords[:, 0]
                error = float(np.max(np.linalg.norm(grid[vi] - p[idx], axis=1)))
                assert error < .1, (fid, error)
                worst = max(worst, error); matched += len(idx)
                values[idx, 0] = alpha[vi]
            # Original engine clamps and rounds to a byte before interpolation.
            # The native fixture executes all 27,855 original distinct values.
            assert np.isfinite(values).all() and values.min() >= 0 and values.max() <= 1
            blended += int(np.count_nonzero(values[:, 0]))
            primitives.append(dict(mesh=mi, primitive=pi, material=primitive['material'], vertices=len(p),
                byteOffset=len(attributes), positionSha256=sha(p.tobytes()), uv1Sha256=sha(uv.tobytes()),
                uv2Sha256=sha(ids.tobytes())))
            attributes.extend(values.tobytes())

    textures = {}; materials = []
    for index, material in enumerate(gltf['materials']):
        name = material['extras']['full_path']
        raw = read('materials/' + name + '.vmt')
        shader, parameters = next(iter(helpers['parse_kv'](raw, name).items()))
        parameters = {k.lower(): v for k, v in parameters.items()}
        assert shader.lower() in ('worldvertextransition', 'lightmappedgeneric'), (name, shader)
        maps = {}
        for key in ('$basetexture2', '$bumpmap', '$bumpmap2', '$blendmodulatetexture'):
            if not parameters.get(key): continue
            path = parameters[key].replace('\\', '/').lower().removesuffix('.vtf')
            maps[key] = path
            if path in textures: continue
            vtf = read('materials/' + path + '.vtf')
            pixels, w, h, is_float = load_vtf_texture(vtf)
            assert not is_float and struct.unpack_from('<H', vtf, 24)[0] == 1
            flags = struct.unpack_from('<I', vtf, 20)[0]
            textures[path] = dict(**save(sha(vtf)[:16] + '.png', encode_png(pixels, w, h, 4)),
                source=path, sourceSha256=sha(vtf), rgbaSha256=sha(pixels), width=w, height=h,
                clampS=bool(flags & 4), clampT=bool(flags & 8))
        materials.append(dict(index=index, source=name, shader=shader.lower(), parameters=parameters,
            vmtSha256=sha(raw), maps=maps))
    manifest = dict(format='source-world-layers-v1', sourceBspSha256=BSP_SHA, sourceWorldSha256=WORLD_SHA,
        width=lm['width'], height=lm['height'], materials=materials, textures=list(textures.values()),
        atlases=atlases, primitives=primitives, attributes=save('attributes-native-alpha.f32', bytes(attributes)),
        audit=dict(displacements=len(grids), matchedDisplacementVertices=matched, nonzeroBlendVertices=blended,
            maxGridPositionErrorSourceUnits=worst, vertices=sum(p['vertices'] for p in primitives),
            environment=environment, attributeLayout='float32 vertexAlpha, directionalLightmapPresent',
            alphaSource='Original engine byte packing of BSP DISP_VERTS.alpha then UNORM8 normalization; grid ID from verified HDR UV and original positions',
            alphaPacking=dict(nativeUniqueValues=native_alpha['uniqueMapValuesExecuted'], packedBytesSha256=sha(packed), evidence='tests/fixtures/source-world-alpha-native.json'),
            textures='native original VTF RGBA8; base2 sRGB, normals/blendmod data; no green inversion',
            unchanged='Original world.glb and all original receipts; no geometry or UV edits'))
    # Version the changed sidecar so an already running earlier client keeps
    # valid immutable receipts during parent-thread integration/GPU inspection.
    receipt = save('manifest-native-alpha.json', (json.dumps(manifest, indent=2) + '\n').encode())
    (ROOT / 'game/source-world-layers-data.ts').write_text('// Generated by scripts/export-source-world-layers.py.\n'
        + 'export const SOURCE_WORLD_LAYERS_RECEIPT = ' + json.dumps(receipt, indent=2) + ' as const;\n')
    print('SOURCE_WORLD_LAYERS ' + json.dumps(dict(receipt=receipt, audit=manifest['audit'],
        materials=len(materials), textures=len(textures))))


if __name__ == '__main__': main()
