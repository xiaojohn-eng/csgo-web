"""Stage untouched Dust II HDR cubes and leaf ambient samples in a new directory.

Original VTF face/mip bytes are retained. No tone mapping, image conversion,
resampling, invented probe, original asset rewrite or existing export overwrite.
"""
from pathlib import Path
import hashlib
import io
import json
import math
import struct
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.reference-assets/source-exports/fidelity-environment-20260913'
PUBLIC = ROOT / 'public/source/csgo-12426148/environment-probes'
sha = lambda b: hashlib.sha256(b).hexdigest()

def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_bytes() != data:
        raise ValueError('Refusing to replace different existing environment evidence: '+str(path))
    path.write_bytes(data)

def main():
    bsp_path = ROOT / '.reference-assets/csgo-legacy/csgo/maps/de_dust2.bsp'
    data = bsp_path.read_bytes()
    assert data[:4] == b'VBSP' and struct.unpack_from('<I', data, 4)[0] == 21
    lumps = {i: struct.unpack_from('<iii4s', data, 8+16*i) for i in range(64)}
    def raw(i):
        offset,size,version,compressed=lumps[i]
        assert offset >= 0 and offset+size <= len(data) and compressed == bytes(4)
        return data[offset:offset+size]
    zipdata=zipfile.ZipFile(io.BytesIO(raw(40)))
    files=[]
    def stage(path, content, **extra):
        for target in [OUT,PUBLIC]: save(target/path,content)
        row={'path':path,'bytes':len(content),'sha256':sha(content),**extra};files.append(row);return row
    records=[]
    for i,name,stride in [(1,'planes',20),(5,'nodes',32),(10,'leaves',32),(51,'ambient-index-hdr',4),(55,'ambient-lighting-hdr',28)]:
        content=raw(i);assert len(content)%stride==0
        records.append(stage(name+'.bin',content,lump=i,version=lumps[i][2],recordBytes=stride,count=len(content)//stride))
    leaf_count=len(raw(10))//32;indices=list(struct.iter_unpack('<HH',raw(51)))
    assert len(indices)==leaf_count
    total=len(raw(55))//28
    for i,(count,first) in enumerate(indices):
        if count: assert first+count<=total
        else:
            seen={i};leaf=first
            while indices[leaf][0]==0:
                if leaf==indices[leaf][1] and struct.unpack_from('<i',raw(10),32*leaf)[0]&1: break  # original empty solid leaf sentinel
                assert leaf not in seen, ('Ambient reference cycle',leaf)
                seen.add(leaf);leaf=indices[leaf][1]
            assert 0<=leaf<leaf_count
    probes=[]
    for x,y,z,size in struct.iter_unpack('<3iB3x',raw(42)):
        name=f'materials/maps/de_dust2/c{x}_{y}_{z}.hdr.vtf';vtf=zipdata.read(name)
        assert vtf[:4]==b'VTF\0' and struct.unpack_from('<II',vtf,4)==(7,5)
        width,height=struct.unpack_from('<HH',vtf,16);flags=struct.unpack_from('<I',vtf,20)[0]
        assert width==height and struct.unpack_from('<i',vtf,52)[0]==24 and flags&0x4000
        frames=struct.unpack_from('<H',vtf,24)[0];assert frames==1
        resources=struct.unpack_from('<I',vtf,68)[0]
        images=[struct.unpack_from('<I',vtf,84+8*j)[0] for j in range(resources) if vtf[80+8*j:83+8*j]==b'\x30\0\0']
        assert len(images)==1
        start=images[0];mips=vtf[56];expected=sum(max(1,width>>m)**2*8*6 for m in range(mips))
        assert start+expected==len(vtf)
        channels=[p[0] for p in struct.iter_unpack('<e',vtf[start:])];assert all(math.isfinite(v) and v>=0 for v in channels)
        row=stage(f'cubes/c{x}_{y}_{z}.hdr.vtf',vtf)
        probes.append({'id':f'{x}_{y}_{z}','sourcePosition':[x,y,z],'sourcePath':name,'cube':row['path'],
                       'width':width,'mipCount':mips,'format':'RGBA16161616F','originalFlags':flags,
                       'sourceSizeField':size,'minChannel':min(channels),'maxChannel':max(channels)})
    manifest={'format':'source-environment-probes-v1','sourceApp':740,'build':12426148,
              'sourceBSP':{'path':str(bsp_path.relative_to(ROOT)),'sha256':sha(data),'bytes':len(data)},
              'metresPerSourceUnit':.0254,'cubeFaceOrder':['+X','-X','+Y','-Y','+Z','-Z'],
              'cubemapStorage':'Original linear half-float VTF bytes including every face and mip; no generated mipmaps',
              'ambientStorage':'Original dleafambientlighting_t ColorRGBExp32[6] and byte XYZ leaf-relative positions',
              'ambientDecode':'RGB*2^signedExponent (ColorRGBExp32ToVector)',
              'ambientInterpolation':'Source SDK pinned VRAD inverse-square-distance 1/(distanceSquared+1) reconstruction inside the resolved leaf',
              'ambientZeroSampleIndex':'firstAmbientSample names a reference leaf when ambientSampleCount=0',
              'records':records,'probes':probes,'files':files,
              'sourceReferences':[
                  {'url':'https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/utils/vrad/leaf_ambient_lighting.cpp','lines':[415,418,695,706]},
                  {'path':'.reference-assets/shader-reference/bspfile.h','lines':[860,875,992,999]},
                  {'path':'.reference-assets/shader-reference/common_vertexlitgeneric_dx9.h','lines':[41,49]},
                  {'path':'.reference-assets/shader-reference/color_conversion.cpp','lines':[450,456]},
                  {'url':'https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/vtf/vtf.h','lines':[135,142]}],
              'boundary':['Original map data, VTF format and SDK ambient reconstruction; original engine runtime probe selection/interpolation and final pixels not independently executed.',
                          'Reflection chooses the nearest installed map probe; no invented RoomEnvironment texture.']}
    encoded=(json.dumps(manifest,indent=2)+'\n').encode()
    for target in [OUT,PUBLIC]:save(target/'manifest.json',encoded)
    receipt={'format':manifest['format'],'manifestSha256':sha(encoded),'manifestBytes':len(encoded),'files':len(files),
             'probes':len(probes),'ambientSamples':total,'leaves':leaf_count,'sourceBSP':manifest['sourceBSP'],
             'assetBytes':sum(r['bytes'] for r in files),'outputDirectories':[str(OUT.relative_to(ROOT)),str(PUBLIC.relative_to(ROOT))]}
    (ROOT/'research/source-environment-probes.json').write_text(json.dumps(receipt,indent=2)+'\n')
    (ROOT/'game/source-environment-probes-data.ts').write_text('// Generated by scripts/stage-source-environment-probes.py from the original Dust II BSP.\nexport const SOURCE_ENVIRONMENT_PROBES_MANIFEST_SHA256 = '+json.dumps(sha(encoded))+';\n')
    print(json.dumps(receipt))

if __name__=='__main__':main()
