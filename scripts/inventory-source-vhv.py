"""Read original Dust2 VHV + exact MDL/VVD/VTX strip-group vertex mapping.

Factory-startup background Blender supplies pinned SourceIO parsers only; no
scene import/register, raster generation, original GLB edit or game integration.
Raw 12-byte lighting records remain uninterpreted pending CSGO shader evidence.
"""
from __future__ import annotations
from collections import Counter,defaultdict
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import sys
import time
import traceback
import zipfile

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.reference-assets/source-exports/dust2-vhv'
GAME=ROOT/'.reference-assets/csgo-legacy/csgo'
PAK=ROOT/'output/source1/de_dust2/lumps/40-pakfile.bin'
def sha(data):return hashlib.sha256(data).hexdigest()
def module(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file)
    result=importlib.util.module_from_spec(spec);sys.modules[name]=result;spec.loader.exec_module(result);return result
def write_json(name,value):
    (OUT/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')

def parse_vhv(data):
    if len(data)<40:raise ValueError('Truncated original VHV header')
    version,checksum,flags,size,count,mesh_count,*reserved=struct.unpack_from('<10I',data)
    if version!=2 or size!=12 or flags!=2:raise ValueError(f'Unreviewed VHV layout: {version}/{flags}/{size}')
    if 40+28*mesh_count>len(data):raise ValueError('VHV mesh table extends outside file')
    if any(reserved):raise ValueError('Unexpected VHV reserved fields')
    meshes=[];last_end=((40+28*mesh_count+511)//512)*512
    if any(data[40+28*mesh_count:last_end]):raise ValueError('Nonzero VHV header padding')
    for i in range(mesh_count):
        lod,n,offset,*reserved=struct.unpack_from('<7I',data,40+28*i)
        if any(reserved) or offset!=last_end or offset+n*size>len(data):raise ValueError('VHV mesh payload span/order mismatch')
        meshes.append({'index':i,'lod':lod,'vertexCount':n,'fileOffset':offset,'bytes':n*size});last_end=offset+n*size
    if sum(m['vertexCount'] for m in meshes)!=count:raise ValueError('VHV total vertex count mismatch')
    if len(data)!=(last_end+511)//512*512 or any(data[last_end:]):raise ValueError('Unexpected VHV end alignment/padding')
    return {'version':version,'checksum':checksum,'vertexFlags':flags,'vertexSize':size,'vertexCount':count,'meshCount':mesh_count,'meshes':meshes}

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--limit',type=int,default=0)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    if args.limit<0:raise ValueError('Invalid limit')
    inv=module('source_vhv_items','inventory-source-items.py');context=inv.initialize()
    if subprocess.check_output(['git','-C',str(ROOT/'.tools/SourceIO'),'status','--porcelain','--untracked-files=no'],text=True).strip():raise ValueError('SourceIO tracked source modified')
    raw_index=module('source_vhv_map','inventory-source-map.py').VPKIndex(GAME/'pak01_dir.vpk')
    import numpy as np
    from SourceIO.library.utils import MemoryBuffer
    from SourceIO.library.models.mdl.v49 import MdlV49
    from SourceIO.library.models.vvd import Vvd
    from SourceIO.library.models.vtx import open_vtx
    instances=json.loads((ROOT/'.reference-assets/source-exports/dust2/prop-instances.json').read_text())
    source_inventory=json.loads((ROOT/'.reference-assets/source-exports/dust2/source-metadata/inventory.json').read_text())
    selected=instances[:args.limit] if args.limit else instances
    OUT.mkdir(exist_ok=True);started=time.perf_counter()
    report={'status':'running','source':context,'sourceBspSha256':source_inventory['bspSha256'],
        'sourceInstanceCount':len(instances),'selectedInstances':len(selected),'originalPropsGLBModified':False,
        'sceneObjectsCreated':0,'sourceFilesModified':False,'lightingEncoding':'three original 4-byte groups per hardware vertex, no color-space/basis interpretation applied',
        'sourceIndexSemantics':'uint32 little endian pairs [packed VVD LOD0 vertex index, raw VVD file vertex index]; hardware strip-group order',
        'models':[],'instances':[],'dependencies':{},'errors':[]}
    model_cache={};alpha_hist=[Counter() for _ in range(3)];channel_min=[255]*12;channel_max=[0]*12
    payload_hash_by_model=defaultdict(set);mapping_count=0;light_count=0
    suffix='-sample' if args.limit else ''
    map_path=OUT/('source-vertex-map'+suffix+'.u32.tmp');lighting_path=OUT/('instance-lighting'+suffix+'.bin.tmp')
    with zipfile.ZipFile(PAK) as pak,map_path.open('wb') as map_stream,lighting_path.open('wb') as light_stream:
        members={n.replace('\\','/').lower():n for n in pak.namelist()}
        vhv_names={n for n in members if n.endswith('.vhv')}
        assert vhv_names=={f'sp_hdr_{i}.vhv' for i in range(len(instances))},'VHV/instance one-to-one set mismatch'
        report['embeddedVHVCount']=len(vhv_names);report['embeddedVHVBytes']=sum(pak.getinfo(members[n]).file_size for n in vhv_names)
        def read(name):
            name=name.replace('\\','/').lower()
            if name in members:
                data=pak.read(members[name]);container='BSP pak';crc=pak.getinfo(members[name]).CRC
            elif (GAME/name).is_file():data=(GAME/name).read_bytes();container='loose';crc=None
            else:data=raw_index.read(name);container='pak01';crc=raw_index.entries[name]['crc32']
            report['dependencies'][name]={'container':container,'bytes':len(data),'sha256':sha(data),'crc32':f'{crc:08x}' if crc is not None else None}
            return data
        def mapping(name):
            nonlocal mapping_count
            if name in model_cache:return model_cache[name]
            mdl_bytes=read(name);vvd_bytes=read(name.removesuffix('.mdl')+'.vvd');vtx_bytes=read(name.removesuffix('.mdl')+'.dx90.vtx')
            mdl=MdlV49.from_buffer(MemoryBuffer(mdl_bytes));vvd=Vvd.from_buffer(MemoryBuffer(vvd_bytes));vtx=open_vtx(MemoryBuffer(vtx_bytes))
            checksum=struct.unpack_from('<I',mdl_bytes,8)[0]
            assert checksum==vvd.header.checksum==vtx.header.checksum,'MDL/VVD/VTX checksum mismatch: '+name
            h=vvd.header;raw_vertex_count=h.lod_vertex_count[0]
            raw_ids=np.arange(raw_vertex_count,dtype='<u4')
            if h.fixup_count:
                fixups=struct.iter_unpack('<3I',vvd_bytes[h.fixup_table_offset:h.fixup_table_offset+h.fixup_count*12])
                spans=[]
                for lod,index,count in fixups:
                    assert lod<h.lod_count and index+count<=raw_vertex_count
                    spans.append(np.arange(index,index+count,dtype='<u4'))
                raw_ids=np.concatenate(spans);assert len(raw_ids)==raw_vertex_count
            raw_vertices=np.frombuffer(vvd_bytes,dtype=Vvd.vertex_t,count=raw_vertex_count,offset=h.vertex_data_offset)
            assert np.array_equal(vvd.lod_data[0],raw_vertices[raw_ids]),'Independent VVD fixup index readback mismatch'
            assert np.isfinite(raw_vertices['vertex']).all() and np.isfinite(raw_vertices['normal']).all()
            model_report={'index':len(report['models']),'path':name,'checksum':checksum,'vvdLodVertexCounts':list(h.lod_vertex_count[:h.lod_count]),
                'vvdFixups':h.fixup_count,'vtxLODs':vtx.header.lod_count,'groups':[]}
            assert len(mdl.body_parts)==len(vtx.body_parts)
            for body_id,(body,vtx_body) in enumerate(zip(mdl.body_parts,vtx.body_parts)):
                assert len(body.models)==len(vtx_body.models)
                for model_id,(model,vtx_model) in enumerate(zip(body.models,vtx_body.models)):
                    assert len(vtx_model.model_lods)==vtx.header.lod_count
                    for lod_id,lod in enumerate(vtx_model.model_lods):
                        assert len(model.meshes)==len(lod.meshes)
                        for mesh_id,(mesh,vtx_mesh) in enumerate(zip(model.meshes,lod.meshes)):
                            for group_id,group in enumerate(vtx_mesh.strip_groups):
                                mesh_ids=group.vertexes['original_mesh_vertex_index'].reshape(-1).astype('<u4')
                                if len(mesh_ids):assert int(mesh_ids.max())<mesh.vertex_count
                                packed=model.vertex_offset+mesh.vertex_index_start+mesh_ids
                                if len(packed):assert int(packed.max())<raw_vertex_count
                                index_pairs=np.column_stack((packed,raw_ids[packed])).astype('<u4')
                                raw_map=index_pairs.tobytes();offset=map_stream.tell();map_stream.write(raw_map);mapping_count+=len(index_pairs)
                                model_report['groups'].append({'body':body_id,'model':model_id,'lod':lod_id,'mesh':mesh_id,'stripGroup':group_id,
                                    'materialReference':mesh.material_index,'modelVertexOffset':model.vertex_offset,'meshVertexOffset':mesh.vertex_index_start,
                                    'vertexCount':len(mesh_ids),'indicesCount':len(group.indices),'mappingOffset':offset,'mappingBytes':len(raw_map),
                                    'mappingSha256':sha(raw_map),'packedSourceMin':int(packed.min()) if len(packed) else None,'packedSourceMax':int(packed.max()) if len(packed) else None})
            model_cache[name]=model_report;report['models'].append(model_report);return model_report
        try:
            for instance in selected:
                index=instance['index'];name=f'sp_hdr_{index}.vhv';raw=pak.read(members[name]);header=parse_vhv(raw)
                model=mapping(instance['model']);assert header['checksum']==model['checksum'],'VHV/model checksum mismatch'
                assert len(header['meshes'])==len(model['groups']),f"VHV/VTX group count mismatch {index}/{instance['model']}: {len(header['meshes'])}/{len(model['groups'])}"
                groups=[];payload=hashlib.sha256()
                for mh,mg in zip(header['meshes'],model['groups']):
                    assert (mh['lod'],mh['vertexCount'])==(mg['lod'],mg['vertexCount']),f'VHV/VTX lod/count mismatch instance {index}'
                    data=raw[mh['fileOffset']:mh['fileOffset']+mh['bytes']];offset=light_stream.tell();light_stream.write(data);payload.update(data);light_count+=mh['vertexCount']
                    array=np.frombuffer(data,np.uint8).reshape(-1,12)
                    if len(array):
                        channel_min=[min(a,int(b)) for a,b in zip(channel_min,array.min(axis=0))];channel_max=[max(a,int(b)) for a,b in zip(channel_max,array.max(axis=0))]
                        for i in range(3):
                            values,counts=np.unique(array[:,i*4+3],return_counts=True);alpha_hist[i].update({int(v):int(c) for v,c in zip(values,counts)})
                    groups.append({'sourceGroup':mh['index'],'lod':mh['lod'],'vertexCount':mh['vertexCount'],'lightingOffset':offset,'lightingBytes':len(data)})
                digest=payload.hexdigest();payload_hash_by_model[instance['model']].add(digest)
                report['instances'].append({'index':index,'modelIndex':model['index'],'model':instance['model'],'skin':instance['skin'],
                    'vhv':name,'vhvBytes':len(raw),'vhvSha256':sha(raw),'crc32':f'{pak.getinfo(members[name]).CRC:08x}',
                    'header':{k:v for k,v in header.items() if k!='meshes'},'lightingPayloadSha256':digest,'groups':groups})
                if len(report['instances'])%100==0:print('SOURCE_VHV_PROGRESS',len(report['instances']),'models',len(report['models']),flush=True)
        except Exception as error:
            report['status']='failed';report['errors'].append({'type':type(error).__name__,'message':str(error),'traceback':traceback.format_exc()});write_json('inventory'+suffix+'.json',report);raise
    final_map=map_path.with_suffix('');final_light=lighting_path.with_suffix('');map_path.replace(final_map);lighting_path.replace(final_light)
    report['status']='raw_lighting_and_source_vertex_mapping_verified_color_semantics_pending'
    report['summary']={'instances':len(report['instances']),'uniqueModels':len(report['models']),'hardwareVerticesMappedPerUniqueModel':mapping_count,
        'hardwareLightingRecordsAcrossInstances':light_count,'lodHistogram':dict(Counter(str(g['lod']) for i in report['instances'] for g in i['groups'])),
        'channelMin':channel_min,'channelMax':channel_max,'fourthByteHistograms':[dict(sorted(c.items())) for c in alpha_hist],
        'modelsWithDifferentInstanceLighting':sum(len(values)>1 for values in payload_hash_by_model.values())}
    report['binary']={'mapping':{'file':final_map.name,'bytes':final_map.stat().st_size,'sha256':sha(final_map.read_bytes()),'recordStride':8},
        'lighting':{'file':final_light.name,'bytes':final_light.stat().st_size,'sha256':sha(final_light.read_bytes()),'recordStride':12}}
    report['elapsedSeconds']=time.perf_counter()-started
    write_json('inventory'+suffix+'.json',report);print(json.dumps({'status':report['status'],'summary':report['summary'],'binary':report['binary'],'seconds':report['elapsedSeconds']},indent=2),flush=True)

if __name__=='__main__':main()
