"""Original standalone M4A4 world skin and source default/fire/crouch-fire clips.
No character combination or AK animation graph substitution is performed.
"""
from pathlib import Path
import ast
import json
import struct
import sys
import hashlib
import importlib.util
def world_prepare(primary,find,cm,model_path,animation_data,report):
 import numpy as np
 from SourceIO.library.models.mdl.structs.local_animation import StudioAnimDesc,AnimBoneFlags,ANIM_DTYPE
 from SourceIO.library.models.mdl.load_animations import AnimationData
 raw=find(model_path);assert raw is not None
 old_rot,old_pos=StudioAnimDesc._read_anim_rot_value,StudioAnimDesc._read_anim_pos_value
 def read_rot(desc,data,flags,count,base_quat,base_rot,scale):
  if flags&AnimBoneFlags.ANIM_DELTA:base_quat=(0,0,0,1);base_rot=(0,0,0)
  return old_rot(desc,data,flags,count,base_quat,base_rot,scale)
 def read_pos(desc,data,flags,count,base_pos,scale):
  return old_pos(desc,data,flags,count,(0,0,0)if flags&AnimBoneFlags.ANIM_DELTA else base_pos,scale)
 StudioAnimDesc._read_anim_rot_value,StudioAnimDesc._read_anim_pos_value=read_rot,read_pos
 spec=importlib.util.spec_from_file_location('m4_world_math',ROOT/'scripts/source-character-animation.py');math=importlib.util.module_from_spec(spec);spec.loader.exec_module(math)
 rows=[];values={};raw_frames={}
 try:
  for seq in primary.sequences:
   assert seq.blend_count==1 and not seq.auto_layers
   index=seq.anim_desc_indices[0];desc=primary.anim_descs[index];assert desc.animblock_id==0
   decoded=desc.read_animations(raw,primary.bones);assert decoded is not None
   p=np.zeros((desc.frame_count,len(primary.bones),3));q=np.zeros((desc.frame_count,len(primary.bones),4));q[:,:,3]=1
   if not int(desc.flags)&4:p[:]=[b.position for b in primary.bones];q[:]=[b.quat for b in primary.bones]
   for i,b in enumerate(primary.bones):
    if b.name in decoded:p[:,i]=decoded[b.name]['pos'];q[:,i]=decoded[b.name]['rot']
   zero=np.argwhere(np.linalg.norm(q,axis=-1)<1e-10)
   assert not len(zero), {'sequence':seq.name,'descriptor':desc.name,'sectionFrames':desc.section_frame_count,'zero':[(int(f),primary.bones[int(b)].name)for f,b in zero[:12]]}
   q=math.normalize(q);assert np.isfinite(p).all()and np.isfinite(q).all()
   weights=seq.get_bone_weights(raw,len(primary.bones));raw_frames[seq.name]=(p,q)
   values[seq.name+'_positions']=p;values[seq.name+'_quaternions']=q
   rows.append({'name':seq.name,'descriptorIndex':index,'frames':desc.frame_count,'fps':desc.fps,'descriptorFlags':int(desc.flags),'sequenceFlags':seq.flags,'weights':weights})
  basep,baseq=raw_frames['default']
  for seq in primary.sequences:
   index=seq.anim_desc_indices[0];desc=primary.anim_descs[index];p,q=(v.copy()for v in raw_frames[seq.name])
   if int(desc.flags)&4:
    assert seq.flags==20 and seq.name=='rifle_fire','Unreviewed delta/post branch'
    weights=np.array(next(r['weights']for r in rows if r['name']==seq.name));active=weights>0
    absolute_p=np.repeat(basep[:1],desc.frame_count,axis=0);absolute_q=np.repeat(baseq[:1],desc.frame_count,axis=0)
    for frame in range(desc.frame_count):
     absolute_p[frame,active]+=p[frame,active]*weights[active,None]
     absolute_q[frame,active]=math.multiply(absolute_q[frame,active],math.quaternion_scale(q[frame,active],weights[active]))
    p,q=absolute_p,math.normalize(absolute_q)
   frames={}
   for i,b in enumerate(primary.bones):
    data=np.zeros(desc.frame_count,ANIM_DTYPE);data['pos']=p[:,i];data['rot']=q[:,i];frames[b.name]=data
   animation_data[f'{model_path}#{index}']=AnimationData(desc.name,desc.fps,desc.frame_count,list(frames),frames,False,False)
  np.savez_compressed(OUT/'world-original-frames.npz',**values)
  report['worldOriginalSequences']=rows
  report['worldDeltaComposition']='rifle_fire: original flags20 delta/post, default base + boneWeights, QuaternionScale then right-multiply; no closed character AnimState/IK claim'
 finally:StudioAnimDesc._read_anim_rot_value,StudioAnimDesc._read_anim_pos_value=old_rot,old_pos
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.reference-assets/source-exports/m4a4/world';OUT.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(ROOT/'.tools'))
import SourceIO
section_spec=importlib.util.spec_from_file_location('m4_world_sections',ROOT/'scripts/source-section-decoder.py')
section_module=importlib.util.module_from_spec(section_spec);section_spec.loader.exec_module(section_module)
section_observations=[];section_module.install_source_section_decoder(section_observations)
original=ROOT/'scripts/import-source-weapon.py';source=original.read_text();tree=ast.parse(source)
category=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='category')
replacement=ast.parse('def category(sequence):\n    return {"default":"idle", "rifle_fire":"fire", "rifle_reload":"reload", "rifle_reload_moving":"reload_moving", "rifle_reload_crouch":"reload_crouch", "rifle_reload_crouch_moving":"reload_crouch_moving"}.get(sequence.name)\n').body[0]
tree.body[tree.body.index(category)]=replacement
source=ast.unparse(tree)
changes=[
 ("for kind in ('idle', 'fire', 'reload', 'inspect'):","for kind in ('idle', 'fire', 'reload', 'reload_moving', 'reload_crouch', 'reload_crouch_moving'):"),
 ("len(gltf.get('animations', [])) == 4","len(gltf.get('animations', [])) == 6"),
 ('animation.frame_count > 1','animation.frame_count >= 1'),
 ("    checkpoint('source_graph_and_sequences')","    checkpoint('source_graph_and_sequences')\n    world_prepare(primary,find,cm,model_path,animation_data,report)"),
 ('    raw_find = cm.find_file\n','    raw_find = cm.find_file\n    raw_check = cm.check\n    cm.check = lambda path: raw_check(TinyPath(str(path).replace(chr(92), "/").lower()))\n'),
 ('        path = TinyPath(path)\n','        path = TinyPath(path)\n        if not path.is_absolute(): path = TinyPath(str(path).replace(chr(92), "/").lower())\n'),
]
for token,value in changes:
 assert source.count(token)==1,token
 source=source.replace(token,value)
sys.argv=[sys.argv[0],'--background','--factory-startup','--','--confirmed-complete','--model','models/weapons/w_rif_m4a1.mdl','--export-glb','--output-dir',str(OUT)]
exec(compile(ast.parse(source),str(original),'exec'),{'__file__':str(original),'__name__':'__main__','world_prepare':world_prepare})
import numpy as np
audit=json.loads((OUT/'audit.json').read_text());path=Path(audit['glb']['path']);payload=bytearray(path.read_bytes());size=struct.unpack_from('<I',payload,12)[0]
doc=json.loads(payload[20:20+size]);assert len(doc['skins'])==1
skin=doc['skins'][0];a=doc['accessors'][skin['inverseBindMatrices']];v=doc['bufferViews'][a['bufferView']]
assert not v.get('byteStride')and a['type']=='MAT4'and a['componentType']==5126
offset=28+size+v.get('byteOffset',0)+a.get('byteOffset',0);bones={b['name']:b for b in audit['bones']}
ci=np.array([[1,0,0,0],[0,0,-1,0],[0,1,0,0],[0,0,0,1]],dtype=np.float64);maximum=0
for i,joint in enumerate(skin['joints']):
 b=bones[doc['nodes'][joint]['name']];matrix=np.vstack([np.asarray(b['pose_to_bone']).T,[0,0,0,1]])
 expected=np.asarray(matrix@ci,dtype='<f4').flatten(order='F');old=np.frombuffer(payload,dtype='<f4',count=16,offset=offset+i*64).copy()
 maximum=max(maximum,float(np.abs(old-expected).max()));assert maximum<.01
 payload[offset+i*64:offset+(i+1)*64]=expected.tobytes()
# The default VMT has no normal map. SourceIO-generated tangents contain nine
# zero vectors on UV-degenerate corners. Retain their original accessor/bytes
# as evidence, but do not advertise an invalid, unused glTF TANGENT semantic.
removed=[]
for mi,mesh in enumerate(doc['meshes']):
 for pi,primitive in enumerate(mesh['primitives']):
  if 'TANGENT' in primitive['attributes']:
   assert 'normalTexture' not in doc['materials'][primitive['material']]
   removed.append({'mesh':mi,'primitive':pi,'accessor':primitive['attributes'].pop('TANGENT')})
encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
binary=bytes(payload[28+size:]);payload=bytearray(struct.pack('<III',0x46546c67,2,28+len(encoded)+len(binary))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+binary)
audit['unusedTangents']={'removedSemantics':removed,'rawAccessorBytesRetained':True,'reason':'No source normal map; exporter zero tangents on UV-degenerate corners are invalid optional glTF attributes.'}
path.write_bytes(payload);audit['glb']['bytes']=len(payload);audit['glb']['sha256']=hashlib.sha256(payload).hexdigest();audit['exactInverseBind']={'count':len(skin['joints']),'formula':'rawSourceIBM * inverse(C)','beforeMaximum':maximum,'afterFloat32Error':0}
audit['sectionDecoder']=section_observations
(OUT/'audit.json').write_text(json.dumps(audit,indent=2,ensure_ascii=False)+'\n')
print('M4A4_WORLD_EXPORT',json.dumps({'sha256':audit['glb']['sha256'],'bones':len(skin['joints']),'clips':list(audit['clip_checks'])}))
