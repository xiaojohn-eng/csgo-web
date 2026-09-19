"""Source-anchored private T AK pose sampler, called by import-source-character.py.
Does not claim to reconstruct the closed CS:GO client animation state machine.
"""
from __future__ import annotations
import hashlib
import json
import math
import numpy as np


def sample_combat(primary,parsed,buffers,cm,report,out):
    from SourceIO.library.models.mdl.load_animations import _resolve_ani_file, _get_block_table
    from SourceIO.library.models.mdl.structs.local_animation import StudioAnimDesc,AniBoneFlags,ANIM_DTYPE
    from SourceIO.library.models.mdl.structs.frame_anim import StudioFrameAnim
    from SourceIO.library.models.mdl.structs.compressed_vectors import Quat48,Quat48S
    from SourceIO.library.utils import TinyPath
    source='models/player/t_animations.mdl'; mdl=parsed[source]; buffer=buffers[source]
    primary_names={b.name:b for b in primary.bones}; source_names={b.name:b for b in mdl.bones}
    shared=primary_names.keys()&source_names.keys()
    for name in shared:
        a,b=primary_names[name],source_names[name]
        assert (primary.bones[a.parent_id].name if a.parent_id>=0 else None)==(mdl.bones[b.parent_id].name if b.parent_id>=0 else None),'Shared bone parent mismatch requires explicit virtual-model remapping'
    report['animationBoneMapping']={'sharedByName':len(shared),'mainOnly':sorted(primary_names.keys()-shared),
        'animationOnly':sorted(source_names.keys()-shared),'sharedParentsMatchByName':True,
        'strategy':'Decode all animation-MDL bones in its own order; map 69 shared names; preserve main-only weapon_hand_L/R local rest; skip two animation-only helper roots'}
    report['frameDecoder']={'scope':'FRAMEANIM constant + dynamic channels; delta defaults identity/zero, absolute defaults own-MDL rest',
        'sourceioFilesModified':False,'observations':[]}
    def decode(desc,data,bones,count):
        start=data.tell(); header=StudioFrameAnim.from_buffer(data)
        flags=[AniBoneFlags(data.read_uint8()) for _ in bones]
        frames={}
        for bone in bones:
            values=np.zeros(count,ANIM_DTYPE)
            values['rot']=(0,0,0,1) if int(desc.flags)&4 else bone.quat
            if not int(desc.flags)&4: values['pos']=bone.position
            frames[bone.name]=values
        constant_bytes=0
        if header.constant_offset:
            data.seek(start+header.constant_offset)
            for bone,flag in zip(bones,flags):
                values=frames[bone.name]
                if flag&AniBoneFlags.CONST_ROT2:values['rot']=Quat48S.read(data)
                if flag&AniBoneFlags.RAW_ROT:values['rot']=Quat48.read(data)
                if flag&AniBoneFlags.RAW_POS:values['pos']=data.read_fmt('3e')
                if flag&AniBoneFlags.CONST_POS2:values['pos']=data.read_fmt('3f')
            constant_bytes=data.tell()-start-header.constant_offset
        consumed=set()
        if header.frame_offset and header.frame_length:
            for i in range(count):
                frame_start=start+header.frame_offset+i*header.frame_length;data.seek(frame_start)
                for bone,flag in zip(bones,flags):
                    values=frames[bone.name]
                    if flag&AniBoneFlags.ANIM_ROT2:values[i]['rot']=Quat48S.read(data)
                    if flag&AniBoneFlags.ANIM_ROT:values[i]['rot']=Quat48.read(data)
                    if flag&AniBoneFlags.ANIM_POS:values[i]['pos']=data.read_fmt('3e')
                    if flag&AniBoneFlags.FULL_ANIM_POS:values[i]['pos']=data.read_fmt('3f')
                consumed.add(data.tell()-frame_start)
                assert data.tell()-frame_start==header.frame_length,'Unaccounted dynamic channel bytes'
        else:assert not header.frame_length
        report['frameDecoder']['observations'].append({'name':desc.name,'delta':bool(int(desc.flags)&4),'frames':count,
            'constantOffset':header.constant_offset,'constantBytes':constant_bytes,'frameOffset':header.frame_offset,
            'frameLength':header.frame_length,'consumedFrameLengths':sorted(consumed),'flags':sorted(set(map(int,flags)))})
        return frames
    StudioAnimDesc._read_frame_animations=decode
    sequences=[s for s in report['sequences'] if s['sourceModel']==source]
    indexed={s['index']:s for s in sequences}
    lower={'Idle_lower','Run_lower','walk_lower','Crouch_Idle_Lower','Crouch_walk_lower'}
    selected={s['index'] for s in sequences if s['name'] in lower or ('AK' in s['name'] and any(word in s['name'] for word in ('Aim','HandPos','Upper','Shoot','Reload')))}
    pending=list(selected)
    while pending:
        for layer in indexed[pending.pop()]['autoLayers']:
            if layer['sequence_id'] not in selected:selected.add(layer['sequence_id']);pending.append(layer['sequence_id'])
    chosen=[indexed[i] for i in sorted(selected)]
    keys=sorted({n for s in chosen for n in s['animationIndices']})
    ani=_resolve_ani_file(mdl,cm,TinyPath(source));assert ani is not None
    blocks=_get_block_table(mdl,buffer);raw_frames={};descriptors=[]
    for key in keys:
        desc=mdl.anim_descs[key]
        assert int(desc.flags)&64,'This pass accepts FRAMEANIM only'
        assert desc.local_hierarchy_count==0,'Local hierarchy overrides need a separate audit'
        values=desc.read_animations(buffer,mdl.bones,ani.buffer,blocks);assert values is not None
        positions=np.stack([values[b.name]['pos'] for b in mdl.bones],axis=1).astype(np.float64)
        rotations=np.stack([values[b.name]['rot'] for b in mdl.bones],axis=1).astype(np.float64)
        assert positions.shape==(desc.frame_count,len(mdl.bones),3)
        assert np.isfinite(positions).all() and np.isfinite(rotations).all()
        lengths=np.linalg.norm(rotations,axis=-1);assert np.min(lengths)>.99 and np.max(lengths)<1.01
        raw_frames[key]=(positions,rotations/lengths[...,None])
        descriptors.append({'index':key,'name':desc.name,'fps':desc.fps,'frames':desc.frame_count,'flags':int(desc.flags),
            'delta':bool(int(desc.flags)&4),'maxQuaternionNormError':float(np.max(np.abs(lengths-1))),
            'ikRules':desc.ikrule_count,'movements':desc.movement_count,'sections':len(desc.get_sections(buffer))})
    folder=out/'combat';folder.mkdir(exist_ok=True)
    packed={f'anim_{key}_{kind}':data for key,pair in raw_frames.items() for kind,data in zip(('positions','quaternions'),pair)}
    np.savez_compressed(folder/'decoded-frames.npz',**packed)
    metadata={'sourceModel':source,'boneNames':[b.name for b in mdl.bones],
        'poseParameters':next(m['poseParameters'] for m in report['models'] if m['path']==source),
        'sequences':chosen,'descriptors':descriptors,'frameFile':'decoded-frames.npz'}
    (folder/'source-animation-metadata.json').write_text(json.dumps(metadata,indent=2)+'\n')
    report['combatDecoded']={'sequences':len(chosen),'descriptors':len(keys),'frames':sum(d['frames'] for d in descriptors),
        'frameFile':str(folder/'decoded-frames.npz'),'sha256':hashlib.sha256((folder/'decoded-frames.npz').read_bytes()).hexdigest(),
        'metadataFile':str(folder/'source-animation-metadata.json')}
    report['status']='passed_selected_frame_decode'
    print('SOURCE_CHARACTER_DECODED',json.dumps(report['combatDecoded']),flush=True)
    sample_poses(primary,mdl,metadata,raw_frames,report,folder)


def sample_poses(primary,mdl,metadata,raw_frames,report,folder):
    from mathutils import Matrix,Quaternion,Vector
    engine=PoseSampler(mdl,metadata,raw_frames)
    corners=0;max_corner_pos=0.0;max_corner_rotation=0.0
    for seq in metadata['sequences']:
        if seq['groupSize']!=[3,3]:continue
        xkeys,ykeys=seq['poseKeys'][:3],seq['poseKeys'][3:]
        for y,yvalue in enumerate(ykeys):
            for x,xvalue in enumerate(xkeys):
                params={metadata['poseParameters'][seq['parameterIndices'][0]]['name']:xvalue,
                        metadata['poseParameters'][seq['parameterIndices'][1]]['name']:yvalue}
                for cycle in (0,.23,.51,.97):
                    expected=engine.frame(seq['animationIndices'][x+y*3],cycle)
                    for mode in ('sdk-3way','sdk-bilinear'):
                        actual=engine.calc(seq,cycle,params,mode)
                        max_corner_pos=max(max_corner_pos,float(np.max(np.abs(actual[0]-expected[0]))))
                        max_corner_rotation=max(max_corner_rotation,float(np.max(1-np.abs(np.sum(actual[1]*expected[1],axis=1)))))
                        corners+=1
    assert max_corner_pos<1e-10 and max_corner_rotation<1e-10
    states=[('Idle_lower','Idle'),('walk_lower','Walk'),('Run_lower','Run'),
            ('Crouch_Idle_Lower','Crouch_Idle'),('Crouch_walk_lower','Crouch_Walk')]
    directions=[(0,0),(1,0),(-1,0),(0,1),(0,-1),(.707,.707),(.707,-.707),(-.707,.707),(-.707,-.707)]
    aims=[(0,0),(20,25),(-35,-45)]
    primary_map={b.name:i for i,b in enumerate(primary.bones)}
    source_map={b.name:i for i,b in enumerate(mdl.bones)}
    stored=[];samples=0;norm_error=0.0;zero_weight_error=0.0;zero_mask_error=0.0
    min_bound=np.full(3,np.inf);max_bound=-min_bound;mode_delta=0.0;mode_world_delta=0.0;mode_rotation_delta=0.0;mode_worst=None
    shared_indices=[i for i,b in enumerate(mdl.bones) if b.name in primary_map]
    def primary_worlds(pose):
        matrices=[]
        for bone in primary.bones:
            if bone.name in source_map:
                i=source_map[bone.name];pos,rot=pose[0][i],pose[1][i]
            else:pos,rot=bone.position,bone.quat
            x,y,z,w=rot;local=Matrix.LocRotScale(Vector(pos),Quaternion((w,x,y,z)),(1,1,1))
            matrices.append(matrices[bone.parent_id]@local if bone.parent_id>=0 else local)
        return matrices
    for lower,state in states:
        upper=engine.named[state+'_Upper_AK'];shot=engine.named[state+'_Shoot_AK']
        for dx,dy in directions:
            for yaw,pitch in aims:
                params={'move_x':dx,'move_y':dy,'body_yaw':yaw,'body_pitch':pitch}
                for cycle in (0,.23,.51,.97):
                    modes={}
                    for mode in ('sdk-3way','sdk-bilinear'):
                        base=engine.accumulate(engine.rest,engine.named[lower],cycle,1,params,mode)
                        held=engine.accumulate(base,upper,cycle,1,params,mode)
                        identity=engine.accumulate(held,shot,cycle,0,params,mode)
                        zero_weight_error=max(zero_weight_error,float(np.max(np.abs(identity[0]-held[0]))),float(np.max(np.abs(identity[1]-held[1]))))
                        for fire_weight in (0,.5,1):
                            pose=engine.accumulate(held,shot,cycle,fire_weight,params,mode)
                            assert np.isfinite(pose[0]).all() and np.isfinite(pose[1]).all()
                            norm_error=max(norm_error,float(np.max(np.abs(np.linalg.norm(pose[1],axis=1)-1))))
                            mask=np.array(shot['boneWeights'])==0
                            zero_mask_error=max(zero_mask_error,float(np.max(np.abs(pose[0][mask]-held[0][mask]))),float(np.max(np.abs(pose[1][mask]-held[1][mask]))))
                            matrices=primary_worlds(pose)
                            points=np.array([list(m.translation) for m in matrices]);min_bound=np.minimum(min_bound,points.min(axis=0));max_bound=np.maximum(max_bound,points.max(axis=0))
                            samples+=1
                            if dx==0 and dy in (0,1) and yaw==20 and cycle in (.23,.51) and fire_weight==1:
                                stored.append({'state':state,'params':params,'cycle':cycle,'fireWeight':fire_weight,'blendMode':mode,
                                    'boneWorldMatrices':{b.name:[list(row) for row in matrices[i]] for i,b in enumerate(primary.bones)}})
                        modes[mode]={'position':pose[0],'rotation':pose[1],'world':points}
                    a,b=modes['sdk-3way'],modes['sdk-bilinear']
                    difference=np.linalg.norm(a['position'][shared_indices]-b['position'][shared_indices],axis=1)
                    mode_delta=max(mode_delta,float(np.max(difference)))
                    angles=2*np.arccos(np.clip(np.abs(np.sum(a['rotation'][shared_indices]*b['rotation'][shared_indices],axis=1)),0,1))
                    mode_rotation_delta=max(mode_rotation_delta,float(np.max(angles)))
                    world_difference=np.linalg.norm(a['world']-b['world'],axis=1)
                    if float(np.max(world_difference))>mode_world_delta:
                        mode_world_delta=float(np.max(world_difference));which=int(np.argmax(world_difference))
                        mode_worst={'state':state,'parameters':params,'cycle':cycle,'bone':primary.bones[which].name,'sourceUnits':mode_world_delta}
    assert zero_weight_error==0 and zero_mask_error==0 and norm_error<1e-12
    result={'status':'passed_bounded_source_sampling','samples':samples,'sourceFrameCornerComparisons':corners,
        'maxCornerPositionError':max_corner_pos,'maxCornerQuaternionDotError':max_corner_rotation,
        'maxQuaternionNormError':norm_error,'zeroShotWeightError':zero_weight_error,'zeroBoneMaskError':zero_mask_error,
        'sampledJointBounds':{'min':min_bound.tolist(),'max':max_bound.tolist()},
        'max3WayVsBilinearSharedBoneLocalPositionDifference':mode_delta,
        'max3WayVsBilinearSharedBoneRotationDifferenceRadians':mode_rotation_delta,
        'max3WayVsBilinearMainBoneWorldPositionDifference':mode_world_delta,'worstModeDifference':mode_worst,'storedPoseSamples':len(stored),
        'algorithms':{'temporal':'normalized quaternion linear interpolation; original encoded Source frames',
            'intraSequence':'SDK BlendBones normalized-linear quaternions, 3way and bilinear variants retained',
            'accumulation':'SDK SlerpBones, per-bone weights; STUDIO_DELTA/POST quaternion multiplication plus additive local positions',
            'layers':'raw 24B auto-layer targets, default cycle ramps and original order; only observed flags=0 supported'},
        'limitations':['Source SDK2013 composition reference is not the closed CS:GO client state machine.',
            'Actual legacy anim_3wayblend runtime cvar is not verified; both public SDK branches are evaluated, neither silently claimed as original client output.',
            'No IK locks/rules, world/procedural bones, movement extraction, client activity transitions or current network authority integration.',
            'Snapshots are explicitly selected lower+AK upper+fire layer compositions, not a claim of exact closed-client playback.']}
    (folder/'sampled-poses.json').write_text(json.dumps({'summary':result,'samples':stored},indent=2)+'\n')
    report['combatSampling']=result;report['status']='passed_bounded_combat_sampling'
    print('SOURCE_CHARACTER_MIXED',json.dumps(result),flush=True)


def normalize(q):
    length=np.linalg.norm(q,axis=-1,keepdims=True);assert np.min(length)>1e-10
    return q/length


def blend_quats(a,b,t,align=True,spherical=False):
    t=np.asarray(t);t=np.broadcast_to(t,(len(a),))[...,None]
    dot=np.sum(a*b,axis=1,keepdims=True)
    flip=(dot<0)&np.broadcast_to(np.asarray(align), (len(a),))[...,None]
    b=np.where(flip,-b,b);dot=np.clip(np.sum(a*b,axis=1,keepdims=True),-1,1)
    if not spherical:return normalize(a*(1-t)+b*t)
    assert np.min(dot)>-1+1e-6,'Opposite fixed-alignment slerp needs SDK special branch'
    angle=np.arccos(dot);sine=np.sin(angle);regular=1-dot>1e-6
    safe=np.where(regular,sine,1)
    p=np.where(regular,np.sin((1-t)*angle)/safe,1-t);q=np.where(regular,np.sin(t*angle)/safe,t)
    return normalize(p*a+q*b)


def multiply(a,b):
    xyz=a[:,3:]*b[:,:3]+b[:,3:]*a[:,:3]+np.cross(a[:,:3],b[:,:3])
    w=a[:,3]*b[:,3]-np.sum(a[:,:3]*b[:,:3],axis=1)
    return normalize(np.column_stack((xyz,w)))


def quaternion_scale(q,t):
    # Valve mathlib_base.cpp QuaternionScale; not assumed rough linear rotation.
    sine=np.minimum(np.linalg.norm(q[:,:3],axis=1),1)
    scaled=np.sin(np.arcsin(sine)*t);factor=scaled/(sine+np.finfo(np.float32).eps)
    w=np.sqrt(np.maximum(0,1-scaled*scaled))*np.where(q[:,3]<0,-1,1)
    return np.column_stack((q[:,:3]*factor[:,None],w))


class PoseSampler:
    def __init__(self,mdl,metadata,frames):
        self.mdl=mdl;self.frames=frames;self.named={s['name']:s for s in metadata['sequences']}
        self.indexed={s['index']:s for s in metadata['sequences']};self.params=metadata['poseParameters']
        self.desc={d['index']:d for d in metadata['descriptors']}
        self.rest=(np.array([b.position for b in mdl.bones],dtype=float),normalize(np.array([b.quat for b in mdl.bones],dtype=float)))
        self.fixed=np.array([bool(int(b.flags)&0x100000) for b in mdl.bones])
        alignment=np.array([b.q_alignment for b in mdl.bones],dtype=float)
        alignment[~self.fixed]=(0,0,0,1) # unused q_alignment may legally be zero
        self.alignment=normalize(alignment)

    def frame(self,index,cycle):
        p,q=self.frames[index];f=max(0,min(1,cycle))*(len(p)-1);i=int(f);j=min(i+1,len(p)-1);t=f-i
        rot=blend_quats(q[i],q[j],t)
        if not self.desc[index]['delta']:
            flip=self.fixed&(np.sum(self.alignment*rot,axis=1)<0);rot=np.where(flip[:,None],-rot,rot)
        return p[i]*(1-t)+p[j]*t,rot

    def blend(self,a,b,t,seq):
        active=np.array(seq['boneWeights'])>0
        p=a[0].copy();q=a[1].copy()
        p[active]=a[0][active]*(1-t)+b[0][active]*t
        q[active]=blend_quats(a[1][active],b[1][active],t,align=~self.fixed[active])
        return p,q

    def axis(self,seq,axis,parameters):
        size=seq['groupSize'][axis];index=seq['parameterIndices'][axis]
        if size==1 or index<0:return 0,0
        value=parameters.get(self.params[index]['name'],0)
        keys=seq['poseKeys'][sum(seq['groupSize'][:axis]):sum(seq['groupSize'][:axis+1])]
        assert len(keys)==size,'This pass requires explicit pose keys for 2D blends'
        cell=0
        while True:
            frac=(value-keys[cell])/(keys[cell+1]-keys[cell])
            if cell<size-2 and frac>1:cell+=1;continue
            return cell,max(0,min(1,frac))

    def calc(self,seq,cycle,parameters,mode):
        assert not (seq['flags']&(128|256|512|16384)),'Unimplemented cycle-pose/realtime/local/world sequence'
        cycle=cycle%1 if seq['flags']&1 else max(0,min(1,cycle))
        i,x=self.axis(seq,0,parameters);j,y=self.axis(seq,1,parameters);sx,sy=seq['groupSize']
        def fetch(a,b):return self.frame(seq['animationIndices'][min(a,sx-1)+min(b,sy-1)*sx],cycle)
        if x<.001:
            return fetch(i,j) if y<.001 else fetch(i,j+1) if y>.999 else self.blend(fetch(i,j),fetch(i,j+1),y,seq)
        if x>.999:
            return fetch(i+1,j) if y<.001 else fetch(i+1,j+1) if y>.999 else self.blend(fetch(i+1,j),fetch(i+1,j+1),y,seq)
        if y<.001:return self.blend(fetch(i,j),fetch(i+1,j),x,seq)
        if y>.999:return self.blend(fetch(i,j+1),fetch(i+1,j+1),x,seq)
        if mode=='sdk-bilinear':return self.blend(self.blend(fetch(i,j),fetch(i+1,j),x,seq),self.blend(fetch(i,j+1),fetch(i+1,j+1),x,seq),y,seq)
        assert mode=='sdk-3way'
        if (i+j)%2==0:
            offsets,weights=([(0,0),(1,0),(1,1)],[1-x,x-y]) if x>y else ([(1,1),(0,1),(0,0)],[x,y-x])
        else:
            offsets,weights=([(1,0),(1,1),(0,1)],[1-y,x-1+y]) if x+y>1 else ([(0,1),(0,0),(1,0)],[y,1-x-y])
        if weights[1]<.001:weights[1]=0
        weights.append(1-sum(weights));a,b,c=[fetch(i+dx,j+dy) for dx,dy in offsets]
        if weights[1]<.001:return self.blend(a,c,weights[2]/(weights[0]+weights[2]),seq)
        return self.blend(self.blend(a,b,weights[1]/(weights[0]+weights[1]),seq),c,weights[2],seq)

    def accumulate(self,base,seq,cycle,weight,parameters,mode,depth=0):
        assert depth<8 and 0<=weight<=1
        if weight==0:return base[0].copy(),base[1].copy()
        pose=self.calc(seq,cycle,parameters,mode);weights=np.array(seq['boneWeights'])*weight;active=weights>0
        p=base[0].copy();q=base[1].copy()
        if seq['flags']&4:
            scaled=quaternion_scale(pose[1][active],weights[active])
            q[active]=multiply(base[1][active],scaled) if seq['flags']&16 else multiply(scaled,base[1][active])
            p[active]+=pose[0][active]*weights[active,None]
        elif active.any():
            q[active]=blend_quats(base[1][active],pose[1][active],weights[active],align=~self.fixed[active],spherical=True)
            p[active]=p[active]*(1-weights[active,None])+pose[0][active]*weights[active,None]
        for layer in seq['autoLayers']:
            assert layer['flags']==0,'Only observed default automatic layer flags accepted'
            layer_cycle=cycle;layer_weight=weight
            start,peak,tail,end=[layer[k] for k in ('start','peak','tail','end')]
            if start!=end:
                if cycle<start or cycle>=end:continue
                ramp=(cycle-start)/(peak-start) if cycle<peak and start!=peak else (end-cycle)/(end-tail) if cycle>tail and end!=tail else 1
                layer_weight*=ramp;layer_cycle=(cycle-start)/(end-start)
            p,q=self.accumulate((p,q),self.indexed[layer['sequence_id']],layer_cycle,layer_weight,parameters,mode,depth+1)
        return p,q
