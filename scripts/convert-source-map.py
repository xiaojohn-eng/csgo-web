"""Isolated Source 1 map visual sample. Run in factory-startup Blender.

World and real static-prop meshes are separate exports. Original source files,
game/public and shared weapon conversion code remain untouched.
"""
from __future__ import annotations
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import sys
import time
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
PIN = 'cfc2591d096628a35f570aa830ab75cc8665108b'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--download-complete',action='store_true',required=True)
parser.add_argument('--layer',choices=['world','props'],default='world')
parser.add_argument('--props-limit',type=int,default=0,help='0 means all actual sprp instances; positive creates an explicitly partial sample')
parser.add_argument('--finalize-only',action='store_true',help='Reapply original alphatest metadata to a completed GLB without reading game assets')
parser.add_argument('--repair-topology-only',action='store_true',help='Restore any exporter-removed prop triangles from original MDL/VVD/VTX data')
parser.add_argument('--meters-per-unit',type=float,default=.0254)
parser.add_argument('--output',type=Path,default=ROOT/'.reference-assets/source-exports/dust2')
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
OUT = args.output.resolve(); GAME=ROOT/'.reference-assets/csgo-legacy/csgo'
if not OUT.is_relative_to(ROOT/'.reference-assets/source-exports'): raise ValueError('Use an isolated source-exports directory')
if args.meters_per_unit <= 0: raise ValueError('Scale must be positive')
OUT.mkdir(parents=True,exist_ok=True)
started=time.perf_counter()
manifest=dict(status='running',layer=args.layer,sourceioCommit=PIN,sourceMap='de_dust2',
    sourceUnitsPreservedInMeshes=True,outerMetersPerUnit=args.meters_per_unit,
    browserTransform=f'Source (x,y,z) -> ({args.meters_per_unit}*x, {args.meters_per_unit}*z, -{args.meters_per_unit}*y)',
    scaleStatus='Explicit preview choice, not yet cross-calibrated against the original running client',
    gamePublicModified=False,materials=[],textures=[],errors=[],unmapped=[],sourceInstances=0,actualMeshInstances=0)
def save(stage):
    manifest['stage']=stage;manifest['elapsedSeconds']=time.perf_counter()-started
    (OUT/f'{args.layer}-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2,default=lambda v:v.tolist() if hasattr(v,'tolist') else str(v))+'\n')
    print('SOURCE_MAP_STAGE',stage,flush=True)

def finalize_glb(target,records):
    """Blender 5.2 DITHERED exports BLEND; Source alphatest requires MASK."""
    data=target.read_bytes();length,kind=struct.unpack_from('<II',data,12)
    if kind!=0x4e4f534a:raise ValueError('Invalid GLB JSON')
    doc=json.loads(data[20:20+length]);by_name={r['name']:r for r in records};changed=[]
    for material in doc.get('materials',[]):
        source=by_name.get(material['name'],{})
        if source.get('alphaTest'):
            material['alphaMode']='MASK';material['alphaCutoff']=source['alphaCutoff'];changed.append(material['name'])
    if changed:
        encoded=json.dumps(doc,separators=(',',':'),ensure_ascii=False).encode();encoded+=b' '*((-len(encoded))%4)
        tail=data[20+length:]
        target.write_bytes(struct.pack('<4sII',b'glTF',2,20+len(encoded)+len(tail))+struct.pack('<II',len(encoded),kind)+encoded+tail)
    return changed

def restore_source_topology(target,cm,manifest):
    """Restore exporter-deleted Source faces without re-encoding corner normals.

    The original VVD normal, rather than Blender's invalid-topology corner-normal
    getter, is the source of truth. Keep the exporter materials/instances/images.
    """
    import numpy as np
    from SourceIO.library.utils import TinyPath
    from SourceIO.library.models.mdl.v49 import MdlV49
    from SourceIO.library.models.vtx import open_vtx
    from SourceIO.library.models.vvd import Vvd
    from SourceIO.library.models.mdl.structs.header import StudioHDRFlags
    from SourceIO.library.utils.path_utilities import find_vtx_cm,collect_full_material_names
    from SourceIO.library.utils.common import get_slice
    from SourceIO.blender_bindings.models.common import merge_meshes
    data=target.read_bytes();json_length=struct.unpack_from('<I',data,12)[0]
    doc=json.loads(data[20:20+json_length]);start=20+json_length
    old_bin_length=doc['buffers'][0]['byteLength'];binary=bytearray(data[start+8:start+8+old_bin_length])
    parent={c:i for i,n in enumerate(doc['nodes']) for c in n.get('children',[])}
    identities={}
    for i,node in enumerate(doc['nodes']):
        if 'mesh' not in node:continue
        anchor=doc['nodes'][parent[i]];extra=anchor.get('extras',{})
        model=extra['sourceModel'];skin=extra['sourceSkin'];part=int(node['name'].rsplit('_',1)[1])
        identity=(model,skin,part)
        if node['mesh'] in identities and identities[node['mesh']]!=identity:raise ValueError('Shared mesh has conflicting source identity')
        identities[node['mesh']]=identity
    cache={};repairs=[];previous={r['meshId']:r for r in manifest.get('sourceTopologyRestored',[])}
    material_lookup={r['source'].lower():r['name'] for r in manifest['materials']}
    gltf_material_lookup={m['name']:i for i,m in enumerate(doc['materials'])}
    def append_accessor(array,kind,component):
        array=np.ascontiguousarray(array,dtype='<f4' if component==5126 else '<u4')
        binary.extend(b'\0'*((-len(binary))%4));offset=len(binary);raw=array.tobytes();binary.extend(raw)
        view=len(doc['bufferViews']);doc['bufferViews'].append(dict(buffer=0,byteOffset=offset,byteLength=len(raw)))
        accessor=dict(bufferView=view,componentType=component,count=len(array),type=kind)
        if kind=='VEC3':accessor.update(min=array.min(axis=0).tolist(),max=array.max(axis=0).tolist())
        index=len(doc['accessors']);doc['accessors'].append(accessor);return index
    for mesh_id,(name,requested_skin,part) in identities.items():
        if name not in cache:
            path=TinyPath(name);buf=cm.find_file(path);raw=buf.read();buf.seek(0)
            mdl=MdlV49.from_buffer(buf);vtx=open_vtx(find_vtx_cm(path,cm));vvd=Vvd.from_buffer(cm.find_file(path.with_suffix('.vvd')))
            selected=[(body.models[0],vtx_body.models[0]) for body,vtx_body in zip(mdl.body_parts,vtx.body_parts)
                      if body.models and body.models[0].vertex_count]
            cache[name]=(mdl,vtx,vvd,selected,raw)
        mdl,vtx,vvd,selected,raw=cache[name];model,vtx_model=selected[part]
        vertex_ids,indices,material_indices=merge_meshes(model,vtx_model.model_lods[0])
        old=doc['meshes'][mesh_id];before=sum(doc['accessors'][p['indices']]['count']//3 for p in old['primitives'])
        indices=np.flip(np.asarray(indices,np.uint32)).reshape(-1,3);count=len(indices)
        if count==before and mesh_id not in previous:continue
        if not mdl.header.flags&StudioHDRFlags.STATIC_PROP:raise ValueError('Static-topology repair needs separate skin evaluation: '+name)
        if count<before:raise ValueError('Exporter added source triangles unexpectedly')
        vertices=get_slice(vvd.lod_data[0],model.vertex_offset,model.vertex_count)[vertex_ids]
        positions=np.array(vertices['vertex'],np.float32)[:,[0,2,1]];positions[:,2]*=-1
        normals=np.array(vertices['normal'],np.float32)[:,[0,2,1]];normals[:,2]*=-1
        normal_error=float(np.max(np.abs(np.linalg.norm(normals,axis=1)-1)))
        if normal_error>1e-4:raise ValueError('Original VVD normal not unit: '+name)
        expected={'POSITION':positions,'NORMAL':normals,'TEXCOORD_0':np.array(vertices['uv'],np.float32)}
        hashes={key:hashlib.sha256(np.ascontiguousarray(value,dtype='<f4').tobytes()).hexdigest() for key,value in expected.items()}
        if count==before:
            for primitive in old['primitives']:
                for key,values in expected.items():
                    accessor=doc['accessors'][primitive['attributes'][key]];view=doc['bufferViews'][accessor['bufferView']]
                    offset=view.get('byteOffset',0)+accessor.get('byteOffset',0)
                    actual=np.frombuffer(binary,dtype='<f4',count=values.size,offset=offset).reshape(values.shape)
                    if not np.array_equal(actual,values):raise ValueError('Original VVD/VTX attribute changed: '+name+'/'+key)
            item=previous[mesh_id].copy();item.update(attributeSHA256=hashes,originalVvdReadbackExact=True)
            repairs.append(item);continue
        attributes={'POSITION':append_accessor(positions,'VEC3',5126),'NORMAL':append_accessor(normals,'VEC3',5126),
                    'TEXCOORD_0':append_accessor(np.array(vertices['uv'],np.float32),'VEC2',5126)}
        if vvd.extra_data:
            for number,extra in enumerate(vvd.extra_data.values(),1):
                uv=get_slice(extra.reshape(-1,2),model.vertex_offset,model.vertex_count)[vertex_ids]
                attributes['TEXCOORD_'+str(number)]=append_accessor(uv,'VEC2',5126)
        family=requested_skin if 0<=requested_skin<mdl.header.skin_family_count else 0
        refs=mdl.header.skin_reference_count
        row=struct.unpack_from('<'+'H'*refs,raw,mdl.header.skin_family_offset+2*family*refs)
        full_names=collect_full_material_names([m.name for m in mdl.materials],mdl.materials_paths,cm)
        refs_per_face=np.asarray(material_indices,np.int32)[::-1];primitives=[]
        for reference in np.unique(refs_per_face):
            material_name=mdl.materials[row[reference]].name;path=full_names[material_name].lower()
            mat_id=gltf_material_lookup[material_lookup[path]]
            chosen=indices[refs_per_face==reference].reshape(-1)
            primitives.append(dict(attributes=attributes.copy(),indices=append_accessor(chosen,'SCALAR',5125),material=mat_id,mode=4))
        old['primitives']=primitives
        repairs.append(dict(mesh=old.get('name'),meshId=mesh_id,model=name,skin=requested_skin,part=part,
            exporterTriangles=before,sourceTriangles=count,restoredTriangles=count-before,
            normalsSource='original VVD LOD0 via original VTX vertex remap',maxSourceNormalLengthError=normal_error,
            attributeSHA256=hashes))
    if repairs:
        doc['buffers'][0]['byteLength']=len(binary);binary.extend(b'\0'*((-len(binary))%4))
        encoded=json.dumps(doc,separators=(',',':'),ensure_ascii=False).encode();encoded+=b' '*((-len(encoded))%4)
        target.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(encoded)+len(binary))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+
            struct.pack('<II',len(binary),0x004e4942)+binary)
    manifest['sourceTopologyRestored']=repairs


def main():
    acf=(GAME.parent/'steamapps/appmanifest_740.acf').read_text()
    for key,value in [('appid','740'),('StateFlags','4'),('buildid','12426148')]:
        if not re.search(r'"'+key+r'"\s+"'+value+'"',acf,re.I): raise ValueError(f'ACF completion gate failed: {key}')
    import bpy
    import bmesh
    import numpy as np
    from mathutils import Vector
    if not bpy.app.background or '--factory-startup' not in sys.argv: raise ValueError('Use factory-startup background Blender')
    source=ROOT/'.tools/SourceIO'
    if subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()!=PIN: raise ValueError('Unreviewed SourceIO commit')
    if subprocess.check_output(['git','-C',str(source),'status','--porcelain','--untracked-files=no'],text=True).strip(): raise ValueError('SourceIO modified')
    sys.path.insert(0,str(source.parent))
    from SourceIO.library.utils import TinyPath,FileBuffer
    from SourceIO.library.shared.app_id import SteamAppId
    from SourceIO.library.shared.content_manager import ContentManager
    from SourceIO.library.shared.content_manager.providers.loose_files import LooseFilesContentProvider
    from SourceIO.library.shared.content_manager.providers.vpk_provider import VPKContentProvider
    from SourceIO.library.source1.bsp.bsp_file import open_bsp
    import SourceIO.library.source1.bsp.lumps
    from SourceIO.blender_bindings.source1.bsp.entities.csgo_entity_handlers import CSGOEntityHandler
    from SourceIO.blender_bindings.source1.bsp.import_bsp import import_disp
    from SourceIO.library.source1.vmt import VMT
    from SourceIO.library.utils.pylib.vtf import load_vtf_texture
    from SourceIO.library.utils.pylib.image import encode_png
    from SourceIO.library.utils.math_utilities import convert_rotation_source1_to_blender
    from SourceIO.logger import SourceLogMan
    cm=ContentManager()
    providers=[LooseFilesContentProvider(TinyPath(GAME),SteamAppId.COUNTER_STRIKE_GO),
               VPKContentProvider(TinyPath(GAME/'pak01_dir.vpk'),SteamAppId.COUNTER_STRIKE_GO)]
    bsp_path=GAME/'maps/de_dust2.bsp'
    bsp=open_bsp(TinyPath(bsp_path),FileBuffer(TinyPath(bsp_path)),cm,SteamAppId.COUNTER_STRIKE_GO)
    pak=bsp.get_lump('LUMP_PAK'); providers.insert(0,pak)
    for provider in providers: cm.add_child(provider)
    cm.priority_list=providers
    manifest['providers']=['embedded-de_dust2-pak','loose-csgo','pak01']
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    collection=bpy.data.collections.new('Dust2_'+args.layer);bpy.context.scene.collection.children.link(collection)
    root=bpy.data.objects.new('SourceUnits_to_Metres',None);collection.objects.link(root)
    root.scale=(args.meters_per_unit,)*3
    root['sourceCoordinateSystem']='Source X/Y horizontal Z up'
    root['sourceMetersPerUnit']=args.meters_per_unit
    settings=SimpleNamespace(scale=1.,light_scale=1.,import_textures=False,use_bvlg=False,
        load_static_props=False,load_props=False,load_lights=False,load_decals=False,load_info=False,load_triggers=False,
        load_logic=False,load_ropes=False,import_cubemaps=False)
    entities=bsp.get_lump('LUMP_ENTITIES').entities
    save('mounted')
    if args.repair_topology_only:
        # save('mounted') above uses a temporary manifest, so retain the completed
        # manifest before this function is entered (see the top-level dispatch).
        manifest.clear();manifest.update(completed_manifest)
        target=OUT/'props.glb';restore_source_topology(target,cm,manifest)
        manifest['alphaTestMaskMaterials']=finalize_glb(target,manifest['materials'])
        manifest['glb']=dict(file=str(target),bytes=target.stat().st_size,sha256=hashlib.sha256(target.read_bytes()).hexdigest())
        save('complete');return
    if args.layer=='world':
        handler=CSGOEntityHandler(bsp,cm,collection,1.,1.);handler.settings=settings
        world=handler._load_brush_model(0,'Dust2_world_faces');collection.objects.link(world)
        manifest['initiallyDisabledBrushEntities']=[]
        for entity in entities:
            if entity['classname']=='func_brush':
                if str(entity.get('startdisabled','0'))=='1':manifest['initiallyDisabledBrushEntities'].append(entity)
                else:handler.handle_entity(entity)
        import_disp(bsp,settings,collection,SourceLogMan().get_logger('Dust2 visual sample'))
        meshes=[o for o in collection.all_objects if o.type=='MESH']
        manifest['sourceMeshObjects']=len(meshes)
        manifest['sourceWorldFaces']=bsp.get_lump('LUMP_MODELS').models[0].face_count
        manifest['sourceDisplacements']=len(bsp.get_lump('LUMP_DISPINFO').infos)
    else:
        from SourceIO.blender_bindings.models.mdl49.import_mdl import import_model as import_mdl_meshes
        from SourceIO.library.models.mdl.v49 import MdlV49
        from SourceIO.library.models.vtx import open_vtx
        from SourceIO.library.models.vvd import Vvd
        from SourceIO.library.utils.path_utilities import find_vtx_cm
        static=bsp.get_lump('LUMP_GAME_LUMP').game_lumps['sprp'];cache={};records=[]
        chosen=static.static_props[:args.props_limit or None];manifest['sourceInstances']=len(static.static_props)
        manifest['skinHistogram']=dict(Counter(prop.skin for prop in chosen))
        manifest['sourceModels']={};manifest['skinFallbacks']=[];manifest['rawSkinTablesUsed']=True
        manifest['sourceTopologyPreserved']=[]
        for index,prop in enumerate(chosen):
            name=static.model_names[prop.prop_type]
            key=(name,prop.skin)
            if key not in cache:
                model_path=TinyPath(name);buffer=cm.find_file(model_path)
                if buffer is None: raise FileNotFoundError(name)
                raw=buffer.read();buffer.seek(0);mdl=MdlV49.from_buffer(buffer)
                if mdl.header.version!=49:raise ValueError('Unreviewed MDL version '+str(mdl.header.version))
                # SourceIO truncates skin_groups, including single-skin tables.
                # Read the actual bounded uint16 reference table and apply its
                # selected row to each mesh's original material reference before
                # importing. No ambiguous old-material -> new-material mapping.
                count=mdl.header.skin_family_count;refs=mdl.header.skin_reference_count;offset=mdl.header.skin_family_offset
                if count<1 or refs<1 or offset+2*count*refs>len(raw):raise ValueError('Invalid raw skin table: '+name)
                rows=[list(struct.unpack_from('<'+'H'*refs,raw,offset+2*skin*refs)) for skin in range(count)]
                if any(i>=len(mdl.materials) for row in rows for i in row):raise ValueError('Skin material index out of range: '+name)
                effective=prop.skin if 0<=prop.skin<count else 0
                if effective!=prop.skin:
                    manifest['skinFallbacks'].append(dict(model=name,requested=prop.skin,effective=0,available=count,
                        note='Explicit first-family preview fallback for out-of-range source request; original client behavior not yet observed'))
                mdl.skin_groups=[[mdl.materials[i] for i in row] for row in rows]
                for body in mdl.body_parts:
                    for model in body.models:
                        for mesh in model.meshes:
                            reference=mesh.material_index
                            if not 0<=reference<refs:raise ValueError('Mesh skin reference out of range: '+name)
                            mesh.material_index=rows[effective][reference]
                vtx_buffer=find_vtx_cm(model_path,cm);vvd_buffer=cm.find_file(model_path.with_suffix('.vvd'))
                if vtx_buffer is None or vvd_buffer is None:raise FileNotFoundError('VTX/VVD for '+name)
                container=import_mdl_meshes(cm,mdl,open_vtx(vtx_buffer),Vvd.from_buffer(vvd_buffer),scale=1.)
                if container is None or not container.objects: raise ValueError('No actual MDL mesh for '+name)
                # Static props have body=0. Do not accidentally export every
                # mutually exclusive bodygroup variant returned by the importer.
                selected=[]
                for body in mdl.body_parts:
                    if body.models and body.models[0].vertex_count:
                        objects=container.bodygroups.get(body.name,[])
                        if not objects: raise ValueError('Missing default bodygroup mesh: '+name+'/'+body.name)
                        selected.append(objects[0])
                if not selected: raise ValueError('No visible default bodygroup mesh: '+name)
                manifest['sourceModels'][name]=dict(sha256=hashlib.sha256(cm.find_file(model_path).read()).hexdigest(),
                    bodygroups={body.name:len(body.models) for body in mdl.body_parts},defaultMeshParts=len(selected),
                    rawSkinReferenceTable=rows,materialNames=[mat.name for mat in mdl.materials])
                # Static pose: evaluate the actual source armature once; clones
                # share the frozen evaluated mesh within each model/skin variant.
                templates=[];deps=bpy.context.evaluated_depsgraph_get()
                for obj in selected:
                    if obj.type!='MESH': continue
                    # Unlinked imported objects cannot be evaluated until linked.
                    collection.objects.link(obj)
                if container.armature and not container.armature.users_collection: collection.objects.link(container.armature)
                bpy.context.view_layer.update()
                for obj in selected:
                    if obj.type!='MESH': continue
                    data=bpy.data.meshes.new_from_object(obj.evaluated_get(deps),preserve_all_data_layers=True,depsgraph=deps)
                    templates.append((data,obj.matrix_world.copy()))
                for obj in [*container.objects,*container.attachments,container.armature]:
                    if obj is not None and obj.name in bpy.data.objects: bpy.data.objects.remove(obj,do_unlink=True)
                cache[key]=templates
            anchor=bpy.data.objects.new(f'static_prop_{index}',None);collection.objects.link(anchor);anchor.parent=root
            anchor.location=prop.origin;anchor.rotation_euler=convert_rotation_source1_to_blender(prop.rotation)
            scale=prop.uniform_scale or 1.;anchor.scale=(scale,scale,scale)
            anchor['sourceModel']=name;anchor['sourceSkin']=prop.skin;anchor['sourceSolid']=prop.solid
            for mi,(data,matrix) in enumerate(cache[key]):
                obj=bpy.data.objects.new(f'static_prop_{index}_mesh_{mi}',data);collection.objects.link(obj)
                obj.parent=anchor;obj.matrix_local=matrix
            manifest['actualMeshInstances']+=1
            records.append(dict(index=index,model=name,origin=prop.origin,angles=prop.rotation,skin=prop.skin,solid=prop.solid,
                                uniformScale=scale,meshParts=len(cache[key]),
                                meshMaterials=[[dict(name=m.name,source=m.get('full_path',m.name)) for m in data.materials] for data,_ in cache[key]]))
            if index%100==0: save(f'props {index}/{len(chosen)}')
        (OUT/'prop-instances.json').write_text(json.dumps(records,indent=2)+'\n')
        manifest['uniqueModelsImported']=len(manifest['sourceModels'])
        manifest['uniqueModelSkinVariants']=len(cache)
        manifest['unmapped'].append('Static props use actual default-bodygroup evaluated source meshes with source skin material remapping; VHV instance lighting is not reconstructed.')
        meshes=[o for o in collection.all_objects if o.type=='MESH']
    save('geometry imported')

    texture_cache={};material_records={};hidden=set()
    def image_for(name,normal=False):
        path='materials/'+name.strip('/\\').removesuffix('.vtf')+'.vtf';key=(path,normal)
        if key in texture_cache:return texture_cache[key]
        buffer=cm.find_file(TinyPath(path))
        if buffer is None: raise FileNotFoundError(path)
        data=buffer.read();pixels,width,height,is_float=load_vtf_texture(data)
        if is_float: raise ValueError('Float VTF needs an explicit HDR mapping: '+path)
        rgba=np.frombuffer(pixels,np.uint8).reshape(height,width,4).copy()
        if normal: rgba[:,:,1]=255-rgba[:,:,1]
        digest=hashlib.sha256((path+str(normal)).encode()).hexdigest()[:16]
        output=OUT/'textures'/f'{digest}.png';output.parent.mkdir(exist_ok=True)
        output.write_bytes(encode_png(rgba.tobytes(),width,height,4))
        image=bpy.data.images.load(str(output),check_existing=True)
        image.colorspace_settings.name='Non-Color' if normal else 'sRGB';image.alpha_mode='CHANNEL_PACKED'
        texture_cache[key]=image;manifest['textures'].append(dict(source=path,file=str(output.relative_to(OUT)),
            width=width,height=height,normalGreenInverted=normal,sourceSha256=hashlib.sha256(data).hexdigest()))
        return image
    used_materials={material for obj in meshes for material in obj.data.materials if material}
    for index,material in enumerate(sorted(used_materials,key=lambda m:m.name)):
        name=material.get('full_path',material.name)
        record=dict(name=material.name,source=name,shader=None,mapped=[],unmapped=[])
        material_records[material.name]=record
        path=TinyPath('materials/'+name.strip('/\\').removesuffix('.vmt')+'.vmt')
        buffer=cm.find_file(path)
        material.use_nodes=True;nodes=material.node_tree.nodes;nodes.clear()
        out_node=nodes.new('ShaderNodeOutputMaterial');pbr=nodes.new('ShaderNodeBsdfPrincipled')
        material.node_tree.links.new(pbr.outputs['BSDF'],out_node.inputs['Surface'])
        pbr.inputs['Roughness'].default_value=.9;pbr.inputs['Metallic'].default_value=0
        pbr.inputs['Base Color'].default_value=(.8,.05,.6,1)
        try:
            if buffer is None: raise FileNotFoundError(str(path))
            vmt=VMT(buffer,str(path),cm);record['shader']=vmt.shader;record['parameters']=vmt.data.to_dict()
            record['rawVmtSha256']=hashlib.sha256(cm.find_file(path).read()).hexdigest()
            # Source tool and sky portal surfaces are not visible materials.
            invisible=vmt.shader in ('nodraw','sky') or vmt.get_int('%compilesky',0) or vmt.get_int('%compilenodraw',0)
            invisible=invisible or name.lower() in ('tools/toolsnodraw','tools/toolsskybox','tools/toolsskybox2d')
            if invisible:
                hidden.add(material.name);record['mapped'].append('Source tool/sky portal excluded from visible mesh; original collision retained')
            else:
                base=vmt.get_string('$basetexture','')
                if not base: raise ValueError('No basetexture; explicit shader conversion still required')
                tex=nodes.new('ShaderNodeTexImage');tex.image=image_for(base)
                material.node_tree.links.new(tex.outputs['Color'],pbr.inputs['Base Color'])
                record['mapped'].append('$basetexture original VTF full-resolution RGB -> glTF baseColor')
                if vmt.get_int('$translucent',0) or vmt.get_int('$alphatest',0):
                    material.node_tree.links.new(tex.outputs['Alpha'],pbr.inputs['Alpha'])
                    material.surface_render_method='DITHERED';record['alphaTest']=vmt.get_int('$alphatest',0)
                    record['alphaCutoff']=vmt.get_float('$alphatestreference',.5)
                    record['mapped'].append('base texture alpha')
                bump=vmt.get_string('$bumpmap','')
                if bump and not vmt.get_int('$ssbump',0):
                    normal_tex=nodes.new('ShaderNodeTexImage');normal_tex.image=image_for(bump,True)
                    normal_node=nodes.new('ShaderNodeNormalMap');material.node_tree.links.new(normal_tex.outputs['Color'],normal_node.inputs['Color'])
                    material.node_tree.links.new(normal_node.outputs['Normal'],pbr.inputs['Normal']);record['mapped'].append('tangent normal with green inversion')
                material.use_backface_culling=not bool(vmt.get_int('$nocull',0))
                known={'$basetexture','$bumpmap','$translucent','$alphatest','$alphatestreference','$nocull'}
                record['unmapped']=[key for key in record['parameters'] if key.startswith('$') and key not in known]
                if vmt.shader not in ('lightmappedgeneric','vertexlitgeneric','unlitgeneric'):
                    record['unmapped'].append('Shader '+vmt.shader+' shown with first base layer only')
        except Exception as error:
            record['error']=f'{type(error).__name__}: {error}'
            record['unmapped'].append('Explicit magenta diagnostic material; original material was not silently replaced with white')
            manifest['errors'].append(dict(material=name,error=record['error']))
        manifest['materials'].append(record)
        if index%25==0:save(f'materials {index}/{len(used_materials)}')
    # Exclude only original tool/sky portal faces, not collision and not arbitrary
    # visible geometry. Shared source-model meshes are edited once.
    seen=set();hidden_faces=0
    for obj in meshes:
        if obj.data in seen:continue
        seen.add(obj.data)
        ids={i for i,m in enumerate(obj.data.materials) if m and m.name in hidden}
        if ids:
            bm=bmesh.new();bm.from_mesh(obj.data)
            doomed=[face for face in bm.faces if face.material_index in ids];hidden_faces+=len(doomed)
            bmesh.ops.delete(bm,geom=doomed,context='FACES');bm.to_mesh(obj.data);bm.free()
        # Source displacement alpha is a blend weight, not glTF transparency.
        # Preserve source records separately; do not export it as COLOR_0 alpha.
        for color in list(obj.data.color_attributes):obj.data.color_attributes.remove(color)
    manifest['excludedOriginalToolFaces']=hidden_faces
    if args.layer=='world':
        bpy.ops.object.select_all(action='DESELECT')
        meshes=[o for o in meshes if len(o.data.polygons)]
        for obj in meshes:obj.select_set(True)
        bpy.context.view_layer.objects.active=meshes[0]
        bpy.ops.object.join();merged=bpy.context.view_layer.objects.active;merged.name='Dust2_world_render';merged.parent=root
        meshes=[merged]
        manifest['unmapped'].extend(['Original HDR lightmaps are extracted but not yet reconstructed in glTF; use preview lighting.',
            'Displacement multiblend/vertex alpha weights retained in source lumps; first-layer material approximation is explicitly reported.',
            'Sky portal faces omitted as invisible boundaries; original skybox lighting/environment remains separate.'])
    bpy.context.view_layer.update()
    vertices=sum(len(obj.data.vertices) for obj in meshes);triangles=0
    for obj in meshes:obj.data.calc_loop_triangles();triangles+=len(obj.data.loop_triangles)
    points=[obj.matrix_world@Vector(corner) for obj in meshes for corner in obj.bound_box]
    manifest['geometry']=dict(meshObjects=len(meshes),vertices=vertices,triangles=triangles,
        blenderMetreBounds=dict(min=[min(v[i] for v in points) for i in range(3)],max=[max(v[i] for v in points) for i in range(3)]))
    manifest['shaderHistogram']=dict(Counter(m['shader'] for m in manifest['materials']))
    save('exporting')
    bpy.ops.object.select_all(action='DESELECT')
    for obj in collection.all_objects:obj.select_set(True)
    target=OUT/f'{args.layer}.glb'
    bpy.ops.export_scene.gltf(filepath=str(target),export_format='GLB',use_selection=True,
        export_yup=True,export_animations=False,export_skins=False,export_morph=False,export_cameras=False,
        export_lights=False,export_extras=True,export_materials='EXPORT',export_image_format='AUTO')
    if args.layer=='props':restore_source_topology(target,cm,manifest)
    manifest['alphaTestMaskMaterials']=finalize_glb(target,manifest['materials'])
    manifest['glb']=dict(file=str(target),bytes=target.stat().st_size,sha256=hashlib.sha256(target.read_bytes()).hexdigest())
    manifest['status']='sample-with-recorded-material-gaps' if manifest['unmapped'] or manifest['errors'] else 'exported'
    save('complete')

try:
    if args.repair_topology_only:
        completed_manifest=json.loads((OUT/f'{args.layer}-manifest.json').read_text())
        if args.layer!='props' or completed_manifest['stage']!='complete':raise ValueError('Only repair completed props export')
    if args.finalize_only:
        manifest=json.loads((OUT/f'{args.layer}-manifest.json').read_text())
        if manifest['stage']!='complete':raise ValueError('Only finalize a completed export')
        target=OUT/f'{args.layer}.glb'
        manifest['alphaTestMaskMaterials']=finalize_glb(target,manifest['materials'])
        manifest['glb']=dict(file=str(target),bytes=target.stat().st_size,sha256=hashlib.sha256(target.read_bytes()).hexdigest())
        (OUT/f'{args.layer}-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
        print('Finalized',args.layer,manifest['alphaTestMaskMaterials'])
    else:main()
except Exception as error:
    manifest['status']='failed';manifest['fatal']=f'{type(error).__name__}: {error}';save('failed');raise
