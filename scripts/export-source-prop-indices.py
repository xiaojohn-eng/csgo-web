"""New private props GLB from exact original VVD/VTX, with source IDs.

Keeps original image bytes, material records, scene graph and every node TRS.
Does not modify props.glb or infer a mapping from positions/nearest neighbours.
Factory-startup Blender supplies pinned SourceIO/NumPy; no scene import occurs.
"""
from pathlib import Path
from collections import Counter
import hashlib
import importlib.util
import json
import struct
import sys
import zipfile

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'.reference-assets/source-exports/dust2'
OUT=ROOT/'.reference-assets/source-exports/dust2-vhv/geometry'
GAME=ROOT/'.reference-assets/csgo-legacy/csgo'
def sha(data):return hashlib.sha256(data).hexdigest()
def module(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(spec);sys.modules[name]=m;spec.loader.exec_module(m);return m

def main():
    module('prop_ids_completion','inventory-source-items.py').initialize()
    import bpy
    import numpy as np
    from SourceIO.library.utils import MemoryBuffer
    from SourceIO.library.models.mdl.v49 import MdlV49
    from SourceIO.library.models.vvd import Vvd
    from SourceIO.library.models.vtx import open_vtx
    from SourceIO.library.models.mdl.structs.header import StudioHDRFlags
    assert bpy.app.background and '--factory-startup' in sys.argv
    OUT.mkdir(exist_ok=True)
    vhv=json.loads((OUT.parent/'inventory.json').read_text());raw_map=(OUT.parent/'source-vertex-map.u32').read_bytes()
    assert sha(raw_map)==vhv['binary']['mapping']['sha256']
    original=(SOURCE/'props.glb').read_bytes();frozen=json.loads((SOURCE/'props-manifest.json').read_text())
    assert sha(original)==frozen['glb']['sha256']
    json_size=struct.unpack_from('<I',original,12)[0];doc=json.loads(original[20:20+json_size]);old_doc=json.loads(json.dumps(doc))
    assert not doc.get('skins') and not doc.get('animations') and not doc.get('extensionsUsed')
    bin_start=28+json_size;old_bin=memoryview(original)[bin_start:bin_start+doc['buffers'][0]['byteLength']]
    old_views=doc['bufferViews'];doc['bufferViews']=[];doc['accessors']=[];binary=bytearray();images=[]
    def view(raw):
        binary.extend(b'\0'*((-len(binary))%4));offset=len(binary);binary.extend(raw)
        index=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(raw)});return index
    # Only images need their old buffer bytes. Geometry is rebuilt from source,
    # avoiding a second unused copy of the old reordered vertex buffers.
    for image in doc.get('images',[]):
        old=old_views[image['bufferView']];assert old['buffer']==0
        data=old_bin[old.get('byteOffset',0):old.get('byteOffset',0)+old['byteLength']]
        image['bufferView']=view(data);images.append({'name':image.get('name'),'bytes':len(data),'sha256':sha(data)})
    def accessor(array,kind,component=5126):
        a=np.ascontiguousarray(array,dtype='<f4' if component==5126 else '<u4');raw=a.tobytes();index=len(doc['accessors'])
        record={'bufferView':view(raw),'componentType':component,'count':len(a),'type':kind}
        if kind=='VEC3':record.update(min=a.min(axis=0).tolist(),max=a.max(axis=0).tolist())
        doc['accessors'].append(record);return index,sha(raw)
    parents={child:i for i,node in enumerate(doc['nodes']) for child in node.get('children',[])};identities={}
    for i,node in enumerate(doc['nodes']):
        if 'mesh' not in node:continue
        anchor=doc['nodes'][parents[i]];extra=anchor['extras'];identity=(extra['sourceModel'],extra['sourceSkin'],int(node['name'].rsplit('_',1)[1]))
        assert node['mesh'] not in identities or identities[node['mesh']]==identity
        identities[node['mesh']]=identity
    assert set(identities)==set(range(len(doc['meshes'])))
    index=module('prop_ids_raw_index','inventory-source-map.py').VPKIndex(GAME/'pak01_dir.vpk')
    source_models={m['path']:m for m in vhv['models']};remaining=Counter(name for name,_,_ in identities.values());cache={};records=[];dependencies={}
    material_names={m['name']:i for i,m in enumerate(doc['materials'])};source_materials={m['source'].lower():m['name'] for m in frozen['materials']}
    fallbacks={(item['model'],item['requested']):item['effective'] for item in frozen.get('skinFallbacks',[])}
    with zipfile.ZipFile(ROOT/'output/source1/de_dust2/lumps/40-pakfile.bin') as pak:
        members={p.replace('\\','/').lower():p for p in pak.namelist()}
        def exists(path):return path in members or (GAME/path).is_file() or path in index.entries
        def read(path):
            path=path.replace('\\','/').lower()
            data=pak.read(members[path]) if path in members else (GAME/path).read_bytes() if (GAME/path).is_file() else index.read(path)
            assert sha(data)==vhv['dependencies'][path]['sha256'];dependencies[path]=vhv['dependencies'][path];return data
        for mesh_id,(name,skin,part) in sorted(identities.items()):
            if name not in cache:
                raw=read(name);mdl=MdlV49.from_buffer(MemoryBuffer(raw));vvd=Vvd.from_buffer(MemoryBuffer(read(name[:-4]+'.vvd')));vtx=open_vtx(MemoryBuffer(read(name[:-4]+'.dx90.vtx')))
                assert mdl.header.flags&StudioHDRFlags.STATIC_PROP and vtx.header.lod_count==1
                selected=[(bi,0,body.models[0],vbody.models[0]) for bi,(body,vbody) in enumerate(zip(mdl.body_parts,vtx.body_parts)) if body.models and body.models[0].vertex_count]
                cache[name]=(raw,mdl,vvd,vtx,selected)
            raw,mdl,vvd,vtx,selected=cache[name];bi,mi,model,vmodel=selected[part];sm=source_models[name]
            family=skin if 0<=skin<mdl.header.skin_family_count else fallbacks[(name,skin)]
            assert 0<=family<mdl.header.skin_family_count
            refs=mdl.header.skin_reference_count;row=struct.unpack_from('<'+'H'*refs,raw,mdl.header.skin_family_offset+2*family*refs)
            old_mesh=doc['meshes'][mesh_id];old_triangles=sum(old_doc['accessors'][p['indices']]['count']//3 for p in old_mesh['primitives'])
            primitives=[];flat_offset=0;triangles=0
            for group_id,group in enumerate(sm['groups']):
                count=group['vertexCount'];group_base=flat_offset;flat_offset+=count
                if (group['body'],group['model'])!=(bi,mi):continue
                assert group['lod']==0
                mesh=model.meshes[group['mesh']];hw=vmodel.model_lods[0].meshes[group['mesh']].strip_groups[group['stripGroup']]
                assert len(hw.vertexes)==count
                pairs=np.frombuffer(raw_map,dtype='<u4',count=count*2,offset=group['mappingOffset']).reshape(-1,2)
                original_ids=hw.vertexes['original_mesh_vertex_index'].reshape(-1).astype('<u4')
                assert np.array_equal(pairs[:,0],model.vertex_offset+mesh.vertex_index_start+original_ids),(name,group_id)
                vertices=vvd.lod_data[0][pairs[:,0]]
                positions=np.array(vertices['vertex'],np.float32)[:,[0,2,1]];positions[:,2]*=-1
                normals=np.array(vertices['normal'],np.float32)[:,[0,2,1]];normals[:,2]*=-1
                # Preserve original triangle corners and winding conversion, never
                # collapse equal positions or UV seams to one source index.
                assert len(hw.indices)%3==0
                indices=np.asarray(hw.indices,dtype='<u4').reshape(-1,3)[:,::-1].copy()
                assert int(indices.max())<count
                original_name=mdl.materials[row[mesh.material_index]].name
                search=[original_name]+[str(p).replace('\\','/').rstrip('/')+'/'+original_name for p in mdl.materials_paths]
                mat_path=next((s.lower().lstrip('/') for s in search if exists('materials/'+s.lower().lstrip('/')+'.vmt')),original_name.lower())
                material=material_names[source_materials[mat_path]]
                values={'POSITION':(positions,'VEC3'),'NORMAL':(normals,'VEC3'),'TEXCOORD_0':(vertices['uv'],'VEC2'),
                    '_SOURCE_VVD':(pairs[:,1],'SCALAR'),'_SOURCE_VHV':(np.arange(group_base,group_base+count,dtype='<u4'),'SCALAR')}
                assert max(int(pairs[:,1].max()),group_base+count)<2**24,'Float source IDs must remain exact'
                if vvd.extra_data:
                    for number,extra in enumerate(vvd.extra_data.values(),1):values['TEXCOORD_'+str(number)]=(extra.reshape(-1,2)[pairs[:,0]],'VEC2')
                attrs={};hashes={}
                for key,(value,kind) in values.items():attrs[key],hashes[key]=accessor(value,kind)
                index_accessor,index_sha=accessor(indices.reshape(-1),'SCALAR',5125)
                extras={'sourceVhvModelIndex':sm['index'],'sourceVhvGroupIndex':group_id,'sourceHardwareVertexBase':group_base}
                primitives.append({'attributes':attrs,'indices':index_accessor,'material':material,'mode':4,'extras':extras});triangles+=len(indices)
                records.append({'mesh':mesh_id,'primitive':len(primitives)-1,'model':name,'modelIndex':sm['index'],'part':part,'skin':skin,'effectiveSkin':family,'sourceGroupIndex':group_id,
                    'vertices':count,'triangles':len(indices),'hardwareVertexBase':group_base,'material':material,'attributeSha256':hashes,'indexSha256':index_sha})
            assert triangles==old_triangles,(name,triangles,old_triangles)
            old_mesh['primitives']=primitives
            remaining[name]-=1
            if not remaining[name]:del cache[name]
            if mesh_id%100==0:print('SOURCE_PROP_IDS',mesh_id,len(doc['meshes']),flush=True)
    # All original nodes/transforms/material values and encoded image bytes are
    # preserved; source instance IDs remain encoded in static_prop_<index> names.
    assert doc['nodes']==old_doc['nodes'] and doc['materials']==old_doc['materials']
    doc['buffers']=[{'byteLength':len(binary)}]
    doc.setdefault('asset',{})['generator']='Private exact original VVD/VTX source-index export; no lighting shader installed'
    data=json.dumps(doc,separators=(',',':'),ensure_ascii=False).encode();data+=b' '*((-len(data))%4);binary.extend(b'\0'*((-len(binary))%4))
    target=OUT/'props-source-index.glb';temporary=target.with_suffix('.glb.tmp')
    with temporary.open('wb') as stream:
        stream.write(struct.pack('<4sII',b'glTF',2,28+len(data)+len(binary)));stream.write(struct.pack('<2I',len(data),0x4e4f534a));stream.write(data)
        stream.write(struct.pack('<2I',len(binary),0x004e4942));stream.write(binary)
    temporary.replace(target)
    digest=hashlib.sha256()
    with target.open('rb') as stream:
        while chunk:=stream.read(1024*1024):digest.update(chunk)
    report={'status':'candidate_exported_readback_required','file':target.name,'bytes':target.stat().st_size,'sha256':digest.hexdigest(),
        'originalGLBSha256':sha(original),'originalGLBModified':False,'nodesAndTransformsExact':True,'materialsExact':True,'images':images,
        'meshes':len(doc['meshes']),'primitives':len(records),'hardwareVertices':sum(r['vertices'] for r in records),'triangles':sum(r['triangles'] for r in records),
        'attributes':{'_SOURCE_VVD':'exact raw VVD vertex ID, FLOAT scalar integer <2^24','_SOURCE_VHV':'exact model-flat hardware vertex ID, FLOAT scalar integer <2^24'},
        'join':'instance.groups[0].lightingOffset + 12 * _SOURCE_VHV; preserve instance identity even with shared geometry',
        'records':records,'dependencies':dependencies,'gpuVerified':False,'lightingShaderApplied':False,
        'limitations':['Source Phong/PBR differences remain in preserved original candidate materials','Only observed static LOD0 triangle-list models','No closest-point/corner inference; geometry was rebuilt from exact original topology']}
    (OUT/'manifest.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k not in ('records','dependencies','images')},indent=2))
if __name__=='__main__':main()
