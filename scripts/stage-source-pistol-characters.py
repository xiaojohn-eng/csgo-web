"""Stage four verified complete original pistol pose graphs and independent skins.
Does not register equipment, gameplay state fields, menu entries or animations.
"""
from pathlib import Path
import hashlib,json,math
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'.reference-assets/source-exports/pistol-candidates';summary=[];sha=lambda b:hashlib.sha256(b).hexdigest()
for team in ['t','ct']:
 for weapon in ['glock','usp']:
  source=BASE/f'character-{team}-{weapon}';out=ROOT/f'public/source/csgo-12426148/character-{team}-{weapon}';a=json.loads((source/'assembly-readback.json').read_text());v=json.loads((source/'pose-verification.json').read_text());body=json.loads((source/'body-pose-data.json').read_text());world=json.loads((source/'world-pose-data.json').read_text());assert v['status']=='passed-complete-pistol-character-graph'and v['cases']==60 and v['exactOriginalIBM']and v['allFiveNativeAutolayers'];assert v['modelSHA256']==a['modelSHA256']==sha((source/'character.glb').read_bytes());assert v['bodyDataSHA256']==sha((source/'body-pose-data.json').read_bytes())and v['worldDataSHA256']==sha((source/'world-pose-data.json').read_bytes());out.mkdir(parents=True,exist_ok=True);files=[]
  def stage(data,name,expected=None):
   digest=sha(data);assert expected is None or digest==expected;path=out/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data);assert path.read_bytes()==data;files.append(dict(path=name,bytes=len(data),sha256=digest))
  for name in ['character.glb','rig.json','body-pose-data.json','body-frames.f64.bin','world-pose-data.json','world-frames.f64.bin']:stage((source/name).read_bytes(),name)
  old=ROOT/f'public/source/csgo-12426148/character-{ "ct-"if team=="ct"else""}ak';oldmanifest=json.loads((old/'manifest.json').read_text());textureCount=0
  for name,receipt in oldmanifest['files'].items():
   if name.startswith('textures/')and'weapons'not in name and not Path(name).name.startswith('ak47'):
    stage((old/name).read_bytes(),name,receipt['sha256']);textureCount+=1
  assert textureCount==9
  wa=json.loads((BASE/f'{weapon}-world/audit.json').read_text());material=wa['materials'][0];assert material['name']==('pist_glock18'if weapon=='glock'else'pist_223')
  for t in material['textures']:stage((BASE/f'{weapon}-world'/t['raw_png']).read_bytes(),'textures/'+Path(t['raw_png']).name.replace('-rgba',''))
  stage((json.dumps(material,indent=2)+'\n').encode(),'world-material-inputs.json')
  manifest=dict(format='source-pistol-character-stage-v1',sourceApp=740,build=12426148,team=team,weaponId=weapon,poseVersion=a['poseVersion'],characterProfile='tm_leet_varianta'if team=='t'else'ctm_idf',sourceCharacter=body['mainModel'],sourceAnimation=body['animationModel'],sourceWorldWeapon=world['sourceModel'],bodyBoneCount=len(body['mainBones']),animationBoneCount=len(body['animationBones']),worldBoneCount=len(world['bones']),metersPerSourceUnit=.0254,actorYawOffsetRadians=math.pi/2,model='character.glb',rig='rig.json',bodyPose='body-pose-data.json',bodyFrames='body-frames.f64.bin',worldPose='world-pose-data.json',worldFrames='world-frames.f64.bin',files=files,validation=v,originalOrder='Body lower, PISTOL upper, Pistol shoot; explicit body overlays. World default, pistol_aim_t five original POSE/SPLINE autolayers, explicit world overlays, then three same-name source-world bone merge.',limitations=['Closed CSGO AnimState selection, aim weight transitions, layer arbitration and IK not reconstructed','Caller must supply all five original world aim weights, source sequence clocks, action layers and USP visibility','Original source local root displacement remains intact; no guessed locomotion removal','Original Source lighting/environment cubemap and Glock phongalbedoboost remain incomplete','No third-person GPU acceptance yet'])
  raw=(json.dumps(manifest,indent=2)+'\n').encode();(out/'manifest.json').write_bytes(raw);summary.append(dict(team=team,weapon=weapon,path=str(out),poseVersion=a['poseVersion'],manifestSha256=sha(raw),modelSha256=a['modelSHA256'],rigSha256=next(f['sha256']for f in files if f['path']=='rig.json'),files=len(files)+1,bytes=sum(f['bytes']for f in files)+len(raw)))
(ROOT/'output/source-pistol-character-staged.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
