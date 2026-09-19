"""Bounded read-only App740 AK draw sequence/frame/event audit.
Only writes this new private audit directory. Never changes an active AK owner,
GLB, manifest, staged file, Blender preference, or SourceIO checkout.
"""
from pathlib import Path
from dataclasses import asdict
import ast,hashlib,importlib.util,io,json,math,sys,wave,zlib
import numpy as np
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'.reference-assets/source-exports/ak47-draw-audit';OUT.mkdir(parents=True,exist_ok=True);sha=lambda v:hashlib.sha256(v).hexdigest()
spec=importlib.util.spec_from_file_location('ak_draw_items',ROOT/'scripts/inventory-source-items.py');items=importlib.util.module_from_spec(spec);spec.loader.exec_module(items);context=items.initialize();sources=items.Sources()
from SourceIO.library.utils import MemoryBuffer
from SourceIO.library.models.mdl.v49 import MdlV49
from SourceIO.library.models.mdl.structs.local_animation import StudioAnimDesc,AniBoneFlags,ANIM_DTYPE
from SourceIO.library.models.mdl.structs.frame_anim import StudioFrameAnim
from SourceIO.library.models.mdl.structs.compressed_vectors import Quat48,Quat48S
from SourceIO.library.models.mdl.structs.ani_file import AniFile
from SourceIO.library.models.mdl.load_animations import _get_block_table
catalog=json.loads((ROOT/'research/source-items-catalog.json').read_text());item=next(w for w in catalog['weapons']if w['id']=='7');model=item['resolvedDefinition']['model_player'];assert model=='models/weapons/v_rif_ak47.mdl';raw=sources.read(model);buffer=MemoryBuffer(raw);old=StudioAnimDesc.read_animations
try:StudioAnimDesc.read_animations=lambda *a,**k:None;mdl=MdlV49.from_buffer(buffer)
finally:StudioAnimDesc.read_animations=old
helpers={'math':math};tree=ast.parse((ROOT/'scripts/import-source-character.py').read_text());nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name in ['raw_pose_parameters','raw_sequence_fields']];exec(compile(ast.Module(body=nodes,type_ignores=[]),'ak-original-sequence-fields','exec'),helpers)
seqs=[]
for i,s in enumerate(mdl.sequences):
 descs=[mdl.anim_descs[j]for j in s.anim_desc_indices];seqs.append(dict(index=i,name=s.name,activityName=s.activity_name,flags=s.flags,animationIndices=s.anim_desc_indices,events=[asdict(e)for e in s.events],descriptors=[dict(index=j,name=d.name,frames=d.frame_count,fps=d.fps,flags=int(d.flags),durationSeconds=(d.frame_count-1)/d.fps,sectionFrames=d.section_frame_count,animblock=d.animblock_id)for j,d in zip(s.anim_desc_indices,descs)],**helpers['raw_sequence_fields'](s,mdl,buffer)))
ani_path=mdl.header.anim_block_name.replace('\\','/').lower();ani=AniFile.from_buffer(MemoryBuffer(sources.read(ani_path)));blocks=_get_block_table(mdl,buffer)
adapterReport={'frame_animation_adapter':{'observations':[]}};report=adapterReport;tree=ast.parse((ROOT/'scripts/import-source-weapon.py').read_text());framefn=next(n for n in ast.walk(tree)if isinstance(n,ast.FunctionDef)and n.name=='read_csgo_frame_animation');exec(compile(ast.Module(body=[framefn],type_ignores=[]),'verified-original-frame-adapter','exec'),globals());originalFrameReader=StudioAnimDesc._read_frame_animations;StudioAnimDesc._read_frame_animations=read_csgo_frame_animation
draws=[s for s in seqs if'draw'in s['name'].lower()or'DRAW'in s['activityName']];assert draws and len(mdl.bones)==58
spec=importlib.util.spec_from_file_location('ak_draw_sections',ROOT/'scripts/source-section-decoder.py');section=importlib.util.module_from_spec(spec);spec.loader.exec_module(section);observations=[];restore=section.install_source_section_decoder(observations);arrays={};frames=[];eventRows=[];sounds=[]
try:
 for s in draws:
  assert len(s['animationIndices'])==1 and not s['autoLayers'];d=mdl.anim_descs[s['animationIndices'][0]];print('DRAW_DESCRIPTOR',s['name'],s['descriptors'],flush=True);assert d.animblock_id==1 and int(d.flags)==64
  decoded=d.read_animations(buffer,mdl.bones,ani.buffer,blocks);assert decoded is not None;p=np.tile(np.array([b.position for b in mdl.bones],dtype=np.float32),(d.frame_count,1,1));q=np.tile(np.array([b.quat for b in mdl.bones],dtype=np.float32),(d.frame_count,1,1))
  for i,bone in enumerate(mdl.bones):
   if bone.name in decoded:p[:,i]=decoded[bone.name]['pos'];q[:,i]=decoded[bone.name]['rot']
  assert np.isfinite(p).all()and np.isfinite(q).all();arrays[s['name']+'_positions']=p;arrays[s['name']+'_quaternions']=q;frames.append(dict(sequence=s['name'],fps=d.fps,frames=d.frame_count,boneCount=len(mdl.bones),positionsShape=list(p.shape),quaternionsShape=list(q.shape),positionsSHA256=sha(p.tobytes()),quaternionsSHA256=sha(q.tobytes()),maximumQuaternionNormDeviation=float(np.max(np.abs(np.linalg.norm(q,axis=-1)-1)))))
  for e in s['events']:
   event=dict(sequence=s['name'],**e,timeSeconds=e['cycle']*(d.frame_count-1)/d.fps);key=e['options'].lower();event['soundLookup']=key if key in catalog['soundEvents']else None;eventRows.append(event)
   if key not in catalog['soundEvents']:continue
   definition=catalog['soundEvents'][key]
   for value in definition['waves']:
    path=value['file']['path'];content=sources.read(path);assert len(content)==value['file']['bytes']and format(zlib.crc32(content)&0xffffffff,'08x')==value['file']['crc32'];oldSounds=json.loads((ROOT/'.reference-assets/source-exports/ak47/sounds/manifest.json').read_text())['sounds'];assert sha(content)==next(v['sha256']for v in oldSounds if v['source']['path']==path);dest=OUT/'sounds'/path.removeprefix('sound/');dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(content);assert dest.read_bytes()==content
    with wave.open(io.BytesIO(content),'rb')as wav:info=dict(channels=wav.getnchannels(),sampleRate=wav.getframerate(),sampleWidth=wav.getsampwidth(),frames=wav.getnframes(),durationSeconds=wav.getnframes()/wav.getframerate())
    sounds.append(dict(event=key,sourcePath=path,definition=definition['definition'],sourceWave=value['sourceWave'],sha256=sha(content),bytes=len(content),output=str(dest.relative_to(OUT)),**info))
finally:restore();StudioAnimDesc._read_frame_animations=originalFrameReader
np.savez(OUT/'draw-original-frames.npz',**arrays)
# Independent NPZ readback includes every source component, shape and dtype.
with np.load(OUT/'draw-original-frames.npz')as readback:
 for name,value in arrays.items():assert readback[name].dtype==value.dtype and np.array_equal(readback[name],value)and readback[name].tobytes()==value.tobytes()
report=dict(status='passed-original-ak-draw-asset-audit',source=context,itemId=7,itemName=item['name'],itemDefinition=item['resolvedDefinition'],model=model,sourceMDL=sources.reads[model],boneCount=len(mdl.bones),boneNames=[b.name for b in mdl.bones],bones=[dict(name=b.name,parent=b.parent_id,position=list(b.position),quaternion=list(b.quat),flags=int(b.flags),inverseBind=[list(row)for row in b.pose_to_bone.T]+[[0,0,0,1]])for b in mdl.bones],attachments=[asdict(a)for a in mdl.attachments],allSequenceInventory=seqs,drawSequences=draws,drawArrays=frames,originalNPZSHA256=sha((OUT/'draw-original-frames.npz').read_bytes()),events=eventRows,sounds=sounds,sectionDecoder=observations,frameAnimationAdapter=adapterReport,dependencies=sources.reads,sourceFilesUnchanged=True,gamePublicOrOwnersChanged=False,limitations=['Data audit only: no new GLB or owner playback generated','Source activity selection and actual deploy/fire-unlock timer are not inferred from clip duration','Draw events are preserved at original cycle; event dispatch/interruption/generation integration belongs to root'])
(OUT/'audit.json').write_text(json.dumps(report,indent=2,ensure_ascii=False,default=lambda v:v.tolist())+'\n');print('AK_DRAW_AUDIT',[(s['name'],s['activityName'],s['descriptors'])for s in draws]);print('AK_DRAW_EVENTS',eventRows);print('AK_DRAW_ARRAYS',frames);print('AK_DRAW_SOUNDS',[(s['event'],s['sourcePath'],s['sha256'])for s in sounds])
