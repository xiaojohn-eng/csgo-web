"""Read the Dust2 skydome's second layer and the proxy that drives it, from the shipped data.

The sky this port draws is one unlit layer. The original dome is two materials, and the
second one is the drifting cloud layer: an `unlittwotexture` material whose `$texture2` is
blended over `$basetexture` at `$alpha`, with a `texturescroll` proxy that animates the
base texture's transform. `game/source-sky-render.ts` records both as unmapped.

This writes down what the shipped files actually say — the material, its parameters, the
proxy's numbers, the sha256 of the VMT they came from, and the client class that implements
the proxy — without deciding how the proxy composes its transform, which nothing here
measures.

Run: python3 scripts/probe-source-sky-second-layer.py
"""
from __future__ import annotations
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MATERIALS = ROOT / '.reference-assets/source-exports/dust2/sky/skydome-materials.json'
SKY = ROOT / '.reference-assets/source-exports/dust2/sky/sky.json'
CLIENT = ROOT / '.reference-assets/csgo-legacy/csgo/bin/client_client.so'
OUT = ROOT / 'research/source-sky-second-layer.json'

materials = json.loads(MATERIALS.read_text())
sky = json.loads(SKY.read_text())
layers = []
for material in materials:
    proxy = (material.get('parameters') or {}).get('proxies') or {}
    scroll = (proxy.get('texturescroll') or []) if isinstance(proxy, dict) else []
    mapped = material.get('mapped') or []
    layers.append(dict(
        name=material.get('name'), source=material.get('source'), shader=material.get('shader'),
        parameters={key: value for key, value in (material.get('parameters') or {}).items() if key != 'proxies'},
        proxied=bool(scroll), proxies=proxy,
        mappedKeys=[list(row.keys()) if isinstance(row, dict) else row for row in mapped],
        mappedCount=len(mapped), unmappedCount=len(material.get('unmapped') or []),
        rawVmtSha256=material.get('rawVmtSha256'),
    ))
# The material the port already draws is the first; the drifting cloud layer is the one with
# both a second texture and a scroll, and its own numbers are what an implementation needs.
cloud = next(layer for layer in layers if layer['shader'] == 'unlittwotexture' and layer['proxied'])
base, second = cloud['parameters'].get('$basetexture'), cloud['parameters'].get('$texture2')
if not base or not second:
    raise SystemExit('The second sky layer no longer names both of its textures')
rate = cloud['proxies']['texturescroll']
if len(rate) != 2 or rate[0].get('texturescrollvar') != '$basetexturetransform':
    raise SystemExit('The second sky layer no longer scrolls its base texture, or scrolls something else')
# The client ships the class that implements the proxy; nothing here reads its arithmetic.
data = CLIENT.read_bytes()
class_offset = data.find(b'CTextureScrollMaterialProxy')
if class_offset < 0:
    raise SystemExit('The client no longer carries the proxy class this material names')
report = {
    'format': 'source-sky-second-layer-v1',
    'materials': str(MATERIALS.relative_to(ROOT)), 'sky': str(SKY.relative_to(ROOT)),
    'skyCamera': {key: sky.get(key) for key in ('scale', 'origin', 'angles') if key in sky},
    'layers': layers,
    'cloudLayer': dict(name=cloud['name'], shader=cloud['shader'], baseTexture=base, texture2=second,
                       alpha=cloud['parameters'].get('$alpha'), translucent=cloud['parameters'].get('$translucent'),
                       noFog=cloud['parameters'].get('$nofog'),
                       baseTransform=rate[0], texture2Transform=rate[1]),
    'proxyClass': dict(name='CTextureScrollMaterialProxy', offsetInClient=class_offset,
                       clientPath=str(CLIENT.relative_to(ROOT)),
                       clientSHA256=hashlib.sha256(data).hexdigest()),
    'boundary': 'This reads the shipped material files and the client\'s class name. It does not state how the '
                'texturescroll proxy composes its transform from rate, angle and scale: nothing here measured that, '
                'so a renderer must not be written from the parameter names alone.',
}
OUT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
print(json.dumps(report['cloudLayer'], indent=2))
print('proxyClass offset', hex(class_offset), 'layers', [layer['shader'] for layer in layers])
