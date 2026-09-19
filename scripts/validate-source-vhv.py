"""Independent raw-struct readback; no SourceIO, Blender or GPU required."""
from pathlib import Path
import hashlib
import importlib.util
import json
import struct
import sys
import time
import zipfile

ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'.reference-assets/source-exports/dust2-vhv';GAME=ROOT/'.reference-assets/csgo-legacy/csgo'
def sha(data):return hashlib.sha256(data).hexdigest()
def sha_stream(stream,limit=None):
    digest=hashlib.sha256()
    while limit is None or limit>0:
        block=stream.read(1024*1024 if limit is None else min(limit,1024*1024))
        if not block:break
        digest.update(block)
        if limit is not None:limit-=len(block)
    if limit is not None:assert limit==0,'Truncated original BSP lump'
    return digest.hexdigest()
def main():
    started=time.perf_counter();report=json.loads((OUT/'inventory.json').read_text())
    with (GAME/'maps/de_dust2.bsp').open('rb') as bsp:
        assert sha_stream(bsp)==report['sourceBspSha256'],'Original BSP changed since extraction'
        bsp.seek(8+40*16);offset,length=struct.unpack('<2I',bsp.read(8));bsp.seek(offset);original_pak_hash=sha_stream(bsp,length)
    with (ROOT/'output/source1/de_dust2/lumps/40-pakfile.bin').open('rb') as pak_source:
        assert sha_stream(pak_source)==original_pak_hash,'Extracted pak differs from original BSP lump40'
    original_prop_manifest=json.loads((ROOT/'.reference-assets/source-exports/dust2/props-manifest.json').read_text())
    with (ROOT/'.reference-assets/source-exports/dust2/props.glb').open('rb') as prop_stream:
        prop_sha=sha_stream(prop_stream);assert prop_sha==original_prop_manifest['glb']['sha256'],'Original props GLB differs from frozen manifest'
    spec=importlib.util.spec_from_file_location('raw_vhv_index',ROOT/'scripts/inventory-source-map.py');module=importlib.util.module_from_spec(spec);sys.modules['raw_vhv_index']=module;spec.loader.exec_module(module)
    index=module.VPKIndex(GAME/'pak01_dir.vpk');mapping=(OUT/report['binary']['mapping']['file']).read_bytes();lighting=(OUT/report['binary']['lighting']['file']).read_bytes()
    assert sha(mapping)==report['binary']['mapping']['sha256'];assert sha(lighting)==report['binary']['lighting']['sha256']
    verified_vertices=0;verified_groups=0;layouts={};equal_instance_checks=0;different_instance_example=None
    with zipfile.ZipFile(ROOT/'output/source1/de_dust2/lumps/40-pakfile.bin') as pak:
        members={n.replace('\\','/').lower():n for n in pak.namelist()}
        def read(name):
            name=name.lower()
            data=pak.read(members[name]) if name in members else (GAME/name).read_bytes() if (GAME/name).is_file() else index.read(name)
            assert sha(data)==report['dependencies'][name]['sha256'];return data
        for model in report['models']:
            name=model['path'];mdl=read(name);vvd=read(name[:-4]+'.vvd');vtx=read(name[:-4]+'.dx90.vtx')
            assert mdl[:4]==b'IDST' and struct.unpack_from('<I',mdl,4)[0]==49
            assert vvd[:4]==b'IDSV' and struct.unpack_from('<I',vvd,4)[0]==4
            assert struct.unpack_from('<I',vtx)[0]==7
            assert struct.unpack_from('<I',mdl,8)[0]==struct.unpack_from('<I',vvd,8)[0]==struct.unpack_from('<I',vtx,16)[0]==model['checksum']
            body_count,body_offset=struct.unpack_from('<2I',mdl,232);vtx_body_count,vtx_body_offset=struct.unpack_from('<2I',vtx,28);assert body_count==vtx_body_count
            raw_count=struct.unpack_from('<I',vvd,16)[0];fixup_count,fixup_offset,vertex_offset=struct.unpack_from('<3I',vvd,48)
            raw_ids=[]
            if fixup_count:
                for _,first,count in struct.iter_unpack('<3I',vvd[fixup_offset:fixup_offset+12*fixup_count]):raw_ids.extend(range(first,first+count))
            else:raw_ids=list(range(raw_count))
            assert len(raw_ids)==raw_count and vertex_offset+48*raw_count<=len(vvd)
            # Hardware VTX CSGO files may have the extra topology fields. The
            # group's vertex address and original IDs, not the parser's object
            # graph, must reproduce every saved source-index pair.
            accepted=None
            for stride in (25,33):
                try:
                    for group in model['groups']:
                        bp=body_offset+group['body']*16;model_count=struct.unpack_from('<I',mdl,bp+4)[0];assert group['model']<model_count
                        m=bp+struct.unpack_from('<I',mdl,bp+12)[0]+group['model']*148
                        mesh_count,mesh_relative,model_count,model_bytes=struct.unpack_from('<4I',mdl,m+72)
                        assert model_bytes%48==0 and group['mesh']<mesh_count
                        mesh=m+mesh_relative+group['mesh']*116;mesh_count,mesh_vertex_start=struct.unpack_from('<2I',mdl,mesh+8)
                        vb=vtx_body_offset+group['body']*8;vm=vb+struct.unpack_from('<I',vtx,vb+4)[0]+group['model']*8
                        vl=vm+struct.unpack_from('<I',vtx,vm+4)[0]+group['lod']*12
                        vmesh=vl+struct.unpack_from('<I',vtx,vl+4)[0]+group['mesh']*9
                        group_count,group_relative=struct.unpack_from('<2I',vtx,vmesh);assert group['stripGroup']<group_count
                        vg=vmesh+group_relative+group['stripGroup']*stride
                        count,vertex_relative,index_count=struct.unpack_from('<3I',vtx,vg)
                        assert count==group['vertexCount'] and index_count==group['indicesCount']
                        vertex_start=vg+vertex_relative;assert vertex_start+9*count<=len(vtx)
                        expected=mapping[group['mappingOffset']:group['mappingOffset']+group['mappingBytes']]
                        assert sha(expected)==group['mappingSha256'] and len(expected)==count*8
                        for i,(packed_id,file_id) in enumerate(struct.iter_unpack('<2I',expected)):
                            original_mesh_id=struct.unpack_from('<H',vtx,vertex_start+9*i+4)[0]
                            assert original_mesh_id<mesh_count
                            derived=model_bytes//48+mesh_vertex_start+original_mesh_id
                            assert derived==packed_id and file_id==raw_ids[derived]
                    accepted=stride;break
                except (AssertionError,struct.error,IndexError):continue
            assert accepted is not None,'Independent original vertex mapping mismatch: '+name
            layouts[str(accepted)]=layouts.get(str(accepted),0)+1
            verified_groups+=len(model['groups']);verified_vertices+=sum(g['vertexCount'] for g in model['groups'])
        by_model={}
        for instance in report['instances']:
            raw=pak.read(members[instance['vhv']]);assert sha(raw)==instance['vhvSha256'];assert len(raw)==instance['vhvBytes']
            version,checksum,flags,size,count,mesh_count=struct.unpack_from('<6I',raw)
            assert (version,flags,size)==(2,2,12);assert checksum==report['models'][instance['modelIndex']]['checksum'];assert mesh_count==len(instance['groups'])
            accumulated=0;digest=hashlib.sha256()
            for i,group in enumerate(instance['groups']):
                lod,n,offset=struct.unpack_from('<3I',raw,40+28*i);actual=lighting[group['lightingOffset']:group['lightingOffset']+group['lightingBytes']]
                assert lod==group['lod'] and n==group['vertexCount'];assert actual==raw[offset:offset+n*12];accumulated+=n;digest.update(actual)
            assert accumulated==count and digest.hexdigest()==instance['lightingPayloadSha256']
            name=instance['model'];previous=by_model.setdefault(name,instance)
            if previous is not instance:
                equal_instance_checks+=1
                if previous['lightingPayloadSha256']!=instance['lightingPayloadSha256'] and different_instance_example is None:
                    different_instance_example={'model':name,'instanceA':previous['index'],'instanceB':instance['index'],
                        'sameSourceModelIndex':instance['modelIndex'],'payloadA':previous['lightingPayloadSha256'],'payloadB':instance['lightingPayloadSha256']}
    result={'status':'independent_raw_source_mapping_and_instance_payload_readback_passed','sourceIOImported':False,'sceneOrOriginalGLBModified':False,
        'models':len(report['models']),'instances':len(report['instances']),'originalBspSha256':report['sourceBspSha256'],
        'originalPakLumpSha256':original_pak_hash,'unchangedPropsGLBSha256':prop_sha,'verifiedMappingGroups':verified_groups,'verifiedMappingVertices':verified_vertices,
        'verifiedInstanceLightingVertices':report['summary']['hardwareLightingRecordsAcrossInstances'],'selectedVtxStripGroupHeaderStrides':layouts,
        'sameModelInstanceComparisons':equal_instance_checks,'differentInstanceEvidence':different_instance_example,
        'binary':report['binary'],'seconds':time.perf_counter()-started,'colorEncodingConfirmed':False,
        'limitations':['No interpretation of CSGO three-direction lighting bytes or fourth-byte data','Original props.glb has no source vertex ID attribute and is not modified']}
    (OUT/'verification.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
if __name__=='__main__':main()
