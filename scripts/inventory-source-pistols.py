"""Read only original Glock/USP-S item, MDL/sequence and raw material metadata."""
from pathlib import Path
from dataclasses import asdict
import ast,hashlib,importlib.util,json,math,struct,sys
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'.reference-assets/source-exports/pistol-candidates';OUT.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('pistol_items',ROOT/'scripts/inventory-source-items.py');items=importlib.util.module_from_spec(spec);spec.loader.exec_module(items);context=items.initialize();sources=items.Sources()
from SourceIO.library.utils import TinyPath,MemoryBuffer
from SourceIO.library.models.mdl.v49 import MdlV49
from SourceIO.library.models.mdl.structs.local_animation import StudioAnimDesc
catalog=json.loads((ROOT/'research/source-items-catalog.json').read_text());raw=sources.read('scripts/items/items_game.txt');assert items.digest(raw)==next(r for r in catalog['sourceFilesRead']if r['path']=='scripts/items/items_game.txt')['sha256']
helpers={'math':math};tree=ast.parse((ROOT/'scripts/import-source-character.py').read_text());fn=[n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name in ['raw_pose_parameters','raw_sequence_fields']];exec(compile(ast.Module(body=fn,type_ignores=[]),'original-sequence-metadata','exec'),helpers)
weapons=[];original=StudioAnimDesc.read_animations
try:
 StudioAnimDesc.read_animations=lambda *a,**k:None
 for id in ['4','61']:
  item=next(w for w in catalog['weapons']if w['id']==id);defs=item['resolvedDefinition'];models=[]
  for role in ['model_player','model_world']:
   path=defs[role];data=sources.read(path);buffer=MemoryBuffer(data);mdl=MdlV49.from_buffer(buffer)
   bones=[dict(name=b.name,parent=b.parent_id,position=b.position,quaternion=b.quat,flags=int(b.flags),inverseBind=[list(row)for row in b.pose_to_bone.T]+[[0,0,0,1]])for b in mdl.bones]
   sequences=[]
   for i,s in enumerate(mdl.sequences):
    descs=[mdl.anim_descs[n]for n in s.anim_desc_indices]
    sequences.append(dict(index=i,name=s.name,activityName=s.activity_name,flags=s.flags,animationIndices=s.anim_desc_indices,events=[asdict(e)for e in s.events],
     descriptors=[dict(name=d.name,index=n,frames=d.frame_count,fps=d.fps,flags=int(d.flags),seconds=(d.frame_count-1)/d.fps if d.fps else None,sections=d.section_frame_count,animblock=d.animblock_id)for n,d in zip(s.anim_desc_indices,descs)],**helpers['raw_sequence_fields'](s,mdl,buffer)))
   materials=[]
   for material in mdl.materials:
    candidates=['materials/'+material.name+'.vmt']+['materials/'+p+'/'+material.name+'.vmt'for p in mdl.materials_paths];candidates=[p.replace('\\','/').lower().replace('//','/')for p in candidates]
    found=next((p for p in candidates if sources.exists(p)),None);assert found is not None
    vmt=sources.read(found);materials.append(dict(path=found,sha256=items.digest(vmt),rawText=vmt.decode(),definition=items.parse_kv(vmt,found)))
   models.append(dict(role=role,path=path,source=sources.reads[path],header=dict(version=mdl.header.version,bones=len(mdl.bones),includes=mdl.include_models),bones=bones,
    attachments=[asdict(a)for a in mdl.attachments],poseParameters=helpers['raw_pose_parameters'](mdl,buffer),sequences=sequences,materials=materials,
    bodyparts=[dict(name=p.name,base=struct.unpack_from('<I',data,mdl.header.body_part_offset+j*16+8)[0],models=[m.name for m in p.models])for j,p in enumerate(mdl.body_parts)]))
  weapons.append(dict(id=id,name=item['name'],englishName=item['englishName'],itemClass=item['itemClass'],definition=defs,models=models))
finally:StudioAnimDesc.read_animations=original
report=dict(source=context,itemSource=sources.reads['scripts/items/items_game.txt'],weapons=weapons,dependencies=sources.reads)
(OUT/'inventory.json').write_text(json.dumps(report,indent=2,ensure_ascii=False,default=lambda v:v.tolist())+'\n')
for w in weapons:
 print('PISTOL',w['id'],w['name'],w['definition']['visuals']['player_animation_extension'])
 for m in w['models']:print(m['path'],m['header']['bones'],[(s['name'],[(d['frames'],d['fps'],d['flags'])for d in s['descriptors']])for s in m['sequences']])
