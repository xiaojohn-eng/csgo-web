"""Stage only independently verified original AWP body/world graphs and skins."""
from pathlib import Path
import hashlib,json,math
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'.reference-assets/source-exports/awp-character-candidates';summary=[]
sha=lambda raw:hashlib.sha256(raw).hexdigest()
for team in ['t','ct']:
 source=BASE/f'character-{team}-awp';out=ROOT/f'public/source/csgo-12426148/character-{team}-awp'
 a=json.loads((source/'assembly-readback.json').read_text());v=json.loads((source/'pose-verification.json').read_text());body=json.loads((source/'body-pose-data.json').read_text());world=json.loads((source/'world-pose-data.json').read_text())
 assert v['status']=='passed-complete-awp-character-graph'and v['cases']==120 and v['exactOriginalIBM']and v['originalAWPBodyAndWorldGraph']
 assert v['modelSHA256']==a['modelSHA256']==sha((source/'character.glb').read_bytes());assert v['bodyDataSHA256']==sha((source/'body-pose-data.json').read_bytes())and v['worldDataSHA256']==sha((source/'world-pose-data.json').read_bytes())
 gltf=json.loads((source/'gltf-verification.json').read_text());assert gltf['modelSHA256']==a['modelSHA256']and gltf['validation']['numErrors']==0 and gltf['exactOriginalIBM']==len(body['mainBones'])+94
 frames=json.loads((BASE/f'character-{team}-awp-family/continuous/verification.json').read_text());assert frames['status']=='passed-source-pose-conformance'and frames['frameSha256']==body['frames']['sha256']and frames['hitboxesUsingSameBonePose']==22
 out.mkdir(parents=True,exist_ok=True);files=[]
 def stage(raw,name,expected=None):
  h=sha(raw);assert expected is None or h==expected;path=out/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw);assert path.read_bytes()==raw;files.append(dict(path=name,bytes=len(raw),sha256=h))
 for name in ['character.glb','rig.json','body-pose-data.json','body-frames.f64.bin','world-pose-data.json','world-frames.f64.bin']:stage((source/name).read_bytes(),name)
 old=ROOT/f'public/source/csgo-12426148/character-{"ct-"if team=="ct"else""}ak';manifest=json.loads((old/'manifest.json').read_text());count=0
 for name,receipt in manifest['files'].items():
  if name.startswith('textures/')and'weapons'not in name and not Path(name).name.startswith('ak47'):stage((old/name).read_bytes(),name,receipt['sha256']);count+=1
 assert count==9
 worldroot=ROOT/'public/source/csgo-12426148/awp-world';worldmanifest=json.loads((worldroot/'manifest.json').read_text());receipts={r['path']:r for r in worldmanifest['files']}
 for stem in ['awp','awp_exponent','scope','scope_normal']:
  path=f'textures/{stem}-rgba.png';stage((worldroot/path).read_bytes(),f'textures/{stem}.png',receipts[path]['sha256'])
 stage((worldroot/'material-inputs.json').read_bytes(),'world-material-inputs.json',receipts['material-inputs.json']['sha256'])
 manifest=dict(format='source-awp-character-stage-v1',sourceApp=740,build=12426148,team=team,weaponId='awp',poseVersion=a['poseVersion'],characterProfile='tm_leet_varianta'if team=='t'else'ctm_idf',sourceCharacter=body['mainModel'],sourceAnimation=body['animationModel'],sourceWorldWeapon=world['sourceModel'],bodyBoneCount=len(body['mainBones']),animationBoneCount=len(body['animationBones']),worldBoneCount=len(world['bones']),metersPerSourceUnit=.0254,actorYawOffsetRadians=math.pi/2,model='character.glb',rig='rig.json',bodyPose='body-pose-data.json',bodyFrames='body-frames.f64.bin',worldPose='world-pose-data.json',worldFrames='world-frames.f64.bin',files=files,validation=v,originalOrder='Original lower, AWP upper with ordered AWP Aim/HandPos, AWP shoot, explicit Reload_AWP seq/inverse layers; independent world default or sniper reload; three same-name world-space bone merges.',limitations=['Caller supplies original gait, source-time clocks and body/action weights; closed AnimState/IK not reconstructed.','No dedicated scope/zoom/bolt sequence exists in the inventoried original T/CT animation MDLs; FP optics remains separate.','World event visibility follows its original single sequence cycle; layered world actions require explicit magazine visibility.','Original local root displacement is retained; no guessed motion extraction.','CT beret procedural bones remain original local rest, without original jiggle dynamics.','Original Source cubemap, phongalbedoboost and lighting remain material gaps; GPU acceptance is separate.'])
 raw=(json.dumps(manifest,indent=2)+'\n').encode();(out/'manifest.json').write_bytes(raw);summary.append(dict(team=team,weapon='awp',path=str(out),poseVersion=a['poseVersion'],manifestSha256=sha(raw),modelSha256=a['modelSHA256'],rigSha256=next(r['sha256']for r in files if r['path']=='rig.json'),files=len(files)+1,bytes=sum(r['bytes']for r in files)+len(raw)))
(ROOT/'output/source-awp-character-staged.json').write_text(json.dumps(summary,indent=2)+'\n')
frozen={r['team']+'-awp':{k:r[k]for k in ['poseVersion','manifestSha256','modelSha256','rigSha256']}for r in summary}
type_source=(ROOT/'game/source-deagle-character-contracts.ts').read_text();type_source=type_source[type_source.index('export type SourceDeagleCharacterManifest='):].replace('Deagle','AWP').replace('deagle','awp').replace('worldBoneCount:93','worldBoneCount:94').replace('source-pistol-character-stage-v1','source-awp-character-stage-v1')
(ROOT/'game/source-awp-character-contracts.ts').write_text('// Frozen after original AWP graph, source-frame and raw IBM validation.\nexport const SOURCE_AWP_CHARACTERS = '+json.dumps(frozen,indent=2)+' as const;\n\n'+type_source)
print(json.dumps(summary,indent=2))
