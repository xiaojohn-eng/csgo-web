"""Read original prop GLB foliage and project bounded rays from an existing receipt.

Writes only a private inspection directory and a research JSON. No game changes,
nearest-vertex matching, image repainting, or assertion of original engine shading.
Requires the bundled workspace Python (numpy/Pillow), no package installation.
"""
from pathlib import Path
from io import BytesIO
import hashlib
import json
import math
import re
import struct

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.reference-assets/source-exports/dust2-foliage-audit'
PREFIX = 'models/props/de_dust/hr_dust/foliage/'


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


class Glb:
    def __init__(self, path):
        self.file = path.open('rb')
        header = self.file.read(20)
        magic, version, total, count, kind = struct.unpack('<5I', header)
        assert (magic, version, kind) == (0x46546c67, 2, 0x4e4f534a)
        assert total == path.stat().st_size
        self.json = json.loads(self.file.read(count))
        size, kind = struct.unpack('<2I', self.file.read(8))
        assert kind == 0x004e4942 and size >= self.json['buffers'][0]['byteLength']
        self.offset = self.file.tell()
        self.cache = {}

    def view(self, index):
        view = self.json['bufferViews'][index]
        self.file.seek(self.offset + view.get('byteOffset', 0))
        return self.file.read(view['byteLength'])

    def accessor(self, index):
        if index in self.cache:
            return self.cache[index]
        item = self.json['accessors'][index]
        assert 'sparse' not in item and not item.get('normalized', False)
        dtype = {5121: '<u1', 5123: '<u2', 5125: '<u4', 5126: '<f4'}[item['componentType']]
        lanes = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[item['type']]
        raw = self.view(item['bufferView'])
        step = self.json['bufferViews'][item['bufferView']].get('byteStride', np.dtype(dtype).itemsize * lanes)
        value = np.ndarray((item['count'], lanes), dtype=dtype, buffer=raw,
                           offset=item.get('byteOffset', 0), strides=(step, np.dtype(dtype).itemsize)).copy()
        self.cache[index] = value
        return value


def local_matrix(node):
    if 'matrix' in node:
        return np.array(node['matrix']).reshape(4, 4).T
    x, y, z, w = node.get('rotation', [0, 0, 0, 1])
    m = np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w), 0],
                  [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w), 0],
                  [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y), 0], [0, 0, 0, 1.]])
    m[:3, :3] *= node.get('scale', [1, 1, 1])
    m[:3, 3] = node.get('translation', [0, 0, 0])
    return m


def main():
    OUT.mkdir(exist_ok=True)
    glb_path = ROOT / '.reference-assets/source-exports/dust2/props.glb'
    glb = Glb(glb_path)
    g = glb.json
    branches = json.loads((ROOT / 'research/source-prop-material-branches.json').read_text())
    originals = {m['source']: m for m in branches['materials']}
    sky_path = ROOT / 'public/source/csgo-12426148/dust2/sky.json'
    sky = json.loads(sky_path.read_text())
    sky_ids = set(sky['staticPropIds'])
    receipt_path = ROOT / 'output/playwright/source-r4-ak-native-audio-gpu.json'
    receipt = json.loads(receipt_path.read_text())
    player = next(p for p in receipt['reload']['snapshot']['players'] if p['name'] == 'AK Audio')
    view = receipt['inspect']['sourceSky']
    sky_camera = np.array([view['position'][k] for k in 'xyz'])
    main_camera = (sky_camera - np.array([view['visibilityOrigin'][k] for k in 'xyz'])) * sky['camera']['scale']
    screenshot = ROOT / 'output/playwright/source-r4-ak-native-audio-inspect.png'
    screen = np.asarray(Image.open(screenshot).convert('RGB'))
    height, width = screen.shape[:2]
    yaw = player['yaw']
    rotation = np.array([[math.cos(yaw), 0, math.sin(yaw)], [0, 1, 0], [-math.sin(yaw), 0, math.cos(yaw)]])
    probes = [{'pixel': xy, 'hits': []} for xy in [(206, 195), (243, 204), (218, 219), (166, 240), (78, 288), (102, 322), (137, 306)]]
    for probe in probes:
        x, y = probe['pixel']
        direction = rotation @ np.array([(2*(x+.5)/width-1)*(width/height)*math.tan(math.radians(78)/2),
                                         (1-2*(y+.5)/height)*math.tan(math.radians(78)/2), -1])
        probe['direction'] = direction / np.linalg.norm(direction)
        probe['screenshotRGB'] = screen[y, x].tolist()
    records, images, drawables = {}, {}, []

    def walk(index, parent, prop_id=None):
        node = g['nodes'][index]
        matrix = parent @ local_matrix(node)
        match = re.fullmatch(r'static_prop_(\d+)', node.get('name', ''))
        if match:
            prop_id = int(match[1])
        for primitive_index, primitive in enumerate(g['meshes'][node['mesh']]['primitives'] if 'mesh' in node else []):
            material_index = primitive['material']
            material = g['materials'][material_index]
            source = material.get('extras', {}).get('full_path', material.get('name', ''))
            if not source.startswith(PREFIX):
                continue
            if source not in records:
                original = originals[source]
                texture = g['textures'][material['pbrMetallicRoughness']['baseColorTexture']['index']]
                image = g['images'][texture['source']]
                raw = glb.view(image['bufferView'])
                assert image['mimeType'] == 'image/png'
                filename = source.rsplit('/', 1)[1] + '.png'
                (OUT / filename).write_bytes(raw)  # Exact embedded PNG bytes, no re-encoding.
                rgba = np.asarray(Image.open(BytesIO(raw)).convert('RGBA'))
                images[source] = rgba
                cutoff = material.get('alphaCutoff', .5)
                passed = rgba[:, :, 3] / 255 >= cutoff if material.get('alphaMode') == 'MASK' else np.ones(rgba.shape[:2], dtype=bool)
                rgb = rgba[:, :, :3][passed]
                records[source] = dict(original=original, gltfMaterial=material, materialIndex=material_index,
                    embeddedImage={'file': filename, 'sha256': hashlib.sha256(raw).hexdigest(), 'size': list(rgba.shape[:2][::-1]),
                      'alphaZeroTexels': int(np.count_nonzero(rgba[:, :, 3] == 0)), 'alphaPartialTexels': int(np.count_nonzero((rgba[:, :, 3] > 0) & (rgba[:, :, 3] < 255))),
                      'cutoffPassedTexels': int(passed.sum()), 'passedMeanEncodedRGB': rgb.mean(axis=0).tolist(),
                      'passedRGBQuantiles': np.quantile(rgb, [0, .1, .5, .9, 1], axis=0).tolist()},
                    instances=[], primitives=0, triangles=0, skyInstances=[])
            record = records[source]
            record['instances'].append(prop_id)
            if prop_id in sky_ids:
                record['skyInstances'].append(prop_id)
            record['primitives'] += 1
            indices = glb.accessor(primitive['indices']).reshape(-1, 3)
            record['triangles'] += len(indices)
            # Trace only the screenshot's two material classes; inventories cover all foliage.
            if source.rsplit('/', 1)[1] not in ('palm_frond_01', 'olive_branch_01'):
                continue
            position = glb.accessor(primitive['attributes']['POSITION'])
            position = position @ matrix[:3, :3].T + matrix[:3, 3]
            drawables.append((node['name'], prop_id, source, primitive_index, position[indices],
                              glb.accessor(primitive['attributes']['TEXCOORD_0'])[indices]))
        for child in node.get('children', []):
            walk(child, matrix, prop_id)

    for index in g['scenes'][g.get('scene', 0)]['nodes']:
        walk(index, np.eye(4))
    for name, prop_id, source, primitive_index, triangle, triangle_uv in drawables:
        origin = sky_camera if prop_id in sky_ids else main_camera
        a, b, c = triangle[:, 0], triangle[:, 1], triangle[:, 2]
        e1, e2 = b-a, c-a
        for probe in probes:
            direction = probe['direction']
            h = np.cross(direction, e2)
            determinant = np.einsum('ij,ij->i', e1, h)
            usable = np.abs(determinant) > 1e-10
            inverse = np.divide(1., determinant, out=np.zeros_like(determinant), where=usable)
            s = origin-a
            u = inverse*np.einsum('ij,ij->i', s, h)
            q = np.cross(s, e1)
            v = inverse*(q @ direction)
            t = inverse*np.einsum('ij,ij->i', e2, q)
            hits = np.flatnonzero(usable & (u >= 0) & (v >= 0) & (u+v <= 1) & (t > 0))
            for hit in hits:
                uv = triangle_uv[hit, 0]*(1-u[hit]-v[hit])+triangle_uv[hit, 1]*u[hit]+triangle_uv[hit, 2]*v[hit]
                rgba = images[source]
                # Pixel-center bilinear repeat sampling at LOD0. GPU mip/aniso derivatives remain outside this probe.
                px, py = (uv % 1)*[rgba.shape[1], rgba.shape[0]]-.5
                x, y = math.floor(px), math.floor(py)
                sample = sum(rgba[(y+dy) % rgba.shape[0], (x+dx) % rgba.shape[1]].astype(float)*
                             ((px-x) if dx else (1-px+x))*((py-y) if dy else (1-py+y))
                             for dx, dy in [(0, 0), (0, 1), (1, 0), (1, 1)])
                probe['hits'].append({'node': name, 'propId': prop_id, 'primitive': primitive_index,
                    'material': source, 'sky': prop_id in sky_ids, 'triangleIndex': int(hit), 'distanceInPass': float(t[hit]),
                    'uv': uv.tolist(), 'bilinearLOD0RGBA': sample.tolist(), 'alphaPassAtLOD0': bool(sample[3] / 255 >= .3)})
    for record in records.values():
        record['instances'] = sorted(set(record['instances']))
        record['skyInstances'] = sorted(set(record['skyInstances']))
        assert record['primitives'] == record['original']['meshInstances']
        assert record['triangles'] == record['original']['triangles']
    for probe in probes:
        del probe['direction']
        probe['hits'].sort(key=lambda h: (h['sky'], h['distanceInPass']))
    report = {'format': 'source-foliage-diagnosis-v1', 'propsGlbSha256': digest(glb_path),
        'screenshot': str(screenshot.relative_to(ROOT)), 'screenshotSha256': digest(screenshot),
        'receiptSha256': digest(receipt_path), 'skyDescriptorSha256': digest(sky_path),
        'camera': {'main': main_camera.tolist(), 'sky': sky_camera.tolist(), 'yaw': yaw, 'pitch': 0, 'fov': 78,
          'source': 'inspect receipt sky.position/visibilityOrigin gives exact position; yaw/pitch borrowed from stationary earlier reload snapshot; FOV78 is runtime settings default, not private preview FOV75',
          'boundary': 'Earlier orientation and nominal FOV, not a stored inspect projection matrix; CPU rays are candidate identity evidence, not GPU object-ID or full scene occlusion proof.'},
        'codeSnapshotHashes': {name: digest(ROOT / name) for name in ['game/scene.ts', 'game/runtime.ts',
          'game/source-sky-render.ts', 'game/source-prop-lighting.ts', 'scripts/convert-source-map.py', 'scripts/asset-preview.html']},
        'materials': records, 'pixelProbes': probes,
        'boundary': 'Exact embedded PNG bytes and GLB geometry, original material inventory. RGB statistics are encoded texture values, not linear light or original rendered brightness. Ray intersections include only palm/olive geometry; LOD0 alpha does not reproduce GPU mipmapping.'}
    destination = ROOT / 'research/source-foliage-diagnosis.json'
    destination.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'report': str(destination.relative_to(ROOT)), 'materials': len(records),
        'focused': {k.rsplit('/', 1)[1]: {'primitives': v['primitives'], 'triangles': v['triangles'], 'sky': len(v['skyInstances'])}
                    for k, v in records.items() if k.rsplit('/', 1)[1] in ('palm_frond_01', 'olive_branch_01', 'sumac_01')},
        'probes': [{'pixel': p['pixel'], 'rgb': p['screenshotRGB'], 'passing': [(h['propId'], h['sky'], h['material'].rsplit('/', 1)[1]) for h in p['hits'] if h['alphaPassAtLOD0']]} for p in probes]}, indent=2))


if __name__ == '__main__':
    main()
