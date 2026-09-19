"""Stage two independent original m4 pose identities with exact private bytes."""
import hashlib,json,math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'.reference-assets/source-exports';sha=lambda b:hashlib.sha256(b).hexdigest()
for team,count,anim in [('t',71,71),('ct',74,70)]:
 source=BASE/f'character-{team}-m4';target=ROOT/f'public/source/csgo-12426148/character-{team}-m4';continuous=source/'continuous'
 pose=json.loads((continuous/'pose-data.json').read_text());proof=json.loads((continuous/'verification.json').read_text());assembly=json.loads((source/'assembly-readback.json').read_text())
 assert proof['status']=='passed-source-pose-conformance'and proof['dataSha256']==sha((continuous/'pose-data.json').read_bytes())
 assert proof['originalGlbSha256']==assembly['modelSha256'] and assembly['originalBuffersExactlyEqual']
 files={}
 def stage(path,name,expected=None):
  data=path.read_bytes();digest=sha(data);assert expected is None or digest==expected
  to=target/name;to.parent.mkdir(parents=True,exist_ok=True);to.write_bytes(data);assert to.read_bytes()==data;files[name]=dict(bytes=len(data),sha256=digest)
 stage(source/'character-m4a4.glb','character-m4a4.glb',assembly['modelSha256'])
 for name in ['pose-data.json','frames.f64.bin','frames.f64.bin.gz']:stage(continuous/name,name)
 for name in ['weapon-data.json','weapon-frames.f64.bin','weapon-frames.f64.bin.gz','assembly-readback.json']:stage(source/name,name)
 old=ROOT/('public/source/csgo-12426148/character-ak'if team=='t'else'public/source/csgo-12426148/character-ct-ak');oldmanifest=json.loads((old/'manifest.json').read_text())
 for name,record in oldmanifest['files'].items():
  if name.endswith('.png') and not name.split('/')[-1].startswith('ak47'):stage(old/name,name,record['sha256'])
 for stem in ['rif_m4a1','rif_m4a1_exponent']:stage(BASE/f'm4a4/world/textures/{stem}-rgba.png',f'textures/{stem}.png')
 assert len([f for f in files if f.endswith('.png')])==11
 manifest=dict(format='source-character-stage-v1',build=12426148,weaponId='m4a4',itemDefinition=16,animationExtension='m4',
  characterProfile='tm_leet_varianta'if team=='t'else'ctm_idf',bodyBoneCount=count,animationBoneCount=anim,
  poseVersion=f'csgo-{team}-m4-12426148:'+files['pose-data.json']['sha256'][:16],metersPerSourceUnit=.0254,actorYawOffsetRadians=math.pi/2,
  model='character-m4a4.glb',poseData='pose-data.json',poseFrames='frames.f64.bin',weaponData='weapon-data.json',weaponFrames='weapon-frames.f64.bin',
  files=files,characterBones=count,weaponBones=94,originalInverseBindsVerified=count+94,
  limitations=['Original m4 lower/upper/shoot layers use the public SDK3way default; the closed client animation state graph is not reconstructed.',
  'Original full reload metadata is retained, but continuous actor reload layer scheduling, hand IK, root-motion extraction and beret procedural motion remain unimplemented.',
  'Original shader ambient cube/rim and cubemap remain incomplete. No AK pose or C02 substitution.'],sourceSectionDecoder='SDK last-frame special section + original per-section bone defaults')
 (target/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print('STAGED_M4_CHARACTER',team,manifest['poseVersion'],sum(v['bytes']for v in files.values()))
