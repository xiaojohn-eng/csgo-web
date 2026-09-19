"""Private byte-preserving four original character+pistol combinations.
Source body/world buffers and independent IBM are preserved; no baked clips.
"""
from pathlib import Path
import ast,copy,hashlib,json,struct
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'.reference-assets/source-exports';P=BASE/'pistol-candidates';sha=lambda b:hashlib.sha256(b).hexdigest()
source=ast.parse((ROOT/'scripts/assemble-source-m4a4-character.py').read_text());functions=[n for n in source.body if isinstance(n,ast.FunctionDef)and n.name in ['read','write','body_only','merge']];exec(compile(ast.Module(body=functions,type_ignores=[]),'byte-preserving-glb-assembly','exec'),globals())
for team,path,count,expected in [('t','character-ak/tm_leet_ak47-sdk-poses-basecolor-reference.glb',71,'554a697eabab950b5dcb65bb39dbd26dd57a660554cb9a9b1074e42aacb35c0c'),('ct','character-ct-ak/ctm_idf_ak47-sdk-poses-basecolor-reference.glb',74,'3409f61089d364cae700ae9d0fb45b0c78523b718facd1be5c4b2fb4cb674084')]:
 bodydoc,bodybin,bodysha=read(BASE/path);assert bodysha==expected;bodydoc=body_only(bodydoc,count);family=P/f'character-{team}-pistol/continuous';basepose=json.loads((family/'pose-data.json').read_text());assert basepose['animationExtension']=='pistol'
 for weapon in ['glock','usp']:
  out=P/f'character-{team}-{weapon}';out.mkdir(exist_ok=True);w=P/f'{weapon}-world';wa=json.loads((w/'audit.json').read_text());wd,wb,ws=read(Path(wa['glb']['path']));worldraw=(w/'continuous/pose-data.json').read_bytes();world=json.loads(worldraw)
  combined,binary,offsets=merge(bodydoc,bodybin,wd,wb);assert binary[:len(bodybin)]==bodybin and binary[len(bodybin):]==wb;combined['asset']['extras']=dict(originalBodySHA256=bodysha,originalWorldSHA256=ws,weaponId=weapon,noBakedClips=True)
  mappings={};bodyrender=[]
  for role,sid,defs in [('body',0,basepose['mainBones']),('world',1,world['bones'])]:
   skin=combined['skins'][sid];names={b['name']:i for i,b in enumerate(defs)};joints=[];a=combined['accessors'][skin['inverseBindMatrices']];v=combined['bufferViews'][a['bufferView']]
   for slot,node in enumerate(skin['joints']):
    name=combined['nodes'][node]['name'];i=names[name];actual=list(struct.unpack_from('<16f',binary,v.get('byteOffset',0)+a.get('byteOffset',0)+slot*64));assert actual==defs[i]['inverseBindGltf'];joints.append(dict(bone=i,sourceName=name,gltfNode=node,skinJoint=slot))
    if role=='body':bodyrender.append(dict(mainBone=i,sourceName=name,gltfNode=node,gltfName=name,skinJoint=slot))
   mappings[role]=dict(skinIndex=sid,skinName=skin['name'],joints=joints)
  bodygroups={}
  for key in ['magazine','silencer']:
   name=Path(world['sourceModel']).stem+('_mag'if key=='magazine'else '_silencer');nodes=[i for i,n in enumerate(combined['nodes'])if n.get('skin')==1 and n.get('name')==name];assert len(nodes)==(1 if key=='magazine'or weapon=='usp'else 0),(weapon,key,nodes);bodygroups[key]=nodes
  common=[dict(weaponBone=i,characterBone=j,name=b['name'])for i,b in enumerate(world['bones'])for j,c in enumerate(basepose['mainBones'])if b['name']==c['name']];assert {r['name']for r in common}=={'weapon_hand_L','weapon_hand_R','ValveBiped.weapon_bone'}
  modelsha=write(out/'character.glb',combined,binary);pose=copy.deepcopy(basepose);pose.update(weaponId=weapon,worldPoseSHA256=sha(worldraw),renderJoints=bodyrender,renderGlb=dict(file=str(out/'character.glb'),sha256=modelsha));posebytes=(json.dumps(pose,separators=(',',':'))+'\n').encode();(out/'body-pose-data.json').write_bytes(posebytes);(out/'body-frames.f64.bin').write_bytes((family/'frames.f64.bin').read_bytes());(out/'world-pose-data.json').write_bytes(worldraw);(out/'world-frames.f64.bin').write_bytes((w/'continuous/frames.f64.bin').read_bytes())
  metadata=json.loads((w/'metadata.json').read_text());attachments=next(m['attachments']for m in metadata['item']['models']if m['role']=='model_world')
  rig=dict(attachments=attachments,format='source-pistol-character-rig-v1',team=team,weaponId=weapon,bodyBoneCount=count,worldBoneCount=len(world['bones']),mappings=mappings,boneMerge=common,bodygroupNodes=bodygroups);(out/'rig.json').write_text(json.dumps(rig,separators=(',',':'))+'\n')
  receipt=dict(status='passed-byte-preserving-pistol-assembly',team=team,weapon=weapon,sourceBodyGLBSHA256=bodysha,sourceWorldGLBSHA256=ws,modelSHA256=modelsha,originalBuffersExactlyEqual=True,binarySegments=[dict(offset=0,bytes=len(bodybin),sha256=sha(bodybin)),dict(offset=len(bodybin),bytes=len(wb),sha256=sha(wb))],exactInverseBindMatrices=count+len(world['bones']),poseVersion=f'csgo-{team}-{weapon}-12426148:'+sha(posebytes)[:16],bodyPoseSHA256=sha(posebytes),worldPoseSHA256=sha(worldraw),bodygroupNodes=bodygroups)
  (out/'assembly-readback.json').write_text(json.dumps(receipt,indent=2)+'\n');print('PISTOL_CHARACTER_ASSEMBLY',team,weapon,modelsha,receipt['poseVersion'])
