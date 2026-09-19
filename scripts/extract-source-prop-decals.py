"""Decode original multiply-decal bytes only, with BSP-pak priority and no bake.
Run in factory-startup Blender for the pinned native SourceIO VTF decoder.
"""
from pathlib import Path
import hashlib,importlib.util,json,struct,sys,zipfile,zlib
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('decal_items',ROOT/'scripts/inventory-source-items.py')
items=importlib.util.module_from_spec(s);s.loader.exec_module(items);context=items.initialize();sources=items.Sources()
from SourceIO.library.utils.pylib.vtf import load_vtf_texture
from SourceIO.library.utils.pylib.image import encode_png
import numpy as np
def read_png_rgba(png):
    assert png[:8]==b'\x89PNG\r\n\x1a\n';at=8;packed=bytearray()
    while at<len(png):
        n=struct.unpack_from('>I',png,at)[0];kind=png[at+4:at+8];data=png[at+8:at+8+n]
        assert zlib.crc32(kind+data)&0xffffffff==struct.unpack_from('>I',png,at+8+n)[0]
        if kind==b'IHDR':
            w,h,depth,color,compression,filtering,interlace=struct.unpack('>2I5B',data)
            assert (depth,color,compression,filtering,interlace)==(8,6,0,0,0)
        if kind==b'IDAT':packed.extend(data)
        at+=n+12
        if kind==b'IEND':break
    assert at==len(png);decoded=zlib.decompress(packed);stride=w*4;assert len(decoded)==h*(stride+1)
    rows=[];previous=bytes(stride)
    for y in range(h):
        start=y*(stride+1);method=decoded[start];row=bytearray(decoded[start+1:start+1+stride]);assert method<=4
        for x in range(stride):
            a=row[x-4] if x>=4 else 0;b=previous[x];c=previous[x-4] if x>=4 else 0
            if method==1:value=a
            elif method==2:value=b
            elif method==3:value=(a+b)//2
            elif method==4:
                p=a+b-c;dist=[abs(p-a),abs(p-b),abs(p-c)];value=[a,b,c][dist.index(min(dist))]
            else:value=0
            row[x]=(row[x]+value)&255
        rows.append(row);previous=row
    return b''.join(rows)
OUT=ROOT/'.reference-assets/source-exports/dust2-vhv/decal';OUT.mkdir(exist_ok=True)
catalog=json.loads((ROOT/'research/source-prop-material-branches.json').read_text())
allowed={'$basetexture','$bumpmap','$surfaceprop','$model','$notint','$nocull','$nodecal','$alphatest','$alphatestreference','$allowalphatocoverage','$decaltexture','$decalblendmode'}
selected=[m for m in catalog['materials'] if m['shader']=='vertexlitgeneric' and m['parameters'].get('$bumpmap') and m['parameters'].get('$decalblendmode') in ('1','2') and m['parameters'].get('$decaltexture') and set(m['parameters'])<=allowed]
sha=lambda b:hashlib.sha256(b).hexdigest()
pak=zipfile.ZipFile(ROOT/'output/source1/de_dust2/lumps/40-pakfile.bin');names={n.lower():n for n in pak.namelist()};textures={};materials=[]
for material in selected:
    path='materials/'+material['parameters']['$decaltexture'].replace('\\','/').lower().removesuffix('.vtf')+'.vtf'
    if path not in textures:
        data=pak.read(names[path]) if path in names else sources.read(path)
        pixels,width,height,is_float=load_vtf_texture(data)
        if is_float:raise ValueError('Original HDR data requires a separate branch')
        flags=struct.unpack_from('<I',data,20)[0];png=encode_png(pixels,width,height,4)
        rgba=np.frombuffer(pixels,np.uint8).reshape(height,width,4)
        assert bytes(pixels)==read_png_rgba(png),'PNG readback changed original decoded pixels'
        name=sha(path.encode())[:16]+'.png';(OUT/name).write_bytes(png)
        textures[path]={'source':path,'sourceContainer':'original BSP embedded pak' if path in names else 'installed loose/VPK',
          'sourceSha256':sha(data),'sourceBytes':len(data),'vtfFlags':flags,'width':width,'height':height,
          'clampS':bool(flags&4),'clampT':bool(flags&8),'url':name,'bytes':len(png),'sha256':sha(png),
          'decodedPixelSha256':sha(pixels),'channels':'original RGBA8; no flip/color adjustment','sampling':'Original byte channels unchanged; installed dynamic sampler12 enables sRGB read when detailblendmode defaults to0',
          'min':rgba.min(axis=(0,1)).tolist(),'max':rgba.max(axis=(0,1)).tolist()}
    materials.append({'material':material['source'],'decalSource':path,'mode':int(material['parameters']['$decalblendmode']),
      'originalVmtSha256':material['rawVmtSha256'],'meshInstances':material['meshInstances'],'triangles':material['triangles']})
result={'format':'source-prop-decal-v1','sourceBspSha256':catalog['sourceBspSha256'],'context':context,'materials':materials,'textures':list(textures.values()),
  'decodedBytes':sum(t['width']*t['height']*4 for t in textures.values()),'boundary':'Only original multiply decal on previously verified bumped VHV; tint, phong, envmap remain excluded'}
(OUT/'manifest.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='context'},indent=2))
