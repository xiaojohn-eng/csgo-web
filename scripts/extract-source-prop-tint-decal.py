"""Lossless original texture + instance-byte export for two compound crate VMTs.
Factory-startup Blender/SourceIO; never writes frozen R3/R4 or original files.
"""
from pathlib import Path
import hashlib,importlib.util,json,struct,zipfile,zlib
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'.reference-assets/source-exports/dust2-vhv/tint-decal'
s=importlib.util.spec_from_file_location('compound_items',ROOT/'scripts/inventory-source-items.py')
items=importlib.util.module_from_spec(s);s.loader.exec_module(items);context=items.initialize();sources=items.Sources()
from SourceIO.library.utils.pylib.vtf import load_vtf_texture
sha=lambda b:hashlib.sha256(b).hexdigest()
def png_rgba(p,w,h):
    def chunk(k,d):return struct.pack('>I',len(d))+k+d+struct.pack('>I',zlib.crc32(k+d)&0xffffffff)
    raw=b''.join(b'\0'+p[y*w*4:(y+1)*w*4] for y in range(h));packed=zlib.compress(raw,9)
    assert zlib.decompress(packed)==raw
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>2I5B',w,h,8,6,0,0,0))+chunk(b'IDAT',packed)+chunk(b'IEND',b'')
OUT.mkdir(exist_ok=True);catalogPath=ROOT/'research/source-prop-material-branches.json';catalog=json.loads(catalogPath.read_text())
names={'models/props/de_dust/hr_dust/dust_crates/dust_shipping_crate_0'+i+'_painted_decals' for i in ('1','2')}
materials=[m for m in catalog['materials'] if m['source'] in names];assert len(materials)==2
allowed={'$basetexture','$bumpmap','$tintmasktexture','$surfaceprop','$decaltexture','$decalblendmode'}
pak=zipfile.ZipFile(ROOT/'output/source1/de_dust2/lumps/40-pakfile.bin');members={p.lower():p for p in pak.namelist()};textures={};rows=[]
for m in materials:
    p=m['parameters'];assert m['shader']=='vertexlitgeneric' and set(p)==allowed and p['$decalblendmode']=='1'
    paths={}
    for key in ('tintmasktexture','decaltexture'):
        source='materials/'+p['$'+key].replace('\\','/').lower().removesuffix('.vtf')+'.vtf';paths[key]=source
        if source in textures:continue
        raw=pak.read(members[source]) if source in members else sources.read(source)
        pixels,w,h,isFloat=load_vtf_texture(raw);assert not isFloat
        pixels=bytes(pixels);assert len(pixels)==w*h*4;png=png_rgba(pixels,w,h);flags=struct.unpack_from('<I',raw,20)[0];name=sha(source.encode())[:16]+'.png';(OUT/name).write_bytes(png)
        textures[source]={'source':source,'sourceSha256':sha(raw),'sourceBytes':len(raw),'vtfFlags':flags,'width':w,'height':h,
          'clampS':bool(flags&4),'clampT':bool(flags&8),'url':name,'bytes':len(png),'sha256':sha(png),'decodedPixelSha256':sha(pixels)}
    rows.append({'material':m['source'],'tintSource':paths['tintmasktexture'],'decalSource':paths['decaltexture'],'mode':1,
      'originalVmtSha256':m['rawVmtSha256'],'meshInstances':m['meshInstances'],'triangles':m['triangles']})
rgba=(OUT.parent/'tint/instance-rgba.u8').read_bytes();assert len(rgba)==3158*4;(OUT/'instance-rgba.u8').write_bytes(rgba)
proof=OUT.parent/'encoding/tint-decal/evidence.json';tintProof=OUT.parent/'encoding/tint/tint-evidence.json'
result={'format':'source-prop-tint-decal-v1','sourceBspSha256':catalog['sourceBspSha256'],'context':context,'materials':rows,'textures':list(textures.values()),
 'instanceRGBA':{'url':'instance-rgba.u8','bytes':len(rgba),'sha256':sha(rgba),'count':3158},'encodingEvidenceSha256':sha(proof.read_bytes()),
 'tintEvidenceSha256':sha(tintProof.read_bytes()),'catalogSha256':sha(catalogPath.read_bytes()),'boundary':'Two exact opaque original bumped+tint+multiply mode1 crate VMTs only; no alpha/decal-lerp/envmap/selfillum.'}
(OUT/'manifest.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
