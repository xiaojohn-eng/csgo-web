"""Byte-preserving original body + new world-M4 GLB and separate rig manifests.
Only GLB JSON references are remapped. Original buffers are concatenated exactly;
no mesh optimization, topology rewrite, animation baking, or material conversion.
"""
from pathlib import Path
import copy,hashlib,json,struct,gzip
import numpy as np
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'.reference-assets/source-exports'
sha=lambda b:hashlib.sha256(b).hexdigest()
def read(path):
 raw=path.read_bytes();n=struct.unpack_from('<I',raw,12)[0];return json.loads(raw[20:20+n]),raw[28+n:],sha(raw)
def write(path,doc,bin):
 raw=json.dumps(doc,separators=(',',':'),ensure_ascii=False).encode();raw+=b' '*((-len(raw))%4)
 blob=struct.pack('<III',0x46546c67,2,28+len(raw)+len(bin))+struct.pack('<II',len(raw),0x4e4f534a)+raw+struct.pack('<II',len(bin),0x004e4942)+bin
 path.write_bytes(blob);return sha(blob)
def body_only(doc,count):
 doc=copy.deepcopy(doc);sid=next(i for i,s in enumerate(doc['skins'])if len(s['joints'])==count);skin=doc['skins'][sid]
 parent={c:i for i,n in enumerate(doc['nodes'])for c in n.get('children',[])}
 keep=set(skin['joints'])|{i for i,n in enumerate(doc['nodes'])if n.get('skin')==sid}
 for i in list(keep):
  while i in parent:i=parent[i];keep.add(i)
 mapping={old:new for new,old in enumerate(sorted(keep))};nodes=[]
 for old in sorted(keep):
  n=doc['nodes'][old];n['children']=[mapping[c]for c in n.get('children',[])if c in keep]
  if not n['children']:del n['children']
  if 'skin'in n:assert n['skin']==sid;n['skin']=0
  nodes.append(n)
 skin['joints']=[mapping[n]for n in skin['joints']]
 if 'skeleton'in skin:skin['skeleton']=mapping[skin['skeleton']]
 doc['nodes']=nodes;doc['skins']=[skin];doc['scenes']=[{'nodes':[mapping[n]for n in doc['scenes'][doc.get('scene',0)]['nodes']if n in keep]}];doc['scene']=0;doc.pop('animations',None)
 return doc
# Unused original accessors/materials stay retained as evidence, but only body
# roots are reachable. No old AK skin or AK mesh node remains in either scene.
def merge(a,abin,b,bbin):
 out=copy.deepcopy(a);b=copy.deepcopy(b);b.pop('animations',None)
 arrays=['nodes','skins','meshes','materials','textures','images','samplers','accessors','bufferViews']
 offsets={k:len(a.get(k,[]))for k in arrays}
 for v in b.get('bufferViews',[]):assert v.get('buffer',0)==0;v['buffer']=0;v['byteOffset']=v.get('byteOffset',0)+len(abin)
 for acc in b.get('accessors',[]):
  if 'bufferView'in acc:acc['bufferView']+=offsets['bufferViews']
  assert 'sparse'not in acc
 for image in b.get('images',[]):
  if 'bufferView'in image:image['bufferView']+=offsets['bufferViews']
 for t in b.get('textures',[]):
  if 'source'in t:t['source']+=offsets['images']
  if 'sampler'in t:t['sampler']+=offsets['samplers']
  assert 'extensions'not in t
 def textures(value):
  if isinstance(value,dict):
   for k,v in value.items():
    if k=='extras':continue
    if k.endswith('Texture')and isinstance(v,dict)and 'index'in v:v['index']+=offsets['textures']
    else:textures(v)
  elif isinstance(value,list):
   for x in value:textures(x)
 for material in b.get('materials',[]):textures(material)
 for mesh in b.get('meshes',[]):
  for p in mesh['primitives']:
   p['attributes']={k:v+offsets['accessors']for k,v in p['attributes'].items()}
   if 'indices'in p:p['indices']+=offsets['accessors']
   if 'material'in p:p['material']+=offsets['materials']
   assert 'targets'not in p and 'extensions'not in p
 for s in b.get('skins',[]):
  s['joints']=[i+offsets['nodes']for i in s['joints']]
  if 'skeleton'in s:s['skeleton']+=offsets['nodes']
  s['inverseBindMatrices']+=offsets['accessors']
 for n in b.get('nodes',[]):
  for key,table in [('skin','skins'),('mesh','meshes')]:
   if key in n:n[key]+=offsets[table]
  if 'children'in n:n['children']=[i+offsets['nodes']for i in n['children']]
  assert 'camera'not in n and 'extensions'not in n
 for key in arrays:out[key]=out.get(key,[])+b.get(key,[])
 out['scenes'][0]['nodes'] += [i+offsets['nodes']for i in b['scenes'][b.get('scene',0)]['nodes']]
 out['buffers']=[{'byteLength':len(abin)+len(bbin)}];out['extensionsUsed']=sorted(set(a.get('extensionsUsed',[])+b.get('extensionsUsed',[])))
 return out,abin+bbin,offsets
world=BASE/'m4a4/world';wa=json.loads((world/'audit.json').read_text());wd,wb,world_sha=read(Path(wa['glb']['path']))
ci=np.array([[1,0,0,0],[0,0,-1,0],[0,1,0,0],[0,0,0,1]],dtype=np.float64)
bones=[]
for b in wa['bones']:
 inverse=np.vstack([np.asarray(b['pose_to_bone']).T,[0,0,0,1]])
 bones.append(dict(name=b['name'],parent=b['parent_id'],position=b['position'],quaternion=b['quaternion_xyzw'],inverseBindGltf=np.asarray(inverse@ci,dtype=np.float32).flatten(order='F').tolist()))
values=[];anims=[];count=0
with np.load(world/'world-original-frames.npz')as frames:
 for row in wa['worldOriginalSequences']:
  rec=dict(name=row['name'],frames=row['frames'],fps=row['fps'],flags=row['descriptorFlags'],sequenceFlags=row['sequenceFlags'],boneWeights=row['weights'])
  for key in ['positions','quaternions']:
   array=np.asarray(frames[row['name']+'_'+key],dtype='<f8');raw=array.tobytes();values.append(raw);rec[key+'Offset']=count;rec[key+'Count']=array.size;count+=array.size
  anims.append(rec)
weapon_binary=b''.join(values)
for team,body_path,body_count,expected in [
 ('t','character-ak/tm_leet_ak47-sdk-poses-basecolor-reference.glb',71,'554a697eabab950b5dcb65bb39dbd26dd57a660554cb9a9b1074e42aacb35c0c'),
 ('ct','character-ct-ak/ctm_idf_ak47-sdk-poses-basecolor-reference.glb',74,'3409f61089d364cae700ae9d0fb45b0c78523b718facd1be5c4b2fb4cb674084')]:
 out=BASE/f'character-{team}-m4';pose_path=out/'continuous/pose-data.json';pose=json.loads(pose_path.read_text())
 doc,bin,body_sha=read(BASE/body_path);assert body_sha==expected
 body=body_only(doc,body_count);combined,payload,offsets=merge(body,bin,wd,wb)
 assert payload[:len(bin)]==bin and payload[len(bin):]==wb
 combined['asset']['extras']={'characterSourceSHA256':body_sha,'weaponSourceSHA256':world_sha,'weaponId':'m4a4','noBakedPoseClips':True}
 model_sha=write(out/'character-m4a4.glb',combined,payload)
 mappings={};render=[]
 for role,skinid,defs in [('character',0,pose['mainBones']),('weapon',1,bones)]:
  skin=combined['skins'][skinid];names={b['name']:i for i,b in enumerate(defs)};rows=[]
  acc=combined['accessors'][skin['inverseBindMatrices']];view=combined['bufferViews'][acc['bufferView']]
  for slot,joint in enumerate(skin['joints']):
   name=combined['nodes'][joint]['name'];i=names[name]
   actual=list(struct.unpack_from('<16f',payload,view.get('byteOffset',0)+acc.get('byteOffset',0)+slot*64))
   assert actual==defs[i]['inverseBindGltf'],('IBM changed',role,name)
   rows.append(dict(bone=i,sourceName=name,gltfNode=joint,skinJoint=slot))
   if role=='character':render.append(dict(mainBone=i,sourceName=name,gltfNode=joint,gltfName=name,skinJoint=slot))
  mappings[role]=dict(skinIndex=skinid,skinName=skin['name'],joints=rows)
 common=[dict(weaponBone=i,characterBone=j,name=b['name'])for i,b in enumerate(bones)for j,c in enumerate(pose['mainBones'])if b['name']==c['name']]
 assert {r['name']for r in common}=={'weapon_hand_R','weapon_hand_L','ValveBiped.weapon_bone'}
 weapon_data=dict(format='source-world-weapon-v1',weaponId='m4a4',sourceModel='models/weapons/w_rif_m4a1.mdl',bones=bones,animations=anims,
  frames=dict(byteLength=len(weapon_binary),sha256=sha(weapon_binary)),boneMerge=common,rigMappings=mappings,attachments=wa['source_models'][0]['attachments'],
  crouchFirePolicy='Original M4 world MDL has only rifle_fire; use that same original world sequence for crouched shooting. No synthetic rifle_fire_crouch alias.',
  source=wa['source_models'][0],sourceWorldGlbSHA256=world_sha)
 (out/'weapon-frames.f64.bin').write_bytes(weapon_binary);(out/'weapon-frames.f64.bin.gz').write_bytes(gzip.compress(weapon_binary,mtime=0))
 (out/'weapon-data.json').write_text(json.dumps(weapon_data,separators=(',',':'))+'\n')
 pose['renderJoints']=render;pose['renderGlb']=dict(file=str(out/'character-m4a4.glb'),sha256=model_sha)
 pose_path.write_text(json.dumps(pose,separators=(',',':'))+'\n')
 manifest_path=out/'continuous/manifest.json';manifest=json.loads(manifest_path.read_text());manifest['jsonSha256']=sha(pose_path.read_bytes());manifest['jsonBytes']=pose_path.stat().st_size;manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
 receipt=dict(status='passed-byte-preserving-assembly',characterBodyBoneCount=body_count,weaponBoneCount=94,originalBodySHA256=body_sha,originalWorldSHA256=world_sha,
  binarySegments=[dict(byteOffset=0,bytes=len(bin),sha256=sha(bin)),dict(byteOffset=len(bin),bytes=len(wb),sha256=sha(wb))],
  originalBuffersExactlyEqual=True,exactInverseBindMatrices=body_count+94,sourceWeaponBoneMerge=common,modelSha256=model_sha,
  boundary='Only original body nodes + original M4 nodes reachable; source material/geometry buffers retained. Continuous M4 authority must drive bones. No AK pose clips or AK weapon scene nodes are reused.')
 (out/'assembly-readback.json').write_text(json.dumps(receipt,indent=2)+'\n');print('M4_ASSEMBLED',team,model_sha,flush=True)
