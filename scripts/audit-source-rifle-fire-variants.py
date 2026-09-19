"""Bounded read-only App740 audit of the rifles' remaining fire variants.

Both rifles carry three equal-weight sequences for ACT_VM_PRIMARYATTACK, but the
frozen exporter kept only one absolute sequence per category, so the port can only
play the first. This decodes the other two -- and re-decodes the first, so the
append step has something to check itself against -- without writing to any active
asset, owner, manifest or staged file. Only this new private audit directory.

Run: blender --background --factory-startup --python-exit-code 1 --python this_file.py
"""
from pathlib import Path
from dataclasses import asdict
import ast,hashlib,importlib.util,json,math
import numpy as np
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'.reference-assets/source-exports/rifle-fire-variants-audit';OUT.mkdir(parents=True,exist_ok=True);sha=lambda v:hashlib.sha256(v).hexdigest()
spec=importlib.util.spec_from_file_location('rifle_fire_items',ROOT/'scripts/inventory-source-items.py');items=importlib.util.module_from_spec(spec);spec.loader.exec_module(items);context=items.initialize();sources=items.Sources()
from SourceIO.library.utils import MemoryBuffer
from SourceIO.library.models.mdl.v49 import MdlV49
from SourceIO.library.models.mdl.structs.local_animation import StudioAnimDesc,AniBoneFlags,ANIM_DTYPE
from SourceIO.library.models.mdl.structs.frame_anim import StudioFrameAnim
from SourceIO.library.models.mdl.structs.compressed_vectors import Quat48,Quat48S
from SourceIO.library.models.mdl.structs.ani_file import AniFile
from SourceIO.library.models.mdl.load_animations import _get_block_table
# The verified adapter appends its own observations here, exactly as when it shipped.
report={'frame_animation_adapter':{'observations':[]}}
# The two rifles this port ships, the model each one owns, and every sequence the
# model gives ACT_VM_PRIMARYATTACK (read separately by probe-source-weapon-activities.py).
TARGETS=[dict(weapon='vandal',item='7',itemName='weapon_ak47',model='models/weapons/v_rif_ak47.mdl',boneCount=58,
              sequences=['ak47_fire1','ak47_fire2','ak47_fire3'],shipped={'ak47_fire1':'fire__ak47_fire1'}),
         dict(weapon='m4a4',item='16',itemName='weapon_m4a1',model='models/weapons/v_rif_m4a1.mdl',boneCount=57,
              sequences=['shoot1','shoot2','shoot3'],shipped={'shoot1':'fire__shoot1'})]
catalog=json.loads((ROOT/'research/source-items-catalog.json').read_text())
# The sequence-field helpers and the verified CS:GO FRAMEANIM adapter are the same
# ones the shipped exporters used, so a re-decode here is comparable to what shipped.
helpers={'math':math};tree=ast.parse((ROOT/'scripts/import-source-character.py').read_text())
nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name in ['raw_pose_parameters','raw_sequence_fields']]
exec(compile(ast.Module(body=nodes,type_ignores=[]),'original-rifle-sequence-fields','exec'),helpers)
tree=ast.parse((ROOT/'scripts/import-source-weapon.py').read_text());framefn=next(n for n in ast.walk(tree)if isinstance(n,ast.FunctionDef)and n.name=='read_csgo_frame_animation')
exec(compile(ast.Module(body=[framefn],type_ignores=[]),'verified-original-frame-adapter','exec'),globals())
spec=importlib.util.spec_from_file_location('rifle_fire_sections',ROOT/'scripts/source-section-decoder.py');section=importlib.util.module_from_spec(spec);spec.loader.exec_module(section)
arrays={};weapons=[];restore=section.install_source_section_decoder([])
originalFrameReader=StudioAnimDesc._read_frame_animations;StudioAnimDesc._read_frame_animations=read_csgo_frame_animation
try:
 for target in TARGETS:
  item=next(w for w in catalog['weapons']if w['id']==target['item']);assert item['resolvedDefinition']['model_player']==target['model']
  raw=sources.read(target['model']);buffer=MemoryBuffer(raw);old=StudioAnimDesc.read_animations
  try:StudioAnimDesc.read_animations=lambda *a,**k:None;mdl=MdlV49.from_buffer(buffer)
  finally:StudioAnimDesc.read_animations=old
  assert len(mdl.bones)==target['boneCount'],(target['weapon'],len(mdl.bones))
  seqs=[]
  for i,s in enumerate(mdl.sequences):
   descs=[mdl.anim_descs[j]for j in s.anim_desc_indices];seqs.append(dict(index=i,name=s.name,activityName=s.activity_name,flags=s.flags,animationIndices=s.anim_desc_indices,events=[asdict(e)for e in s.events],descriptors=[dict(index=j,name=d.name,frames=d.frame_count,fps=d.fps,flags=int(d.flags),durationSeconds=(d.frame_count-1)/d.fps,sectionFrames=d.section_frame_count,animblock=d.animblock_id)for j,d in zip(s.anim_desc_indices,descs)],**helpers['raw_sequence_fields'](s,mdl,buffer)))
  ani_path=mdl.header.anim_block_name.replace('\\','/').lower();ani=AniFile.from_buffer(MemoryBuffer(sources.read(ani_path)));blocks=_get_block_table(mdl,buffer)
  wanted=[s for s in seqs if s['name']in target['sequences']]
  assert [s['name']for s in wanted]==target['sequences'],(target['weapon'],[s['name']for s in wanted])
  decoded=[]
  for s in wanted:
   assert len(s['animationIndices'])==1 and not s['autoLayers'],(target['weapon'],s['name'],'not a single absolute descriptor')
   d=mdl.anim_descs[s['animationIndices'][0]];assert d.animblock_id>=1 and d.frame_count>1,(target['weapon'],s['name'],'undecodable descriptor')
   frames=d.read_animations(buffer,mdl.bones,ani.buffer,blocks);assert frames is not None,(target['weapon'],s['name'],'no decoded frames')
   p=np.tile(np.array([b.position for b in mdl.bones],dtype=np.float32),(d.frame_count,1,1));q=np.tile(np.array([b.quat for b in mdl.bones],dtype=np.float32),(d.frame_count,1,1))
   for i,bone in enumerate(mdl.bones):
    if bone.name in frames:p[:,i]=frames[bone.name]['pos'];q[:,i]=frames[bone.name]['rot']
   assert np.isfinite(p).all()and np.isfinite(q).all(),(target['weapon'],s['name'],'non finite frames')
   q/=np.linalg.norm(q,axis=-1,keepdims=True)
   key=target['weapon']+'_'+s['name'];arrays[key+'_positions']=p;arrays[key+'_quaternions']=q
   decoded.append(dict(sequence=s['name'],descriptorIndex=s['animationIndices'][0],descriptorName=d.name,animblock=d.animblock_id,descriptorFlags=int(d.flags),sequenceFlags=s['flags'],fps=d.fps,frames=d.frame_count,sectionFrames=d.section_frame_count,boneCount=len(mdl.bones),
     positionsShape=list(p.shape),quaternionsShape=list(q.shape),positionsSHA256=sha(p.tobytes()),quaternionsSHA256=sha(q.tobytes()),
     maximumQuaternionNormDeviation=float(np.max(np.abs(np.linalg.norm(q,axis=-1)-1))),
     events=[dict(e,timeSeconds=e['cycle']*(d.frame_count-1)/d.fps)for e in s['events']],
     shippedClipName=target['shipped'].get(s['name'])))
  weapons.append(dict(weapon=target['weapon'],itemId=target['item'],itemName=item['name'],model=target['model'],sourceMDL=sources.reads[target['model']],sourceANI=sources.reads[ani_path],boneCount=len(mdl.bones),boneNames=[b.name for b in mdl.bones],
    bones=[dict(name=b.name,parent=b.parent_id,position=list(b.position),quaternion=list(b.quat))for b in mdl.bones],
    attachments=[asdict(a)for a in mdl.attachments],allSequenceInventory=seqs,decoded=decoded))
finally:restore();StudioAnimDesc._read_frame_animations=originalFrameReader
np.savez(OUT/'rifle-fire-variant-frames.npz',**arrays)
# An independent readback of every array, by bytes as well as by value.
with np.load(OUT/'rifle-fire-variant-frames.npz')as readback:
 for name,value in arrays.items():assert readback[name].dtype==value.dtype and np.array_equal(readback[name],value)and readback[name].tobytes()==value.tobytes(),name
report=dict(status='passed-original-rifle-fire-variant-audit',source=context,weapons=weapons,
  originalNPZ=str((OUT/'rifle-fire-variant-frames.npz').relative_to(ROOT)),originalNPZSHA256=sha((OUT/'rifle-fire-variant-frames.npz').read_bytes()),
  dependencies=sources.reads,sourceFilesUnchanged=True,gamePublicOrOwnersChanged=False,
  boundary='Frame decode only, with the same verified CS:GO FRAMEANIM adapter and section decoder the shipped rifles used. It does not decide how the engine picks between the variants, and it changes no shipped asset.')
(OUT/'audit.json').write_text(json.dumps(report,indent=2,ensure_ascii=False,default=lambda v:v.tolist())+'\n')
for weapon in weapons:print('RIFLE_FIRE_VARIANTS',weapon['weapon'],[(d['sequence'],d['frames'],d['fps'],d['descriptorFlags'],d['animblock'],d['shippedClipName'])for d in weapon['decoded']])
print('RIFLE_FIRE_VARIANTS_NPZ',report['originalNPZSHA256'])
