"""Private audit/export of the original Dust2 T character; preserve source units.
Run Blender --background --factory-startup --python this_file.py -- [--export-glb].
Does not implement Source animation blending, delta poses, or a player state machine.
"""
from __future__ import annotations
from collections import deque
from dataclasses import asdict
import importlib.util
import hashlib
import json
import math
import re
from pathlib import Path
import sys
import struct
import traceback

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / '.reference-assets/source-exports/character-t'
OUT.mkdir(parents=True, exist_ok=True)
REPORT_FILE=OUT/('world-ak-source-context.json' if '--world-ak' in sys.argv else 'combat-audit.json' if '--sample-combat' in sys.argv else 'audit.json' if '--export-glb' in sys.argv else 'metadata-preflight.json')
REPORT = {'status':'running', 'units':'original Source coordinates; physical unit uncalibrated', 'sourceScale':1.0,
          'dependencies':{}, 'models':[], 'sequences':[], 'limitations':['No client-side state machine, additive/layered or pose-parameter blending implemented.']}


def serial(value):
    if hasattr(value,'tolist'): return value.tolist()
    if hasattr(value,'__dataclass_fields__'): return asdict(value)
    if isinstance(value,Path): return str(value)
    raise TypeError(type(value).__name__)


def save(stage):
    REPORT['stage']=stage
    REPORT_FILE.write_text(json.dumps(REPORT,ensure_ascii=False,indent=2,default=serial)+'\n')
    print('SOURCE_CHARACTER_STAGE', stage, flush=True)


def category(seq):
    name=(seq.name+' '+seq.activity_name).lower()
    for kind, words in [('reload',('reload',)),('fire',('fire','attack','shoot')),('crouch',('crouch','crouchwalk')),('run',('run',)),('walk',('walk',)),('idle',('idle',))]:
        if any(word in name for word in words): return kind
    return None


def gamemode_blocks(raw):
    """Strict small KV1 reader for gamemodes; supports same-line braces.
    SourceIO's parser consumes closing braces after a same-line scalar pair.
    No directives/conditions are expected here; reject rather than guess them.
    """
    text=raw.decode('utf-8-sig'); token=re.compile(r'\s+|//[^\n]*|"(?:\\.|[^"\\])*"|[{}]|[^\s{}"]+')
    parts=[]; end=0
    for match in token.finditer(text):
        assert match.start()==end, 'Unrecognized gamemodes syntax'
        end=match.end(); item=match.group()
        if item.isspace() or item.startswith('//'): continue
        parts.append(re.sub(r'\\(["\\])',r'\1',item[1:-1]) if item.startswith('"') else item)
    assert end==len(text)
    i=0
    def block(nested=False):
        nonlocal i
        pairs=[]
        while i<len(parts):
            key=parts[i]; i+=1
            if key=='}':
                assert nested; return pairs
            assert key not in ('{','[') and not key.startswith('#')
            value=parts[i]; i+=1
            pairs.append((key.lower(),block(True) if value=='{' else value))
        assert not nested, 'Unclosed gamemodes block'
        return pairs
    return block()


def raw_pose_parameters(mdl,buffer):
    values=[]
    for i in range(mdl.header.local_pose_paramater_count):
        start=mdl.header.local_pose_parameter_offset+i*20
        with buffer.read_from_offset(start):
            name_offset,flags,low,high,loop=buffer.read_fmt('iifff')
        with buffer.read_from_offset(start+name_offset): name=buffer.read_ascii_string()
        values.append({'index':i,'name':name,'flags':flags,'start':low,'end':high,'loop':loop})
    return values


def raw_sequence_fields(seq,mdl,buffer):
    with buffer.read_from_offset(seq._entry_offset+68): group_size=list(buffer.read_fmt('2I'))
    with buffer.read_from_offset(seq._entry_offset+148): count,offset=buffer.read_fmt('2I')
    assert count==len(seq.auto_layers)
    assert group_size[0]*group_size[1]==len(seq.anim_desc_indices)
    layers=[]
    with buffer.read_from_offset(seq._entry_offset+offset):
        for _ in range(count):
            sequence,pose,flags,start,peak,tail,end=buffer.read_fmt('hhI4f')
            assert 0<=sequence<len(mdl.sequences) and all(math.isfinite(v) for v in (start,peak,tail,end))
            layers.append({'sequence_id':sequence,'sequence_name':mdl.sequences[sequence].name,'pose_id':pose,
                'flags':flags,'start':start,'peak':peak,'tail':tail,'end':end})
    return {'groupSize':group_size,'parameterIndices':list(seq.param_offset),'poseKeys':seq.pose_keys,
        'autoLayers':layers,'boneWeights':seq.get_bone_weights(buffer,len(mdl.bones)) if seq.weight_offset else [],
        'activity':seq.activity,'activityWeight':seq.activity_weight,'fadeIn':seq.fade_in_time,'fadeOut':seq.fade_out_time,
        'cyclePoseIndex':seq.cycle_pose_offset}


def main():
    spec=importlib.util.spec_from_file_location('source_items_inventory', ROOT/'scripts/inventory-source-items.py')
    inventory=importlib.util.module_from_spec(spec); spec.loader.exec_module(inventory)
    REPORT.update(inventory.initialize())
    sources=inventory.Sources()
    mode_path='gamemodes.txt'
    modes=inventory.json_kv(gamemode_blocks(sources.read(mode_path)))
    candidates=[]
    for path,value in inventory.walk(modes):
        if path[-1]=='de_dust2' and isinstance(value,dict):
            REPORT['dust2Definition']={'path':'/'+ '/'.join(path),'definition':value}
            candidates=list(value['t_models'])
    assert candidates, 'No actual de_dust2 T model configuration'
    REPORT['dust2Source']=sources.reads[mode_path]
    selected='models/player/'+candidates[0]+'.mdl'
    assert sources.exists(selected), selected
    REPORT['selectedModel']=sources.metadata(selected)['path']

    import bpy
    from SourceIO.library.shared.app_id import SteamAppId
    from SourceIO.library.shared.content_manager import ContentManager
    from SourceIO.library.shared.content_manager.providers.loose_files import LooseFilesContentProvider
    from SourceIO.library.shared.content_manager.providers.vpk_provider import VPKContentProvider
    from SourceIO.library.utils import TinyPath
    from SourceIO.library.models.mdl.v49 import MdlV49
    from SourceIO.library.source1.vmt import VMT
    cm=ContentManager(); cm.clean()
    providers=[LooseFilesContentProvider(TinyPath(inventory.GAME),SteamAppId.COUNTER_STRIKE_GO),
               VPKContentProvider(TinyPath(inventory.GAME/'pak01_dir.vpk'),SteamAppId.COUNTER_STRIKE_GO)]
    for provider in providers: cm.add_child(provider)
    cm.priority_list=providers[:]
    raw_find=cm.find_file
    raw_check=cm.check
    cm.check=lambda path: raw_check(TinyPath(str(path).lower()))
    def find(path,do_not_cache=False):
        path=TinyPath(str(path).lower())
        assert not path.is_absolute() and '..' not in str(path).split('/'), 'Unbounded source lookup'
        result=raw_find(path,do_not_cache=do_not_cache)
        if result is not None and str(path) not in REPORT['dependencies']:
            position=result.tell(); result.seek(0); raw=result.read(); result.seek(position)
            REPORT['dependencies'][str(path)]={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
        return result
    cm.find_file=find
    pending=deque([REPORT['selectedModel']]); parsed={}; buffers={}
    while pending:
        path=pending.popleft()
        if path in parsed: continue
        assert len(parsed)<64, 'Unexpected include graph size'
        buffer=find(TinyPath(path))
        if buffer is None:
            REPORT.setdefault('missingIncludes',[]).append(path)
            continue
        buffer.seek(0); mdl=MdlV49.from_buffer(buffer)
        parsed[path]=mdl; buffers[path]=buffer; pending.extend(mdl.include_models)
        descriptors=[{'index':i,'name':d.name,'fps':d.fps,'frames':d.frame_count,'flags':int(d.flags),
            'delta':bool(int(d.flags)&4),'loop':bool(int(d.flags)&1),'animblockId':d.animblock_id,
            'seconds':(d.frame_count-1)/d.fps if d.fps else None} for i,d in enumerate(mdl.anim_descs)]
        REPORT['models'].append({'path':path,'version':mdl.header.version,'bones':len(mdl.bones),
            'includes':mdl.include_models,'animationBlock':mdl.header.anim_block_name,'animations':descriptors,
            'materials':[m.name for m in mdl.materials],'materialPaths':mdl.materials_paths,'poseParameters':raw_pose_parameters(mdl,buffer),
            'boneDefinitions':[{'name':b.name,'parent':b.parent_id,'position':b.position,'quaternion':b.quat,'poseToBone':b.pose_to_bone} for b in mdl.bones]})
        for i,seq in enumerate(mdl.sequences):
            keys=list(dict.fromkeys(seq.anim_desc_indices))
            valid=all(0<=n<len(mdl.anim_descs) for n in keys)
            eligible=valid and len(keys)==1 and seq.blend_count==1 and not seq.auto_layers
            if eligible:
                d=mdl.anim_descs[keys[0]]
                eligible=not bool(int(d.flags)&4) and d.frame_count>1 and d.fps>0
            REPORT['sequences'].append({'sourceModel':path,'index':i,'name':seq.name,'activityName':seq.activity_name,
                'flags':seq.flags,'category':category(seq),'blendCount':seq.blend_count,'animationIndices':seq.anim_desc_indices,
                'events':[asdict(e) for e in seq.events],
                'paramStart':seq.param_start,'paramEnd':seq.param_end,'eligibleSimpleAbsolute':bool(eligible),
                **raw_sequence_fields(seq,mdl,buffer)})
        save('metadata '+path)
    primary=parsed[REPORT['selectedModel']]
    REPORT['materials']=[]
    for material in primary.materials:
        paths=[TinyPath('materials')/(material.name+'.vmt')]+[TinyPath('materials')/p/(material.name+'.vmt') for p in primary.materials_paths]
        path=next((p for p in paths if cm.check(p)),None)
        entry={'name':material.name,'path':str(path) if path else None}
        if path:
            vmt=VMT(find(path),str(path),cm)
            entry['shader']=vmt.shader
            entry['parameters']={k:v for k,v in vmt.data.items() if isinstance(v,(str,int,float))}
            entry['textures']=[]
            for k,v in entry['parameters'].items():
                if isinstance(v,str) and ('texture' in k or k in ('$bumpmap','$detail','$envmapmask','$phongexponenttexture')):
                    texture='materials/'+v.replace('\\','/').removesuffix('.vtf')+'.vtf'
                    entry['textures'].append({'parameter':k,**sources.metadata(texture)})
        REPORT['materials'].append(entry)
    REPORT['summary']={'models':len(parsed),'sequences':len(REPORT['sequences']),
        'simpleAbsoluteCandidates':[{k:s[k] for k in ('sourceModel','index','name','category')} for s in REPORT['sequences'] if s['eligibleSimpleAbsolute']]}
    REPORT['status']='passed_metadata_preflight'
    REPORT['sequenceParserAdapter']={'autoLayerStride':24,'layout':'int16 sequence, int16 pose, int32 flags, float32 start/peak/tail/end',
        'sourceioFilesModified':False,'reason':'Pinned SourceIO reads 28 bytes and corrupts second-layer indices; raw record layout cross-checked with Valve studio.h and actual source index/range values'}
    save('metadata complete')
    if '--export-glb' in sys.argv:
        export_character(primary,parsed,buffers,cm,find)
    if '--sample-combat' in sys.argv:
        spec=importlib.util.spec_from_file_location('source_character_animation',ROOT/'scripts/source-character-animation.py')
        module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        module.sample_combat(primary,parsed,buffers,cm,REPORT,OUT)
        save('combat sampling complete')
    if '--world-ak' in sys.argv:
        spec=importlib.util.spec_from_file_location('source_world_ak',ROOT/'scripts/import-source-world-ak.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        module.export_world_ak(primary,parsed,buffers,cm,find,REPORT,ROOT)
        save('world AK composite complete')


def export_character(primary,parsed,buffers,cm,find):
    import bpy
    import numpy as np
    from mathutils import Matrix, Quaternion, Vector
    import SourceIO
    from SourceIO.library.utils import TinyPath
    from SourceIO.library.shared.app_id import SteamAppId
    from SourceIO.library.models.mdl.load_animations import AnimationData
    from SourceIO.blender_bindings.models import import_model
    from SourceIO.blender_bindings.models.common import put_into_collections
    from SourceIO.blender_bindings.operators.import_settings_base import ModelOptions
    from SourceIO.blender_bindings.models.import_animations import import_animations_to_armature
    from SourceIO.blender_bindings.models.prop_animations import _assign_action
    from SourceIO.library.utils.pylib.vtf import load_vtf_texture
    from SourceIO.library.utils.pylib.image import encode_png
    SourceIO.register()
    model_path=TinyPath(REPORT['selectedModel'])
    REPORT['textureExports']=[]
    for material in REPORT['materials']:
        assert material['path'], 'Missing original material'
        for texture in material['textures']:
            assert not texture.get('missing'), texture['path']
            raw=find(TinyPath(texture['path'])); raw.seek(0)
            pixels,width,height,is_float=load_vtf_texture(raw.read())
            assert not is_float, 'Do not quantize float source textures'
            encoded=encode_png(pixels,width,height,4)
            directory=OUT/'textures'; directory.mkdir(exist_ok=True)
            name=Path(texture['path']).stem+'.png'; (directory/name).write_bytes(encoded)
            REPORT['textureExports'].append({'source':texture['path'],'parameter':texture['parameter'],
                'file':'textures/'+name,'width':width,'height':height,'rgba8Sha256':hashlib.sha256(pixels).hexdigest(),
                'pngSha256':hashlib.sha256(encoded).hexdigest(),'conversion':'SourceIO native VTF RGBA8 -> lossless PNG'})
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
    options=ModelOptions.default(); options.scale=1.0; options.import_animations=False
    options.import_include_animations=False; options.import_textures=True; options.load_refpose=False; options.use_bvlg=False
    container=import_model(model_path,find(model_path),cm,options,SteamAppId.COUNTER_STRIKE_GO)
    assert container and container.armature and container.objects
    put_into_collections(container,model_path.stem,bodygroup_grouping=True)
    armature=container.armature; bpy.context.view_layer.objects.active=armature
    assert len(armature.data.bones)==len(primary.bones)
    reconstructed_error=0.0
    for bone in primary.bones:
        source_inverse=Matrix([list(row) for row in bone.pose_to_bone.T]+[[0,0,0,1]])
        reconstructed=armature.data.bones[bone.name].matrix_local.inverted()
        reconstructed_error=max(reconstructed_error,max(abs(source_inverse[i][j]-reconstructed[i][j]) for i in range(4) for j in range(4)))
    inverse_bind_error=0.0
    for bone in primary.bones:
        imported=armature.data.bones[bone.name]
        assert (imported.parent.name if imported.parent else None)==(primary.bones[bone.parent_id].name if bone.parent_id>=0 else None)
        source_inverse=Matrix([list(row) for row in bone.pose_to_bone.T]+[[0,0,0,1]])
        actual_inverse=imported.matrix_local.inverted()
        inverse_bind_error=max(inverse_bind_error,max(abs(source_inverse[i][j]-actual_inverse[i][j]) for i in range(4) for j in range(4)))
    # Blender rest bones approximate the separately encoded skin bind. This is
    # measured, not accepted as final fidelity: exact raw IBM is restored below.
    assert inverse_bind_error<.01, f'Unexpectedly large preliminary bind difference: {inverse_bind_error}'
    all_points=[v.co for obj in container.objects for v in obj.data.vertices]
    REPORT['imported']={'armature':armature.name,'bones':len(armature.data.bones),'maxSourceInverseBindError':inverse_bind_error,
        'sourceIOReconstructedInverseBindError':reconstructed_error,'bindStrategy':'Blender rest approximation measured; final GLB IBM replaced with exact original pose_to_bone in Y-up coordinates',
        'sourceCoordinateBounds':{'min':[min(v[k] for v in all_points) for k in range(3)],'max':[max(v[k] for v in all_points) for k in range(3)]},
        'meshes':[{'name':obj.name,'vertices':len(obj.data.vertices),'polygons':len(obj.data.polygons),
            'materials':[m.name if m else None for m in obj.data.materials]} for obj in container.objects]}
    save('model imported and inverse bind checked')
    scene=bpy.context.scene; scene.render.fps=60; scene.render.fps_base=1.0
    actions=[]; REPORT['clipChecks']=[]
    # These named sequences are authored in the selected model itself. No include
    # bone remap, delta default, pose-parameter mixing or layer weighting is inferred.
    for name in ('testIdle','testWalkN'):
        seq=next(s for s in REPORT['sequences'] if s['sourceModel']==REPORT['selectedModel'] and s['name']==name)
        assert seq['eligibleSimpleAbsolute']
        desc=primary.anim_descs[seq['animationIndices'][0]]
        assert desc.animblock_id==0 and not (int(desc.flags)&4), 'Selected clip must be inline absolute animation'
        frames=dict(desc.read_animations(buffers[REPORT['selectedModel']],primary.bones))
        assert set(frames)<={b.name for b in primary.bones}
        for bone,data in list(frames.items()):
            if len(data)==1: frames[bone]=np.repeat(data,desc.frame_count)
            assert len(frames[bone])==desc.frame_count
            assert np.isfinite(frames[bone]['pos']).all() and np.isfinite(frames[bone]['rot']).all()
            assert np.min(np.linalg.norm(frames[bone]['rot'],axis=1))>.9
        animation=AnimationData(desc.name,desc.fps,desc.frame_count,list(frames),frames,bool(int(desc.flags)&1),False)
        for bone in armature.pose.bones: bone.matrix_basis=Matrix.Identity(4); bone.rotation_mode='QUATERNION'
        action=import_animations_to_armature(armature,[animation],1.0)[0]
        action.name=name; _assign_action(armature,action)
        action['sourceSequence']=name; action['sourceFrames']=desc.frame_count; action['sourceFps']=desc.fps
        curves=[curve for layer in action.layers for strip in layer.strips for bag in strip.channelbags for curve in bag.fcurves]
        assert curves
        for curve in curves:
            for point in curve.keyframe_points:
                point.co.x=(point.co.x-1)*60/desc.fps; point.interpolation='LINEAR'
            curve.update()
        max_matrix_error=0.0; max_vertex_error=0.0; samples=[]
        sample_frames={0,1,desc.frame_count//2,desc.frame_count-2,desc.frame_count-1}
        for frame_index in range(desc.frame_count):
            blender_frame=frame_index*60/desc.fps
            scene.frame_set(math.floor(blender_frame),subframe=blender_frame-math.floor(blender_frame)); bpy.context.view_layer.update()
            expected=[]
            for bone in primary.bones:
                data=frames.get(bone.name)
                pos=data[frame_index]['pos'] if data is not None else bone.position
                rot=data[frame_index]['rot'] if data is not None else bone.quat
                x,y,z,w=rot; local=Matrix.LocRotScale(Vector(pos),Quaternion((w,x,y,z)),(1,1,1))
                world=expected[bone.parent_id]@local if bone.parent_id>=0 else local; expected.append(world)
                actual=armature.pose.bones[bone.name].matrix
                max_matrix_error=max(max_matrix_error,max(abs(actual[i][j]-world[i][j]) for i in range(4) for j in range(4)))
            if frame_index in sample_frames:
                samples.append({'frame':frame_index,'seconds':frame_index/desc.fps,
                    'boneWorldMatrices':{b.name:[list(row) for row in expected[n]] for n,b in enumerate(primary.bones)}})
                skin={bone.name:expected[n]@Matrix([list(row) for row in bone.pose_to_bone.T]+[[0,0,0,1]]) for n,bone in enumerate(primary.bones)}
                vertex_samples={}
                for obj in container.objects:
                    evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get()); mesh=evaluated.to_mesh(); points=[]
                    for vertex in obj.data.vertices:
                        point=Vector((0,0,0)); weight=0
                        for group in vertex.groups:
                            if group.weight>0:
                                point+=(skin[obj.vertex_groups[group.group].name]@vertex.co)*group.weight; weight+=group.weight
                        assert abs(weight-1)<.0001
                        actual=evaluated.matrix_world@mesh.vertices[vertex.index].co
                        max_vertex_error=max(max_vertex_error,(point-actual).length)
                        if vertex.index%128==0 or vertex.index==len(obj.data.vertices)-1:
                            points.append({'index':vertex.index,'bindPosition':list(vertex.co),'sourcePosition':list(point),'blenderPosition':list(actual)})
                    vertex_samples[obj.name]=points; evaluated.to_mesh_clear()
                samples[-1]['vertexSamples']=vertex_samples
        REPORT['clipChecks'].append({'name':name,'fps':desc.fps,'frames':desc.frame_count,'seconds':(desc.frame_count-1)/desc.fps,
            'decodedBones':len(frames),'delta':False,'sourceModel':REPORT['selectedModel'],'events':seq['events'],
            'maxSourceBoneMatrixError':max_matrix_error,'maxSourceSkinVertexError':max_vertex_error,'samples':samples})
        assert max_matrix_error<.002 and max_vertex_error<.005, f'Source animation/skinning disagreement: {max_matrix_error}/{max_vertex_error}'
        actions.append(action); save('checked '+name)
    armature.animation_data.action=None
    for bone in armature.pose.bones: bone.matrix_basis=Matrix.Identity(4)
    for action in actions:
        track=armature.animation_data.nla_tracks.new(); track.name=action.name
        strip=track.strips.new(action.name,0,action); strip.action_slot=next(iter(action.slots))
    scene.frame_set(0); bpy.ops.object.select_all(action='DESELECT')
    for obj in [armature,*container.objects]: obj.select_set(True)
    bpy.context.view_layer.objects.active=armature
    target=OUT/'tm_leet_varianta-source-unit.glb'
    desired={'filepath':str(target),'export_format':'GLB','use_selection':True,'export_animations':True,
        'export_animation_mode':'ACTIONS','export_frame_range':False,'export_force_sampling':False,
        'export_optimize_animation_size':False,'export_skins':True,'export_all_influences':True,
        'export_def_bones':False,'export_extras':True,'export_tangents':True}
    assert bpy.ops.export_scene.gltf(**desired)=={'FINISHED'}
    raw=target.read_bytes(); length,kind=struct.unpack_from('<II',raw,12); assert kind==0x4e4f534a
    gltf=json.loads(raw[20:20+length]); assert len(gltf.get('animations',[]))==2 and gltf.get('skins')
    # Source records encode an independent skinning inverse bind which Blender
    # EditBone normalizes. Retain that original matrix in the final GLB, with only
    # the documented Z-up -> Y-up vertex permutation, not a reconstructed inverse.
    # Blender keeps joint local bases in Source coordinates: jointWorld=C*P,
    # vertex'=C*v, hence IBM'=sourceIBM*inverse(C), NOT C*IBM*inverse(C).
    assert armature.matrix_world==Matrix.Identity(4)
    assert all(obj.matrix_world==Matrix.Identity(4) for obj in container.objects)
    conversion=Matrix(((1,0,0,0),(0,0,1,0),(0,-1,0,0),(0,0,0,1)))
    source_bones={bone.name:bone for bone in primary.bones}
    binary_start=20+length+8
    assert struct.unpack_from('<I',raw,20+length+4)[0]==0x004e4942
    payload=bytearray(raw); max_patch=0.0; matrix_count=0
    for skin in gltf['skins']:
        accessor=gltf['accessors'][skin['inverseBindMatrices']]; view=gltf['bufferViews'][accessor['bufferView']]
        assert accessor['componentType']==5126 and accessor['type']=='MAT4' and accessor['count']==len(skin['joints'])
        stride=view.get('byteStride',64); assert stride>=64
        for i,joint in enumerate(skin['joints']):
            bone=source_bones[gltf['nodes'][joint]['name']]
            original=Matrix([list(row) for row in bone.pose_to_bone.T]+[[0,0,0,1]])
            converted=original@conversion.inverted()
            values=[converted[r][c] for c in range(4) for r in range(4)]
            offset=binary_start+view.get('byteOffset',0)+accessor.get('byteOffset',0)+i*stride
            previous=struct.unpack_from('<16f',payload,offset)
            max_patch=max(max_patch,max(abs(a-b) for a,b in zip(previous,values)))
            assert max(abs(a-b) for a,b in zip(previous,values))<.01, 'Unexpected GLB mesh/skin coordinate frame'
            struct.pack_into('<16f',payload,offset,*values)
            assert tuple(values)==struct.unpack_from('<16f',payload,offset)
            matrix_count+=1
    target.write_bytes(payload); raw=target.read_bytes(); assert raw==payload
    REPORT['exactInverseBindRestore']={'matrices':matrix_count,'maxPatchDeltaSourceUnits':max_patch,
        'maxReadbackError':0.0,'coordinateTransform':'source.pose_to_bone * inverse(C), jointWorld=C*sourceBoneWorld, C:(x,y,z)->(x,z,-y)',
        'meshAndArmatureWorldIdentity':True}
    REPORT['glb']={'file':target.name,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),
        'animations':[a['name'] for a in gltf['animations']],'skins':len(gltf['skins']),
        'joints':[len(s['joints']) for s in gltf['skins']],'materials':len(gltf.get('materials',[])),'images':len(gltf.get('images',[]))}
    REPORT['limitations']+=['Only the model-authored testIdle/testWalkN clips exported; these are not the complete combat Idle/Walk/Run/Crouch/Fire/Reload state machine.',
        'SourceIO material conversion is not original Source shader equivalence.',
        'Missing taunt_animations.mdl remains an explicit incomplete include branch.',
        'Source Z-up to glTF Y-up coordinate conversion by Blender; physical unit remains uncalibrated.']
    REPORT['status']='passed_source_and_blender_checks'; save('export complete'); SourceIO.unregister()


if __name__=='__main__':
    try: main()
    except Exception:
        REPORT['status']='failed'; REPORT['error']=traceback.format_exc(); save('failed'); raise
