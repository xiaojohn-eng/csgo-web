"""Extract original CHudScope VMTs and native decoded RGBA texture samples."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('source_items', ROOT / 'scripts/inventory-source-items.py')
items = importlib.util.module_from_spec(spec)
spec.loader.exec_module(items)
context = items.initialize()
sources = items.Sources()
from SourceIO.library.utils.pylib.vtf import load_vtf_texture
from SourceIO.library.utils.pylib.image import encode_png
import numpy as np

target = ROOT / '.reference-assets/source-exports/awp-scope'
target.mkdir(parents=True, exist_ok=True)
materials, textures = {}, {}

def extract_texture(path):
    path=sources.canonical_names.get(path.replace('\\','/').casefold(),path.replace('\\','/'))
    if path in textures:
        return
    data = sources.read(path)
    pixels, width, height, is_float = load_vtf_texture(data)
    if is_float:
        raise ValueError('Do not quantize float source texture: ' + path)
    rgba = np.frombuffer(pixels, dtype=np.uint8).reshape((height, width, 4))
    png = encode_png(pixels, width, height, 4)
    output = target / (Path(path).stem + '-rgba.png')
    output.write_bytes(png)
    if output.read_bytes() != png:
        raise IOError('PNG write/read differs')
    textures[path] = {'source': sources.reads[path], 'output': str(output.relative_to(ROOT)),
        'pngSha256': items.digest(png), 'pixelSha256': items.digest(pixels),
        'width': width, 'height': height, 'channels': 'RGBA8, original decoded bytes',
        'min': rgba.min(axis=(0,1)).tolist(), 'max': rgba.max(axis=(0,1)).tolist(),
        'mean': rgba.mean(axis=(0,1)).tolist(), 'samples': [{'x':x,'y':y,'rgba':rgba[y,x].tolist()} for x,y in [(0,0),(width-1,0),(0,height-1),(width-1,height-1),(width//2,height//2),(width//4,height//4),(3*width//4,3*height//4)]]}

def extract_material(path):
    if path in materials:
        return
    data = sources.read(path)
    parsed = items.parse_kv(data, path)
    output = target / Path(path).name
    output.write_bytes(data)
    materials[path] = {'source': sources.reads[path], 'output': str(output.relative_to(ROOT)), 'parsed': parsed}
    def walk(value):
        if not isinstance(value, dict):
            return
        for key, item in value.items():
            if key == 'include' and isinstance(item, str):
                extract_material(item)
            elif key in ('$basetexture', '$bumpmap', '$phongexponenttexture', '$lightwarptexture', '$phongwarptexture') and isinstance(item, str):
                texture_path = 'materials/' + item.removesuffix('.vtf') + '.vtf'
                extract_texture(texture_path)
            else:
                walk(item)
    walk(parsed)

for name in ['sprites/scope_arc','sprites/scope_line_blur','overlays/scope_lens']:
    extract_material('materials/' + name + '.vmt')
report = {'context': context, 'materials': materials, 'textures': textures,
    'conversion': 'Native VTF decode to raw RGBA8 PNG only; no PBR conversion, no color transform',
    'shaderEvidence': 'research/source-sdk-shader-index.json'}
(target / 'audit.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print('AWP_SCOPE_MATERIALS', json.dumps({'materials': materials, 'textures': len(textures)}, ensure_ascii=False))
