"""Independent stdlib GLB/source-corner readback, without SourceIO or Blender."""
from pathlib import Path
from collections import Counter
import hashlib
import importlib.util
import json
import struct
import sys
import time
import zipfile

ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'.reference-assets/source-exports/dust2-vhv/geometry'
GAME=ROOT/'.reference-assets/csgo-legacy/csgo'
def sha(data):return hashlib.sha256(data).hexdigest()
def glb(path):
    data=path.read_bytes();assert data[:4]==b'glTF' and struct.unpack_from('<I',data,8)[0]==len(data)
    size,kind=struct.unpack_from('<2I',data,12);assert kind==0x4e4f534a;doc=json.loads(data[20:20+size])
    return doc,memoryview(data)[28+size:28+size+doc['buffers'][0]['byteLength']],data
def main():
    started=time.perf_counter();report=json.loads((OUT/'manifest.json').read_text())
    doc,binary,candidate=glb(OUT/report['file']);assert sha(candidate)==report['sha256']
    old,old_binary,original=glb(ROOT/'.reference-assets/source-exports/dust2/props.glb');assert sha(original)==report['originalGLBSha256']
    assert doc['nodes']==old['nodes'] and doc['materials']==old['materials'] and doc['textures']==old['textures'] and doc['samplers']==old['samplers']
    for new_image,old_image,item in zip(doc['images'],old['images'],report['images']):
        a=doc['bufferViews'][new_image['bufferView']];b=old['bufferViews'][old_image['bufferView']]
        x=binary[a.get('byteOffset',0):a.get('byteOffset',0)+a['byteLength']];y=old_binary[b.get('byteOffset',0):b.get('byteOffset',0)+b['byteLength']]
        assert x==y and sha(x)==item['sha256']
    vhv=json.loads((OUT.parent/'inventory.json').read_text());mapping=(OUT.parent/'source-vertex-map.u32').read_bytes();lighting=(OUT.parent/'instance-lighting.bin').read_bytes()
    assert sha(mapping)==vhv['binary']['mapping']['sha256'] and sha(lighting)==vhv['binary']['lighting']['sha256']
    spec=importlib.util.spec_from_file_location('prop_validate_vpk',ROOT/'scripts/inventory-source-map.py');m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
    index=m.VPKIndex(GAME/'pak01_dir.vpk');cache={};remaining=Counter(r['model'] for r in report['records']);verified=0;corners=0;extra_uv_channels=0
    def accessor(i):
        a=doc['accessors'][i];v=doc['bufferViews'][a['bufferView']];assert v['buffer']==0 and not v.get('byteStride') and not a.get('sparse')
        n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]*a['count'];assert a['componentType'] in (5125,5126)
        start=v.get('byteOffset',0)+a.get('byteOffset',0);return a,bytes(binary[start:start+4*n])
    with zipfile.ZipFile(ROOT/'output/source1/de_dust2/lumps/40-pakfile.bin') as pak:
        members={p.lower():p for p in pak.namelist()}
        def read(path):
            path=path.replace('\\','/').lower();data=pak.read(members[path]) if path in members else (GAME/path).read_bytes() if (GAME/path).is_file() else index.read(path)
            assert sha(data)==report['dependencies'][path]['sha256'];return data
        for item in report['records']:
            name=item['model'];model=vhv['models'][item['modelIndex']];group=model['groups'][item['sourceGroupIndex']]
            if name not in cache:
                mdl,vvd,vtx=read(name),read(name[:-4]+'.vvd'),read(name[:-4]+'.dx90.vtx')
                assert struct.unpack_from('<I',mdl,8)[0]==struct.unpack_from('<I',vvd,8)[0]==struct.unpack_from('<I',vtx,16)[0]==model['checksum']
                # No actual nonzero fixups in this frozen map; reject rather than
                # infer an unverified mapping for a different source branch.
                assert struct.unpack_from('<I',vvd,48)[0]==0
                raw_count=struct.unpack_from('<I',vvd,16)[0];vertex_start,tangent_start=struct.unpack_from('<2I',vvd,56)
                extra={};e=tangent_start+16*raw_count if tangent_start else vertex_start+48*raw_count
                if e+8<=len(vvd):
                    count,total=struct.unpack_from('<2I',vvd,e)
                    # Exact raw attribute descriptors, not SourceIO's object graph.
                    if e+8+total<=len(vvd):
                        for j in range(count):
                            kind,offset,size=struct.unpack_from('<3I',vvd,e+8+j*12);assert kind<=7 and size==8
                            extra[j+1]=(e+offset,size)
                cache[name]=(mdl,vvd,vtx,vertex_start,extra)
            mdl,vvd,vtx,vertex_start,extra=cache[name]
            p=doc['meshes'][item['mesh']]['primitives'][item['primitive']];assert p['material']==item['material'] and p['mode']==4
            assert p['extras']=={'sourceVhvModelIndex':item['modelIndex'],'sourceVhvGroupIndex':item['sourceGroupIndex'],'sourceHardwareVertexBase':item['hardwareVertexBase']}
            arrays={key:accessor(value) for key,value in p['attributes'].items()}
            for key,(a,raw) in arrays.items():assert sha(raw)==item['attributeSha256'][key] and a['count']==group['vertexCount']
            pairs=list(struct.iter_unpack('<2I',mapping[group['mappingOffset']:group['mappingOffset']+group['mappingBytes']]))
            expected={key:bytearray() for key in arrays}
            for j,(packed,file_id) in enumerate(pairs):
                x,y,z,nx,ny,nz,u,v=struct.unpack_from('<8f',vvd,vertex_start+48*file_id+16)
                expected['POSITION'].extend(struct.pack('<3f',x,z,-y));expected['NORMAL'].extend(struct.pack('<3f',nx,nz,-ny));expected['TEXCOORD_0'].extend(struct.pack('<2f',u,v))
                expected['_SOURCE_VVD'].extend(struct.pack('<f',file_id));expected['_SOURCE_VHV'].extend(struct.pack('<f',item['hardwareVertexBase']+j))
                for channel,(start,size) in extra.items():expected['TEXCOORD_'+str(channel)].extend(vvd[start+file_id*size:start+(file_id+1)*size])
            for key,raw in expected.items():assert raw==arrays[key][1],(name,key)
            extra_uv_channels+=len(extra)
            # Independent VTX address walk and original index-triplet readback.
            body_start=struct.unpack_from('<I',vtx,32)[0]+group['body']*8
            vm=body_start+struct.unpack_from('<I',vtx,body_start+4)[0]+group['model']*8
            lod=vm+struct.unpack_from('<I',vtx,vm+4)[0]+group['lod']*12
            mesh=lod+struct.unpack_from('<I',vtx,lod+4)[0]+group['mesh']*9
            assert group['stripGroup']==0,'Only actual one-group meshes accepted in independent validator'
            sg=mesh+struct.unpack_from('<I',vtx,mesh+4)[0];count,relative=struct.unpack_from('<2I',vtx,sg+8)
            source_indices=vtx[sg+relative:sg+relative+count*2];actual_a,actual=accessor(p['indices'])
            assert actual_a['count']==count and actual_a['componentType']==5125
            expected_indices=b''.join(struct.pack('<3I',c,b,a) for a,b,c in struct.iter_unpack('<3H',source_indices))
            assert expected_indices==actual and sha(actual)==item['indexSha256']
            verified+=len(pairs);corners+=count;remaining[name]-=1
            if not remaining[name]:del cache[name]
    joins=0
    for instance in vhv['instances']:
        offset=instance['groups'][0]['lightingOffset'];flat=0
        for group in instance['groups']:
            assert offset+flat*12==group['lightingOffset'];flat+=group['vertexCount'];assert offset+flat*12<=len(lighting)
        joins+=1
    result={'status':'independent_original_vertex_corner_and_instance_join_readback_passed','sourceIOImported':False,'models':len(vhv['models']),
        'meshes':report['meshes'],'primitives':len(report['records']),'verticesChecked':verified,'triangleCornersChecked':corners,'extraUVGroupChannelsChecked':extra_uv_channels,
        'originalImagesExact':len(report['images']),'originalNodeTransformsExact':len(doc['nodes']),'originalMaterialsExact':len(doc['materials']),
        'instanceLightingOffsetJoins':joins,'candidateSha256':report['sha256'],'unchangedOriginalGLBSha256':report['originalGLBSha256'],
        'nearestPointMatchingUsed':False,'gpuVerified':False,'seconds':time.perf_counter()-started}
    (OUT/'verification.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
if __name__=='__main__':main()
