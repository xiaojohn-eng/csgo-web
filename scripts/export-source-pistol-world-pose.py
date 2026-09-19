"""All original pistol world descriptors, 9way axes, masks and 24B layers.
No animation baking; no per-state or per-mode pose replacement.
"""
from pathlib import Path
import hashlib,importlib.util,json,sys
import numpy as np
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'.reference-assets/source-exports/pistol-candidates'
sys.path.insert(0,str(ROOT/'.tools'))
from SourceIO.library.shared.app_id import SteamAppId
from SourceIO.library.shared.content_manager.providers.vpk_provider import VPKContentProvider
from SourceIO.library.utils import TinyPath,MemoryBuffer
from SourceIO.library.models.mdl.v49 import MdlV49
from SourceIO.library.models.mdl.structs.local_animation import StudioAnimDesc,AnimBoneFlags
provider=VPKContentProvider(TinyPath(ROOT/'.reference-assets/csgo-legacy/csgo/pak01_dir.vpk'),SteamAppId.COUNTER_STRIKE_GO)
spec=importlib.util.spec_from_file_location('pistol_world_pose_sections',ROOT/'scripts/source-section-decoder.py');section=importlib.util.module_from_spec(spec);spec.loader.exec_module(section);observations=[];section.install_source_section_decoder(observations)
old_rot,old_pos=StudioAnimDesc._read_anim_rot_value,StudioAnimDesc._read_anim_pos_value
def read_rot(desc,data,flags,count,base_quat,base_rot,scale):return old_rot(desc,data,flags,count,(0,0,0,1)if flags&AnimBoneFlags.ANIM_DELTA else base_quat,(0,0,0)if flags&AnimBoneFlags.ANIM_DELTA else base_rot,scale)
def read_pos(desc,data,flags,count,base_pos,scale):return old_pos(desc,data,flags,count,(0,0,0)if flags&AnimBoneFlags.ANIM_DELTA else base_pos,scale)
StudioAnimDesc._read_anim_rot_value,StudioAnimDesc._read_anim_pos_value=read_rot,read_pos
C=np.array([[1,0,0,0],[0,0,1,0],[0,-1,0,0],[0,0,0,1]],dtype=np.float64);inventory=json.loads((BASE/'inventory.json').read_text())
for weapon in ['glock','usp']:
 entry=next(w for w in inventory['weapons']if w['id']==('4'if weapon=='glock'else'61'));meta=next(m for m in entry['models']if m['role']=='model_world');raw=provider.find_file(TinyPath(meta['path'])).read();assert hashlib.sha256(raw).hexdigest()==meta['source']['sha256'];buffer=MemoryBuffer(raw);mdl=MdlV49.from_buffer(buffer);bones=[]
 for b in mdl.bones:
  inverse=np.eye(4);inverse[:3]=b.pose_to_bone.T;bones.append(dict(name=b.name,parent=b.parent_id,position=list(b.position),quaternion=list(b.quat),flags=int(b.flags),alignment=list(b.q_alignment),inverseBindSource=inverse.T.flatten().tolist(),inverseBindGltf=np.asarray(inverse@C.T,dtype=np.float32).T.flatten().tolist()))
 values=[];records=[];offset=0;native={}
 for i,desc in enumerate(mdl.anim_descs):
  assert desc.animblock_id==0 and desc.local_hierarchy_count==0;decoded=desc.read_animations(buffer,mdl.bones);delta=bool(int(desc.flags)&4)
  p=np.zeros((desc.frame_count,len(bones),3));q=np.zeros((desc.frame_count,len(bones),4));q[:,:,3]=1
  if not delta:p[:]=[b.position for b in mdl.bones];q[:]=[b.quat for b in mdl.bones]
  if decoded is None:assert desc.animblock_offset==0 and desc.frame_count==1 and delta
  else:
   for j,b in enumerate(mdl.bones):
    if b.name in decoded:p[:,j]=decoded[b.name]['pos'];q[:,j]=decoded[b.name]['rot']
  length=np.linalg.norm(q,axis=-1);assert np.isfinite(p).all()and np.isfinite(q).all()and np.min(length)>.99;q/=length[...,None]
  rec=dict(index=i,name=desc.name,fps=desc.fps,frames=desc.frame_count,flags=int(desc.flags),delta=delta,ikRules=desc.ikrule_count,movements=desc.movement_count,zeroAnimationOffset=desc.animblock_offset==0)
  for field,array in [('positions',p),('quaternions',q)]:
   array=np.asarray(array,dtype='<f8');rec[field+'Offset']=offset;rec[field+'Count']=array.size;rec[field+'SHA256']=hashlib.sha256(array.tobytes()).hexdigest();offset+=array.size;values.append(array.tobytes());native[f'{i}_{field}']=array
  records.append(rec)
 out=BASE/f'{weapon}-world/continuous';out.mkdir(exist_ok=True);binary=b''.join(values);(out/'frames.f64.bin').write_bytes(binary);np.savez_compressed(out/'original-frames.npz',**native)
 result=dict(format='source-pistol-world-pose-v1',weaponId=weapon,sourceModel=meta['path'],sourceSHA256=meta['source']['sha256'],bones=bones,poseParameters=meta['poseParameters'],sequences=meta['sequences'],descriptors=records,frames=dict(file='frames.f64.bin',encoding='float64-little-endian',byteLength=len(binary),sha256=hashlib.sha256(binary).hexdigest()),bodyparts=meta['bodyparts'],attachments=meta['attachments'],autoLayerEvidence='output/tests/source-pistol-autolayers-native.json',rootMotionPolicy='Preserve original local transforms; no automatic movement/IK extraction')
 data=(json.dumps(result,separators=(',',':'),default=lambda v:v.tolist())+'\n').encode();(out/'pose-data.json').write_bytes(data);manifest=dict(status='exact-original-world-frames-exported',jsonSHA256=hashlib.sha256(data).hexdigest(),binarySHA256=result['frames']['sha256'],bones=len(bones),sequences=len(meta['sequences']),descriptors=len(records),frames=sum(d['frames']for d in records),sections=observations);(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print('WORLD_POSE',weapon,manifest)
