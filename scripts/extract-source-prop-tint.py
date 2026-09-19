"""Bounded original bump+tint candidate. Factory-startup Blender/SourceIO only.

No original geometry/material/texture files are changed. Four visible materials
are selected by their exact original VMT identities; no color adjustment is made.
"""
from pathlib import Path
import hashlib,importlib.util,json,struct,sys,zipfile,zlib
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('tint_items',ROOT/'scripts/inventory-source-items.py')
items=importlib.util.module_from_spec(s);s.loader.exec_module(items);context=items.initialize();sources=items.Sources()
from SourceIO.library.utils.pylib.vtf import load_vtf_texture
import numpy as np
OUT=ROOT/'.reference-assets/source-exports/dust2-vhv/tint';OUT.mkdir(exist_ok=True)
catalog_path=ROOT/'research/source-prop-material-branches.json';catalog=json.loads(catalog_path.read_text())
evidence=ROOT/'.reference-assets/source-exports/dust2-vhv/encoding/tint/tint-evidence.json'
assert json.loads(evidence.read_text())['renderHandoff']['exactFloat32Cases']==256
prefix='models/props/de_dust/hr_dust/'
selected_names={prefix+p for p in ['dust_windows/dust_window_frame_wood_01','dust_wires/dust_wires_01',
  'dust_kasbah/dust_kasbah_tarp_04','dust_crates/dust_shipping_crate_02_painted_color']}
allowed={'$basetexture','$bumpmap','$surfaceprop','$model','$notint','$nocull','$nodecal','$alphatest',
 '$alphatestreference','$allowalphatocoverage','$tintmasktexture'}
selected=[m for m in catalog['materials'] if m['source'] in selected_names]
assert len(selected)==4 and {m['source'] for m in selected}==selected_names
sha=lambda b:hashlib.sha256(b).hexdigest()
def png_rgba(pixels,w,h):
    def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    rows=b''.join(b'\0'+pixels[y*w*4:(y+1)*w*4] for y in range(h))
    packed=zlib.compress(rows,9)
    # Independent readback of the unfiltered PNG payload preserves every byte.
    readback=zlib.decompress(packed)
    assert b''.join(readback[y*(w*4+1)+1:(y+1)*(w*4+1)] for y in range(h))==pixels
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>2I5B',w,h,8,6,0,0,0))+chunk(b'IDAT',packed)+chunk(b'IEND',b'')
pak=zipfile.ZipFile(ROOT/'output/source1/de_dust2/lumps/40-pakfile.bin');names={n.lower():n for n in pak.namelist()};textures={};materials=[]
for material in selected:
    p=material['parameters'];assert material['shader']=='vertexlitgeneric' and p.get('$bumpmap') and set(p)<=allowed
    path='materials/'+p['$tintmasktexture'].replace('\\','/').lower().removesuffix('.vtf')+'.vtf'
    if path not in textures:
        raw=pak.read(names[path]) if path in names else sources.read(path)
        pixels,w,h,is_float=load_vtf_texture(raw);assert not is_float
        pixels=bytes(pixels);assert len(pixels)==w*h*4
        flags=struct.unpack_from('<I',raw,20)[0];png=png_rgba(pixels,w,h);name=sha(path.encode())[:16]+'.png'
        (OUT/name).write_bytes(png);rgba=np.frombuffer(pixels,np.uint8).reshape(h,w,4)
        textures[path]=dict(source=path,sourceContainer='original BSP pak' if path in names else 'installed loose/VPK',
          sourceSha256=sha(raw),sourceBytes=len(raw),vtfFlags=flags,width=w,height=h,clampS=bool(flags&4),clampT=bool(flags&8),
          url=name,bytes=len(png),sha256=sha(png),decodedPixelSha256=sha(pixels),channels='unchanged original RGBA8',
          min=rgba.min(axis=(0,1)).tolist(),max=rgba.max(axis=(0,1)).tolist())
    materials.append(dict(material=material['source'],tintSource=path,originalVmtSha256=material['rawVmtSha256'],
      meshInstances=material['meshInstances'],triangles=material['triangles']))
modulation_path=OUT.parent/'encoding/instance-modulation.json';modulation=json.loads(modulation_path.read_text())
assert modulation['sourceBspSha256']==catalog['sourceBspSha256'] and modulation['instances']==3158
colors=modulation['colors'];assert [c['index'] for c in colors]==list(range(3158))
raw_rgba=bytes(value for c in colors for value in c['rgba']);(OUT/'instance-rgba.u8').write_bytes(raw_rgba)
result=dict(format='source-prop-tint-v1',sourceBspSha256=catalog['sourceBspSha256'],context=context,
  encodingEvidenceSha256=sha(evidence.read_bytes()),catalogSha256=sha(catalog_path.read_bytes()),materials=materials,textures=list(textures.values()),
  instanceRGBA=dict(url='instance-rgba.u8',bytes=len(raw_rgba),sha256=sha(raw_rgba),count=3158,sourceAuditSha256=sha(modulation_path.read_bytes())),
  boundary='Four exact pure bumped+tint original VMTs with default white material color. Original instance RGB only; alpha, other passes, compound shaders and full Source exposure excluded.')
(OUT/'manifest.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='context'},indent=2))
