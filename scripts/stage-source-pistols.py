"""Stage independently verified original four pistol FP candidates for local use.
This does not enable equipment/Simulation or stage incomplete third-person rigs.
"""
from pathlib import Path
import hashlib,json
ROOT=Path(__file__).resolve().parents[1];summary=[]
sha=lambda b:hashlib.sha256(b).hexdigest()
for weapon in ['glock','usp']:
 for team in ['t','ct']:
  source=ROOT/f'.reference-assets/source-exports/pistol-candidates/{weapon}-{team}';target=ROOT/f'public/source/csgo-12426148/{weapon}-{team}';a=json.loads((source/'audit.json').read_text());m=json.loads((source/'metadata.json').read_text());r=json.loads((source/'three-readback.json').read_text());assert r['status']=='passed'and r['sha256']==a['glb']['sha256']and r['validation']['numErrors']==0 and r['dense']['sourceFrames']==(325 if weapon=='glock'else 716)
  target.mkdir(parents=True,exist_ok=True);files=[]
  def stage(data,name,expected=None):
   h=sha(data);assert expected is None or h==expected;dest=target/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data);assert dest.read_bytes()==data;files.append(dict(path=name,bytes=len(data),sha256=h))
  stage(Path(a['glb']['path']).read_bytes(),'viewmodel.glb',a['glb']['sha256'])
  fp=next(x for x in m['item']['models']if x['role']=='model_player');rig=dict(format='source-pistol-rig-v1',weaponBones=fp['bones'],armsBones=m['arms']['bones'],matchingBoneNames=a['arms']['mapped_bones'],weightedArmsBones=a['arms']['weighted_bones'],attachments=fp['attachments'],bodyparts=fp['bodyparts'],silencerMeshName='parts/v_pist_223_silencer.smd'if weapon=='usp'else None)
  stage((json.dumps(rig,separators=(',',':'))+'\n').encode(),'rig.json')
  gun='pist_glock18'if weapon=='glock'else'pist_223';stems=[gun,gun+'_exponent']+(['v_model_base_arms_color','v_model_base_arms_normal','v_model_base_arms_exp','skin_gradient','t_base_fingerless_glove_color','t_base_fingerless_glove_normal','t_base_fingerless_glove_exp']if team=='t'else['ct_arms_idf','ct_arms_normal','ct_base_glove_color','ct_base_glove_normal','ct_base_glove_exp'])
  for stem in stems:stage((source/f'textures/{stem}-rgba.png').read_bytes(),f'textures/{stem}-rgba.png')
  for name in sorted(set(s['file']for s in m['sounds'])):stage((source/name).read_bytes(),name)
  clips={name:dict(sourceSequence=clip['sequence'],name=clip['action_name'],fps=clip['fps'],frames=clip['frame_count'],duration=clip['duration_seconds'],activity=next(s['activityName']for s in fp['sequences']if s['name']==clip['sequence']),events=clip['events'])for name,clip in a['clip_checks'].items()}
  stage((json.dumps(dict(weapon=fp['materials'],arms=m['arms']['materials']),indent=2)+'\n').encode(),'material-inputs.json')
  manifest=dict(format='source-pistol-viewmodel-v1',sourceApp=740,build=12426148,weaponId=weapon,itemDefinition=int(m['item']['id']),team=team,armsProfile='t_arms'if team=='t'else'ct_arms_idf',sourceArms=a['arms']['path'],sourceWeapon=fp['path'],weaponBoneCount=len(fp['bones']),armsBoneCount=48,matchedBoneCount=len(a['arms']['mapped_bones']),weightedArmsBoneCount=34,clips=clips,soundEvents=m['events'],sounds=m['sounds'],files=files,units='Original source-unit GLB. Runtime outer yaw pi/2 and scale .0254 exactly once.',verification=dict(sourceFrames=r['dense']['sourceFrames'],inverseBindMatrices=r['inverseBindMatrices'],maximumMatrixErrorSourceUnits=max(v for k,v in r['dense'].items()if k.startswith('max')),khronosErrors=0),limitations=m['limitations'])
  raw=(json.dumps(manifest,indent=2)+'\n').encode();(target/'manifest.json').write_bytes(raw);summary.append(dict(weapon=weapon,team=team,path=str(target),manifestSha256=sha(raw),glbSha256=a['glb']['sha256'],files=len(files),bytes=sum(f['bytes']for f in files),rigSha256=next(f['sha256']for f in files if f['path']=='rig.json')))
(ROOT/'output/source-pistol-staged.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
