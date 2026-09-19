"""Private original CT + AK world-model composite, called by character importer.
Original separate skins/IBMs, source-name bone merge, explicitly labeled SDK poses.
"""
from __future__ import annotations
from dataclasses import asdict
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import struct
import traceback
import numpy as np


def export_world_ak(primary,parsed,buffers,cm,find,context,root):
    import bpy
    import SourceIO
    from mathutils import Matrix,Quaternion,Vector
    from SourceIO.library.utils import TinyPath
    from SourceIO.library.models.mdl.v49 import MdlV49
    from SourceIO.library.models.mdl.load_animations import AnimationData
    from SourceIO.library.models.mdl.structs.local_animation import StudioAnimDesc,AnimBoneFlags,ANIM_DTYPE
    from SourceIO.library.shared.app_id import SteamAppId
    from SourceIO.library.source1.vmt import VMT
    from SourceIO.library.utils.pylib.vtf import load_vtf_texture
    from SourceIO.library.utils.pylib.image import encode_png
    from SourceIO.blender_bindings.models import import_model
    from SourceIO.blender_bindings.models.common import put_into_collections
    from SourceIO.blender_bindings.models.import_animations import import_animations_to_armature
    from SourceIO.blender_bindings.models.prop_animations import _assign_action
    from SourceIO.blender_bindings.operators.import_settings_base import ModelOptions
    spec=importlib.util.spec_from_file_location('source_character_animation',root/'scripts/source-ct-animation.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    folder=root/'.reference-assets/source-exports/character-ct-ak';folder.mkdir(exist_ok=True)
    report={'status':'running','units':'unchanged original Source units; physical scale uncalibrated',
        'sourceScale':1,'gamePublicModified':False,'characterModel':context['selectedModel'],
        'worldModel':'models/weapons/w_rif_ak47.mdl','sourceIOFilesModified':False,'materials':[],
        'poseSemantics':'original decoded frames composed with public Source SDK2013 branches; no closed-client or IK equivalence claim',
        'materialSemantics':'unlit original base-color reference; raw VMT/normal/exponent retained for root Source Phong shader',
        'clipChecks':[]}
    def save(stage):
        report['stage']=stage;(folder/'audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2,default=lambda v:v.tolist() if hasattr(v,'tolist') else asdict(v))+'\n')
        print('SOURCE_WORLD_AK_STAGE',stage,flush=True)
    source_path=TinyPath(report['worldModel']);raw=find(source_path);assert raw is not None;raw.seek(0)
    weapon=MdlV49.from_buffer(raw)
    common={b.name for b in primary.bones}&{b.name for b in weapon.bones}
    assert common=={'weapon_hand_R','weapon_hand_L','ValveBiped.weapon_bone'}
    report['boneMerge']={'characterBones':len(primary.bones),'weaponBones':len(weapon.bones),'commonNames':sorted(common),
        'rule':'copy current character global bone matrices by exact source name; weapon nonmatching descendants retain original local source transforms',
        'reference':'Valve SDK2013 CBoneMergeCache::MergeMatchingBones; target game-specific IK/weapon overrides remain unimplemented'}
    report['weaponBones']=[{'name':b.name,'parent':b.parent_id,'flags':int(b.flags),'position':b.position,'quaternion':b.quat,'inverse':b.pose_to_bone} for b in weapon.bones]
    report['weaponAttachments']=[asdict(a) for a in weapon.attachments]
    SourceIO.register()
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    options=ModelOptions.default();options.scale=1;options.import_animations=False;options.import_include_animations=False
    options.import_textures=False;options.load_refpose=False;options.use_bvlg=False
    containers=[]
    for path,mdl in ((TinyPath(context['selectedModel']),primary),(source_path,weapon)):
        container=import_model(path,find(path),cm,options,SteamAppId.COUNTER_STRIKE_GO)
        assert container and container.armature and container.objects
        put_into_collections(container,path.stem,bodygroup_grouping=True);containers.append(container)
        for material in mdl.materials:
            paths=[TinyPath('materials')/(material.name+'.vmt')]+[TinyPath('materials')/p/(material.name+'.vmt') for p in mdl.materials_paths]
            vmt_path=next((p for p in paths if cm.check(p)),None);assert vmt_path is not None
            vmt=VMT(find(vmt_path),str(vmt_path),cm);fields={k:v for k,v in vmt.data.items() if isinstance(v,(str,int,float))}
            entry={'model':str(path),'name':material.name,'vmt':str(vmt_path),'shader':vmt.shader,'parameters':fields,'textures':[]}
            images={}
            for parameter in ('$basetexture','$bumpmap','$phongexponenttexture'):
                if not fields.get(parameter):continue
                texture_path='materials/'+fields[parameter].replace('\\','/').removesuffix('.vtf')+'.vtf'
                data=find(TinyPath(texture_path));assert data is not None;data.seek(0)
                pixels,w,h,is_float=load_vtf_texture(data.read());assert not is_float
                png=encode_png(pixels,w,h,4);texture_dir=folder/'textures';texture_dir.mkdir(exist_ok=True)
                output=texture_dir/(Path(texture_path).stem.lower()+'.png')
                if output.exists():assert output.read_bytes()==png,'Refusing to replace a different original texture'
                output.write_bytes(png)
                entry['textures'].append({'parameter':parameter,'source':texture_path,'file':str(output.relative_to(folder)),
                    'width':w,'height':h,'rgba8Sha256':hashlib.sha256(pixels).hexdigest(),'pngSha256':hashlib.sha256(png).hexdigest()})
                image=bpy.data.images.load(str(output),check_existing=True);image.colorspace_settings.name='sRGB' if parameter=='$basetexture' else 'Non-Color';images[parameter]=image
            assert '$basetexture' in images
            # An explicit diffuse reference cannot inherit the failed generic PBR
            # conversion's white/specular result. It does not impersonate Source lighting.
            # import_model parses another MdlV49 instance; its slots, rather than
            # the independently parsed metadata object's bpy_material, own material IDs.
            matches={slot for obj in container.objects for slot in obj.data.materials if slot and slot.name==material.name}
            assert len(matches)==1,(material.name,[m.name for o in container.objects for m in o.data.materials])
            material_bpy=matches.pop()
            material_bpy.use_nodes=True;nodes=material_bpy.node_tree.nodes;nodes.clear();links=material_bpy.node_tree.links
            output_node=nodes.new('ShaderNodeOutputMaterial');emission=nodes.new('ShaderNodeEmission');texture=nodes.new('ShaderNodeTexImage');texture.image=images['$basetexture']
            links.new(texture.outputs['Color'],emission.inputs['Color']);links.new(emission.outputs['Emission'],output_node.inputs['Surface'])
            material_bpy['sourceVMT']=str(vmt_path);material_bpy['sourceParameters']=fields;material_bpy['sourceMaterialMode']='original-base-color-reference-unlit'
            report['materials'].append(entry)
    character,gun=containers
    report['characterBones']=[{'name':b.name,'parent':b.parent_id,'inverse':b.pose_to_bone} for b in primary.bones]
    report['bindVertexSamples']={}
    for field,c in zip(('character','weapon'),containers):
        for obj in [c.armature,*c.objects]:
            assert max(abs(obj.matrix_world[r][k]-(1 if r==k else 0)) for r in range(4) for k in range(4))<1e-7,'Nonidentity model bind transform needs explicit handling'
        report['bindVertexSamples'][field]=[]
        for obj in c.objects:
            for v in obj.data.vertices:
                if v.index%32!=0 and v.index!=len(obj.data.vertices)-1:continue
                weights={obj.vertex_groups[g.group].name:g.weight for g in v.groups if g.weight>0}
                assert abs(sum(weights.values())-1)<.0001
                report['bindVertexSamples'][field].append({'mesh':obj.name,'index':v.index,'position':list(v.co),'weights':weights})
    report['imported']=[{'armature':c.armature.name,'bones':len(c.armature.data.bones),
        'sourceCoordinateBounds':{'min':[min(v.co[k] for o in c.objects for v in o.data.vertices) for k in range(3)],
            'max':[max(v.co[k] for o in c.objects for v in o.data.vertices) for k in range(3)]},
        'meshes':[{'name':o.name,'vertices':len(o.data.vertices),'triangles':len(o.data.polygons),
            'weightedBones':sorted({o.vertex_groups[g.group].name for v in o.data.vertices for g in v.groups if g.weight>0})} for o in c.objects]} for c in containers]
    save('original models and base-color references imported')
    # Decode the world's original inline delta clips with original per-bone delta
    # zero defaults. Pinned SourceIO erroneously adds base position/Euler to delta.
    old_rot=StudioAnimDesc._read_anim_rot_value;old_pos=StudioAnimDesc._read_anim_pos_value
    def read_rot(desc,data,flags,count,base_quat,base_rot,scale):
        if flags&AnimBoneFlags.ANIM_DELTA:base_quat=(0,0,0,1);base_rot=(0,0,0)
        return old_rot(desc,data,flags,count,base_quat,base_rot,scale)
    def read_pos(desc,data,flags,count,base_pos,scale):
        return old_pos(desc,data,flags,count,(0,0,0) if flags&AnimBoneFlags.ANIM_DELTA else base_pos,scale)
    StudioAnimDesc._read_anim_rot_value=read_rot;StudioAnimDesc._read_anim_pos_value=read_pos
    world_sequences={s.name:s for s in weapon.sequences};world_frames={};report['worldAnimations']=[]
    for name in ('default','rifle_fire','rifle_fire_crouch'):
        seq=world_sequences[name];assert seq.blend_count==1 and not seq.auto_layers
        desc=weapon.anim_descs[seq.anim_desc_indices[0]];assert desc.animblock_id==0
        decoded=desc.read_animations(raw,weapon.bones);assert decoded is not None
        p=np.zeros((desc.frame_count,len(weapon.bones),3));q=np.zeros((desc.frame_count,len(weapon.bones),4));q[:,:,3]=1
        if not int(desc.flags)&4:
            p[:]=[b.position for b in weapon.bones];q[:]=[b.quat for b in weapon.bones]
        for i,b in enumerate(weapon.bones):
            if b.name in decoded:p[:,i]=decoded[b.name]['pos'];q[:,i]=decoded[b.name]['rot']
        assert np.isfinite(p).all() and np.isfinite(q).all();q=module.normalize(q)
        world_frames[name]=(p,q,desc)
        report['worldAnimations'].append({'name':name,'frames':desc.frame_count,'fps':desc.fps,'flags':int(desc.flags),
            'decodedBones':len(decoded),'seqFlags':seq.flags,'boneWeights':seq.get_bone_weights(raw,len(weapon.bones))})
    metadata=json.loads((root/'.reference-assets/source-exports/character-ct/combat/source-animation-metadata.json').read_text())
    with np.load(root/'.reference-assets/source-exports/character-ct/combat/decoded-frames.npz') as loaded:
        frames={d['index']:(loaded[f"anim_{d['index']}_positions"],loaded[f"anim_{d['index']}_quaternions"]) for d in metadata['descriptors']}
    anim_model=parsed['models/player/ct_animations.mdl'];sampler=module.PoseSampler(anim_model,metadata,frames)
    source_map={b.name:i for i,b in enumerate(anim_model.bones)}
    primary_map={b.name:i for i,b in enumerate(primary.bones)}
    scene=bpy.context.scene;scene.render.fps=30;scene.render.fps_base=1
    scenarios=[('idle','Idle_lower','Idle',{},False),('walk','walk_lower','Walk',{'move_x':1},False),
        ('run','Run_lower','Run',{'move_x':1},False),('crouch_idle','Crouch_Idle_Lower','Crouch_Idle',{},False),
        ('crouch_walk','Crouch_walk_lower','Crouch_Walk',{'move_x':1},False),
        ('aim_fire','Idle_lower','Idle',{'body_yaw':20,'body_pitch':25},True),
        ('crouch_aim_fire','Crouch_Idle_Lower','Crouch_Idle',{'body_yaw':20,'body_pitch':25},True)]
    all_actions=[];source_vertex_samples=[]
    def world_matrices(mdl,p,q,override=None):
        result=[]
        for i,b in enumerate(mdl.bones):
            x,y,z,w=q[i];local=Matrix.LocRotScale(Vector(p[i]),Quaternion((w,x,y,z)),(1,1,1))
            result.append(override[b.name].copy() if override and b.name in override else result[b.parent_id]@local if b.parent_id>=0 else local)
        return result
    def read_timed(name,time):
        p,q,d=world_frames[name];f=min(time*d.fps,d.frame_count-1);i=int(f);j=min(i+1,d.frame_count-1);t=f-i
        return p[i]*(1-t)+p[j]*t,module.blend_quats(q[i],q[j],t)
    for mode in ('sdk-3way','sdk-bilinear'):
        for label,lower_name,state,params,fire in scenarios:
            lower=sampler.named[lower_name];upper=sampler.named[state+'_Upper_AK'];shot=sampler.named[state+'_Shoot_AK']
            # Source cadence remains 30 fps; action duration comes from the actual
            # selected N/idle descriptor, or the longer original gun shot sequence.
            selected=sampler.calc(lower,0,params,mode)
            ix,sx=sampler.axis(lower,0,params);iy,sy=sampler.axis(lower,1,params)
            key=lower['animationIndices'][(ix+(1 if sx>.999 else 0))+(iy+(1 if sy>.999 else 0))*lower['groupSize'][0]]
            base_desc=sampler.desc[key];duration=(base_desc['frames']-1)/base_desc['fps']
            if fire:duration=max((sampler.desc[shot['animationIndices'][0]]['frames']-1)/30,26/30)
            count=round(duration*30)+1;clip_name=mode+'__'+label
            char_data={b.name:np.zeros(count,ANIM_DTYPE) for b in primary.bones};gun_data={b.name:np.zeros(count,ANIM_DTYPE) for b in weapon.bones}
            expected_char=[];expected_gun=[];grips=[];samples=[]
            for f in range(count):
                time=f/30;cycle=min(time/((base_desc['frames']-1)/base_desc['fps']),1)
                pose=sampler.accumulate(sampler.rest,lower,cycle,1,params,mode);pose=sampler.accumulate(pose,upper,cycle,1,params,mode)
                if fire:
                    shot_desc=sampler.desc[shot['animationIndices'][0]];shot_cycle=min(time/((shot_desc['frames']-1)/shot_desc['fps']),1)
                    pose=sampler.accumulate(pose,shot,shot_cycle,1,params,mode)
                cp=np.array([pose[0][source_map[b.name]] if b.name in source_map else b.position for b in primary.bones]);cq=np.array([pose[1][source_map[b.name]] if b.name in source_map else b.quat for b in primary.bones])
                cw=world_matrices(primary,cp,cq);override={b.name:cw[i] for i,b in enumerate(primary.bones)}
                wp,wq=read_timed('default',0)
                if fire:
                    fire_name='rifle_fire_crouch' if 'Crouch' in state else 'rifle_fire';dp,dq=read_timed(fire_name,time)
                    weights=np.array(next(v['boneWeights'] for v in report['worldAnimations'] if v['name']==fire_name));active=weights>0
                    wq[active]=module.multiply(wq[active],module.quaternion_scale(dq[active],weights[active]));wp[active]+=dp[active]*weights[active,None]
                ww=world_matrices(weapon,wp,wq,override)
                for b in primary.bones:
                    i=primary_map[b.name];char_data[b.name][f]['pos']=cp[i];char_data[b.name][f]['rot']=cq[i]
                for i,b in enumerate(weapon.bones):
                    local=ww[b.parent_id].inverted()@ww[i] if b.parent_id>=0 else ww[i]
                    pos,rot,scale=local.decompose();assert max(abs(v-1) for v in scale)<.0001
                    gun_data[b.name][f]['pos']=pos;gun_data[b.name][f]['rot']=(rot.x,rot.y,rot.z,rot.w)
                left=next(a for a in weapon.attachments if a.name=='left_hand_attach')
                attachment=Matrix([list(left.matrix[i:i+4]) for i in (0,4,8)]+[[0,0,0,1]])
                grip=ww[left.parent_bone]@attachment;hand=cw[primary_map['weapon_hand_L']]
                grips.append((grip.translation-hand.translation).length);expected_char.append(cw);expected_gun.append(ww)
            actions=[]
            for container,mdl,data in ((character,primary,char_data),(gun,weapon,gun_data)):
                arm=container.armature
                for bone in arm.pose.bones:bone.matrix_basis=Matrix.Identity(4);bone.rotation_mode='QUATERNION'
                animation=AnimationData(clip_name,30,count,list(data),data,not fire,False)
                action=import_animations_to_armature(arm,[animation],1)[0];action.name=clip_name+('__character' if mdl is primary else '__weapon');_assign_action(arm,action)
                for layer in action.layers:
                    for strip in layer.strips:
                        for bag in strip.channelbags:
                            for curve in bag.fcurves:
                                for point in curve.keyframe_points:point.co.x-=1;point.interpolation='LINEAR'
                                curve.update()
                actions.append(action)
            max_char=0.;max_gun=0.
            for f in sorted({0,1,count//2,count-2,count-1}):
                scene.frame_set(f);bpy.context.view_layer.update();row={'frame':f,'seconds':f/30,'character':{},'weapon':{}}
                for container,mdl,expected,field in ((character,primary,expected_char[f],'character'),(gun,weapon,expected_gun[f],'weapon')):
                    maximum=0.
                    for i,b in enumerate(mdl.bones):
                        actual=container.armature.pose.bones[b.name].matrix;maximum=max(maximum,max(abs(actual[r][c]-expected[i][r][c]) for r in range(4) for c in range(4)))
                        row[field][b.name]=[list(r) for r in expected[i]]
                    if field=='character':max_char=max(max_char,maximum)
                    else:max_gun=max(max_gun,maximum)
                samples.append(row)
            assert max_char<.002 and max_gun<.005,f'Baked transform mismatch {clip_name}: {max_char}/{max_gun}'
            report['clipChecks'].append({'name':clip_name,'frames':count,'fps':30,'duration':duration,'parameters':params,
                'maxCharacterBoneError':max_char,'maxWeaponBoneError':max_gun,'leftGripGapMin':min(grips),'leftGripGapMax':max(grips),'samples':samples})
            all_actions.append((clip_name,actions));save('baked '+clip_name)
    for index,container in enumerate(containers):
        arm=container.armature;arm.animation_data.action=None
        for b in arm.pose.bones:b.matrix_basis=Matrix.Identity(4)
        for name,actions in all_actions:
            track=arm.animation_data.nla_tracks.new();track.name=name;strip=track.strips.new(actions[index].name,0,actions[index]);strip.action_slot=next(iter(actions[index].slots))
    scene.frame_set(0);bpy.ops.object.select_all(action='DESELECT')
    for c in containers:
        for obj in [c.armature,*c.objects]:obj.select_set(True)
    bpy.context.view_layer.objects.active=character.armature
    target=folder/'ctm_idf_ak47-sdk-poses-basecolor-reference.glb'
    assert bpy.ops.export_scene.gltf(filepath=str(target),export_format='GLB',use_selection=True,export_animations=True,
        export_animation_mode='ACTIONS',export_frame_range=False,export_force_sampling=False,export_optimize_animation_size=False,
        export_skins=True,export_all_influences=True,export_def_bones=False,export_extras=True,export_tangents=True,
        export_merge_animation='NLA_TRACK',export_anim_single_armature=False)=={'FINISHED'}
    payload=bytearray(target.read_bytes());length=struct.unpack_from('<I',payload,12)[0];gltf=json.loads(payload[20:20+length]);binary=28+length
    assert len(gltf['animations'])==len(all_actions) and len(gltf['skins'])==2
    conversion=Matrix(((1,0,0,0),(0,0,1,0),(0,-1,0,0),(0,0,0,1)));models={character.armature.name:primary,gun.armature.name:weapon}
    patch_delta=0.;matrices=0
    for skin in gltf['skins']:
        mdl=models[skin['name']];bones={b.name:b for b in mdl.bones};accessor=gltf['accessors'][skin['inverseBindMatrices']];view=gltf['bufferViews'][accessor['bufferView']]
        assert accessor['componentType']==5126 and accessor['type']=='MAT4'
        for i,n in enumerate(skin['joints']):
            b=bones[gltf['nodes'][n]['name']];inverse=Matrix([list(row) for row in b.pose_to_bone.T]+[[0,0,0,1]])@conversion.inverted()
            offset=binary+view.get('byteOffset',0)+accessor.get('byteOffset',0)+i*view.get('byteStride',64);values=[inverse[r][c] for c in range(4) for r in range(4)]
            old=struct.unpack_from('<16f',payload,offset);error=max(abs(a-b) for a,b in zip(old,values));assert error<.01,f'Skin coordinate mismatch {error}'
            patch_delta=max(patch_delta,error);struct.pack_into('<16f',payload,offset,*values);assert struct.unpack_from('<16f',payload,offset)==tuple(values);matrices+=1
    # Blender 5.2 exports an emission-only shader as black PBR plus emissive.
    # Convert that explicit reference representation to the standard unlit
    # extension without changing the embedded source PNG or geometry buffers.
    for material in gltf['materials']:
        assert material['emissiveFactor']==[1,1,1] and 'emissiveTexture' in material
        texture=material.pop('emissiveTexture');material.pop('emissiveFactor')
        material['pbrMetallicRoughness']={'baseColorTexture':texture,'baseColorFactor':[1,1,1,1]}
        material.setdefault('extensions',{})['KHR_materials_unlit']={}
    gltf['extensionsUsed']=sorted(set(gltf.get('extensionsUsed',[]))|{'KHR_materials_unlit'})
    document=json.dumps(gltf,separators=(',',':'),ensure_ascii=False).encode();document+=b' '*((-len(document))%4)
    body=bytes(payload[binary:]);payload=bytearray(struct.pack('<4sII',b'glTF',2,12+8+len(document)+8+len(body)))
    payload+=struct.pack('<I4s',len(document),b'JSON')+document+struct.pack('<I4s',len(body),b'BIN\0')+body
    target.write_bytes(payload)
    assert all(m.get('extensions',{}).get('KHR_materials_unlit') is not None for m in gltf['materials']),'Reference materials must explicitly export as unlit'
    report['glb']={'file':target.name,'path':str(target),'bytes':len(payload),'sha256':hashlib.sha256(payload).hexdigest(),
        'skins':len(gltf['skins']),'bones':[len(s['joints']) for s in gltf['skins']],'animations':[a['name'] for a in gltf['animations']],
        'materials':len(gltf['materials']),'images':len(gltf.get('images',[]))}
    report['inverseBindRestore']={'matrices':matrices,'maxOriginalBlenderDifference':patch_delta,'finalRawReadbackError':0}
    report['gripStatus']='not_passed_no_hand_IK; original attachment gaps recorded, no guessed offset or bone modification'
    report['status']='passed_conversion_checks_grip_and_final_material_pending';report['dependencies']=context['dependencies']
    save('composite exported');SourceIO.unregister()
