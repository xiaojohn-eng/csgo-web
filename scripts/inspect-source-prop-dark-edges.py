"""Read original stone/roof VVD, VHV and VTF against immutable exported props.

Run with factory-startup Blender. Writes one numerical research receipt only;
does not edit textures/geometry/materials or claim a browser/pixel match.
"""
from pathlib import Path
import ast
import hashlib
import io
import json
import runpy
import struct
import zipfile
import zlib

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / '.reference-assets/source-exports/dust2'
VHV = BASE.parent / 'dust2-vhv'
SHA = lambda b: hashlib.sha256(b).hexdigest()
NAMES = ('hr_dust_stone_ground_01_color', 'hr_dust_stone_ground_02_color', 'dust_kasbah_rooftrim_01')


def main():
    h = runpy.run_path(str(ROOT / 'scripts/inventory-source-items.py'))
    environment = h['initialize']()
    sources = h['Sources']()
    import numpy as np
    from SourceIO.library.utils.pylib.vtf import load_vtf_texture
    # Reuse only the independently implemented PNG decoder function. The old
    # redline script has top-level writes, which must never execute here.
    tree = ast.parse((ROOT / 'scripts/validate-redline-inputs.py').read_text())
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'rgba8_png')
    scope = {'struct': struct, 'zlib': zlib}
    exec(compile(ast.Module(body=[fn], type_ignores=[]), '<PNG decoder>', 'exec'), scope)
    decode_png = scope['rgba8_png']
    g = runpy.run_path(str(ROOT / 'scripts/map-source-prop-vhv.py'))
    doc, binary, original = g['glb'](BASE / 'props.glb')
    assert SHA(original) == '55937fce28a53461520fa2c531384f65f0f8b69df1a8205245466b6064ab5232'
    descriptor = json.loads((VHV / 'remap/runtime.json').read_text())
    inventory = json.loads((VHV / 'inventory.json').read_text())
    frozen = json.loads((BASE / 'props-manifest.json').read_text())
    props = {x['index']: x for x in json.loads((BASE / 'prop-instances.json').read_text())}
    remap = (VHV / 'remap/original-prop-to-vhv.u32').read_bytes()
    lighting = (VHV / 'instance-lighting.bin').read_bytes()
    source_map = (VHV / 'source-vertex-map.u32').read_bytes()
    assert SHA(remap) == descriptor['files']['remap']['sha256']
    assert SHA(lighting) == descriptor['files']['lighting']['sha256']
    assert SHA(source_map) == inventory['binary']['mapping']['sha256']
    bsp = (ROOT / '.reference-assets/csgo-legacy/csgo/maps/de_dust2.bsp').read_bytes()
    assert SHA(bsp) == descriptor['sourceBspSha256']
    start, size = struct.unpack_from('<2I', bsp, 8 + 40 * 16)
    pak = zipfile.ZipFile(io.BytesIO(bsp[start:start + size]))
    members = {p.replace('\\', '/').lower(): p for p in pak.namelist()}
    def read(path):
        path = path.replace('\\', '/').lower()
        return pak.read(members[path]) if path in members else sources.read(path)
    materials = [m for m in frozen['materials'] if m['source'].rsplit('/', 1)[-1] in NAMES]
    assert len(materials) == 3
    selected = {m['source']: m for m in materials}
    records = [r for r in descriptor['records'] if r['materialSource'] in selected]
    pixels = {}; textures = []
    def stats(p):
        rgb = p[:, :, :3].astype(np.float64)
        return dict(minRGBA=p.min(axis=(0, 1)).tolist(), maxRGBA=p.max(axis=(0, 1)).tolist(),
            alphaBelowHalfFraction=float(np.mean(p[:, :, 3] < 128)),
            rgbAllBelow8Fraction=float(np.mean(np.max(rgb, axis=2) < 8)),
            meanRGB=rgb.mean(axis=(0, 1)).tolist())
    for material in materials:
        vmt = read('materials/' + material['source'] + '.vmt')
        assert SHA(vmt) == material['rawVmtSha256']
        for key in ('$basetexture', '$bumpmap'):
            path = 'materials/' + material['parameters'][key].replace('\\', '/').lower().removesuffix('.vtf') + '.vtf'
            t = next(t for t in frozen['textures'] if t['source'].replace('\\', '/').lower() == path)
            raw = read(path); assert SHA(raw) == t['sourceSha256']
            decoded, w, height, floating = load_vtf_texture(raw)
            assert not floating
            p = np.frombuffer(decoded, np.uint8).reshape(height, w, 4)
            expected = p.copy()
            if t['normalGreenInverted']: expected[:, :, 1] = 255 - expected[:, :, 1]
            pw, ph, png_pixels, _ = decode_png((BASE / t['file']).read_bytes())
            assert (pw, ph) == (w, height) and bytes(expected) == png_pixels, path
            gm = next(m for m in doc['materials'] if m['name'] == material['name'])
            ti = gm['normalTexture'] if key == '$bumpmap' else gm['pbrMetallicRoughness']['baseColorTexture']
            texture = doc['textures'][ti['index']]
            view = doc['bufferViews'][doc['images'][texture['source']]['bufferView']]
            embedded = bytes(binary[view.get('byteOffset', 0):view.get('byteOffset', 0) + view['byteLength']])
            ew, eh, exported_pixels, _ = decode_png(embedded)
            assert (ew, eh) == (pw, ph) and exported_pixels == png_pixels, path
            levels = []; previous = p
            for level in range(1, raw[56]):
                d, mw, mh, floating = load_vtf_texture(raw, 0, 0, level)
                assert not floating
                mip = np.frombuffer(d, np.uint8).reshape(mh, mw, 4)
                # Diagnostic box-filter delta; WebGL's implementation/linear
                # SRGB filtering is not assumed to be this reference average.
                box = previous.astype(np.float64).reshape(mh, 2, mw, 2, 4).mean(axis=(1, 3))
                levels.append(dict(level=level, width=mw, height=mh, rgbaSha256=SHA(d),
                    **stats(mip), referenceBoxMeanAbsoluteDelta=float(np.mean(np.abs(mip.astype(float) - box)))))
                previous = mip
            textures.append(dict(path=path, key=key, sourceSha256=SHA(raw), format=struct.unpack_from('<I', raw, 52)[0],
                flags=hex(struct.unpack_from('<I', raw, 20)[0]), width=w, height=height,
                authoredMipCount=raw[56], originalPNGExact=True, embeddedGLBPixelsExact=True,
                gltfSampler=doc['samplers'][texture['sampler']], normalGreenInverted=t['normalGreenInverted'],
                mip0=stats(p), lowerMips=levels))
            if key == '$basetexture': pixels[material['source']] = p
    verified = []; positions_by_model = {}; material_uvs = {key: [] for key in selected}
    for record in records:
        model = inventory['models'][record['sourceModelIndex']]
        name = record['model']; raw = read(name[:-4] + '.vvd')
        assert SHA(raw) == inventory['dependencies'][name[:-4] + '.vvd']['sha256']
        assert struct.unpack_from('<I', raw, 48)[0] == 0
        offset = struct.unpack_from('<I', raw, 56)[0]
        file_ids = []
        for group in model['groups']:
            b = source_map[group['mappingOffset']:group['mappingOffset'] + group['mappingBytes']]
            assert SHA(b) == group['mappingSha256']
            file_ids.extend(v[1] for v in struct.iter_unpack('<2I', b))
        hardware = np.frombuffer(remap, '<u4', count=record['vertexCount'], offset=record['mapOffset'])
        primitive = doc['meshes'][record['mesh']]['primitives'][record['primitive']]
        current = {key: np.array(g['accessor'](doc, binary, value)) for key, value in primitive['attributes'].items()}
        indices = np.array(g['accessor'](doc, binary, primitive['indices'])).reshape(-1)
        used = np.unique(indices)
        assert np.all(hardware[used] < len(file_ids))
        p = []; uv = []
        for v in used:
            x, y, z, nx, ny, nz, u, vv = struct.unpack_from('<8f', raw, offset + 48 * file_ids[int(hardware[v])] + 16)
            p.append((x, z, -y)); uv.append((u, vv))
        assert np.array_equal(current['POSITION'][used], p), name
        assert np.array_equal(current['TEXCOORD_0'][used], uv), name
        uv0 = current['TEXCOORD_0']; material_uvs[record['materialSource']].append(uv0[indices].reshape(-1, 3, 2).mean(axis=1))
        positions_by_model.setdefault(name, []).append(current['POSITION'][used])
        verified.append(dict(model=name, mesh=record['mesh'], primitive=record['primitive'], material=record['materialSource'],
            vertices=len(used), triangles=len(indices) // 3, rawVvdPositionExact=True, rawVvdUvExact=True,
            originalVvdSha256=SHA(raw), uvMin=uv0[used].min(axis=0).tolist(), uvMax=uv0[used].max(axis=0).tolist()))
    samplings = []
    for material, all_uv in material_uvs.items():
        uv = np.concatenate(all_uv); p = pixels[material]; height, width, _ = p.shape
        def sample(y): return p[(np.floor(y * height).astype(int) % height), (np.floor(uv[:, 0] * width).astype(int) % width)]
        native = sample(uv[:, 1]); flipped = sample(1 - uv[:, 1])
        samplings.append(dict(material=material, scope='one mip0 nearest sample per exact original triangle centroid, not an area/pixel score',
            samples=len(uv), actualUVBlackFraction=float(np.mean(np.max(native[:, :3], axis=1) < 8)),
            flippedUVBlackFraction=float(np.mean(np.max(flipped[:, :3], axis=1) < 8)),
            actualUVAlphaBelowHalfFraction=float(np.mean(native[:, 3] < 128))))
    instances = []
    parse = runpy.run_path(str(ROOT / 'scripts/inventory-source-vhv.py'))['parse_vhv']
    for instance in inventory['instances']:
        if instance['model'] not in positions_by_model: continue
        raw = read(instance['vhv']); assert SHA(raw) == instance['vhvSha256']
        header = parse(raw); all_values = []
        for group, vgroup in zip(instance['groups'], header['meshes']):
            b = raw[vgroup['fileOffset']:vgroup['fileOffset'] + vgroup['bytes']]
            assert b == lighting[group['lightingOffset']:group['lightingOffset'] + group['lightingBytes']]
            all_values.append(np.frombuffer(b, np.uint8).reshape(-1, 3, 4))
        encoded = np.concatenate(all_values); linear = (encoded[:, :, [2, 1, 0]].astype(float) * (2 / 255)) ** 2.200000047683716
        prop = props[instance['index']]
        instances.append(dict(index=instance['index'], model=instance['model'], origin=prop['origin'],
            originalVhvExact=True, sourceSha256=SHA(raw), originalVhvVertices=len(encoded),
            linearRadianceMin=linear.min(axis=(0, 1)).tolist(), linearRadianceMedian=np.median(linear, axis=(0, 1)).tolist(),
            linearRadianceMax=linear.max(axis=(0, 1)).tolist(), allDirectionsDarkFraction=float(np.mean(np.max(linear, axis=(1, 2)) < .03))))
    receipt = dict(status='original_prop_texture_uv_and_vhv_readback_passed', environment=environment,
        scope='Read-only original asset and numerical branch audit. No browser render, GPU mip inspection, same-camera original capture or pixel score.',
        originalGLBSha256=SHA(original), sourceBspSha256=SHA(bsp), materials=materials,
        textures=textures, primitives=verified, centroidSamples=samplings, instances=instances,
        limitations=['Original authored VTF mip levels are not presently exported in the single-PNG GLB path; GPU visual contribution requires controlled capture.',
            'Centroid samples do not measure screen area and contain deliberately hidden faces.',
            'VHV values use the already verified installed bump vertex shader decode; exposure and original display calibration are separate.',
            'No arbitrary brightness, alpha or UV changes justified by this audit.'])
    target = ROOT / 'research/source-prop-dark-edges.json'
    target.write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(dict(materials=len(materials), primitives=len(verified), instances=len(instances), textures=len(textures), centroidSamples=samplings), indent=2))


if __name__ == '__main__': main()
