"""Append the rifles' remaining original fire variants to the four shipped first-person
view models, preserving every existing byte.

Both rifles give ACT_VM_PRIMARYATTACK three equal-weight sequences, but the frozen
exporter kept one absolute sequence per category, so the port could only ever play
the first. This appends the other two -- with the same gun frames and the same arms
bone-merge rule the shipped exporter used for the first one -- as extra clips, and
changes nothing that already existed:

  * the old binary chunk is a byte-identical prefix of the new one,
  * the old nodes/skins/meshes/materials/images/textures/samplers/scenes are equal,
  * the old animations, accessors and bufferViews are equal,
  * and the root coordinate conversion is not assumed: it is solved from the
    already-shipped variant of the same activity and asserted, then applied.

Run: blender --background --factory-startup --python this_file.py
"""
from pathlib import Path
import copy,hashlib,itertools,json,struct
import numpy as np
from mathutils import Matrix
ROOT=Path(__file__).resolve().parents[1];AUDIT=ROOT/'.reference-assets/source-exports/rifle-fire-variants-audit'
PUBLIC=ROOT/'public/source/csgo-12426148';sha=lambda b:hashlib.sha256(b).hexdigest()
data=json.loads((AUDIT/'audit.json').read_text());npz=np.load(AUDIT/'rifle-fire-variant-frames.npz')
assert data['originalNPZSHA256']==sha((AUDIT/'rifle-fire-variant-frames.npz').read_bytes()),'audit frames changed'
WEAPONS={w['weapon']:w for w in data['weapons']}
ARMS={'t':ROOT/'.reference-assets/source-exports/m4a4-t-arms/t-metadata.json',
      'ct':ROOT/'.reference-assets/source-exports/ak47-ct-arms/ct-metadata.json'}
TARGETS=[dict(team='t',asset='ak47-draw',manifest='provenance.json',weapon='vandal',gunJoints=58,
              append=[('ak47_fire2','fire__ak47_fire2'),('ak47_fire3','fire__ak47_fire3')],validate=('ak47_fire1','fire__ak47_fire1')),
         dict(team='ct',asset='ak47-ct-draw',manifest='manifest.json',weapon='vandal',gunJoints=58,
              append=[('ak47_fire2','fire__ak47_fire2'),('ak47_fire3','fire__ak47_fire3')],validate=('ak47_fire1','fire__ak47_fire1')),
         dict(team='ct',asset='m4a4',manifest='manifest.json',weapon='m4a4',gunJoints=57,
              append=[('shoot2','fire__shoot2'),('shoot3','fire__shoot3')],validate=('shoot1','fire__shoot1')),
         dict(team='t',asset='m4a4-t',manifest='manifest.json',weapon='m4a4',gunJoints=57,
              append=[('shoot2','fire__shoot2'),('shoot3','fire__shoot3')],validate=('shoot1','fire__shoot1'))]
TOLERANCE=2e-3

def split_glb(payload):
 length,kind=struct.unpack_from('<II',payload,12);assert kind==0x4E4F534A and payload[16:20]==b'JSON'
 doc=json.loads(payload[20:20+length])
 blen,bkind=struct.unpack_from('<II',payload,20+length);binary=payload[28+length:]
 assert bkind==0x004E4942 and blen==len(binary)
 return doc,binary
def accessor(doc,binary,index):
 a=doc['accessors'][index];view=doc['bufferViews'][a['bufferView']];width={'SCALAR':1,'VEC3':3,'VEC4':4}[a['type']]
 assert a['componentType']==5126,(a['componentType'],'only float accessors are compared or appended')
 stride=view.get('byteStride')or width*4;start=view.get('byteOffset',0)+a.get('byteOffset',0)
 return np.stack([np.frombuffer(binary,dtype='<f4',count=width,offset=start+i*stride).copy()for i in range(a['count'])])
def clip_channels(doc,binary,name):
 """Every channel of a shipped clip, keyed by node index and path: the two skeletons
 reuse bone names, so a name is not a key."""
 animation=next((a for a in doc['animations']if a.get('name')==name),None);assert animation is not None,'shipped clip missing: '+name
 return {(channel['target']['node'],channel['target']['path']):(accessor(doc,binary,animation['samplers'][channel['sampler']]['input']),
   accessor(doc,binary,animation['samplers'][channel['sampler']]['output']))for channel in animation['channels']}
def mul(a,b):
 v=a[3]*b[:3]+b[3]*a[:3]+np.cross(a[:3],b[:3]);return np.r_[v,a[3]*b[3]-np.dot(a[:3],b[:3])]
def inverse(q):return np.r_[-np.asarray(q[:3]),q[3]]
def quat_error(a,b):return float(np.minimum(np.abs(np.asarray(a)-np.asarray(b)),np.abs(np.asarray(a)+np.asarray(b))).max())
def rotation_matrix(q):
 x,y,z,w=q;v=np.asarray(q[:3]);return(w*w-np.dot(v,v))*np.eye(3)+2*np.outer(v,v)+2*w*np.array([[0,-z,y],[z,0,-x],[-y,x,0]])
def unit_quaternions(q):
 q=np.asarray(q,dtype=np.float64).copy();norms=np.linalg.norm(q,axis=-1,keepdims=True);assert norms.min()>.9,'invalid source quaternion'
 return q/norms
def normalise(q):
 """One bone's keys: unit length, and one consistent sign, the way an exporter writes them."""
 q=unit_quaternions(q)
 for i in range(1,len(q)):
  if np.dot(q[i-1],q[i])<0:q[i]*=-1
 return q
def to_quaternion(local):
 """Blender's own decomposition, so the arms keys follow the same rule the frozen
 exporter used when it built them."""
 rows=[[float(x)for x in row]for row in local];quaternion=Matrix(rows).to_quaternion()
 return np.array([quaternion.x,quaternion.y,quaternion.z,quaternion.w])
def build_tracks(weapon,frames,gun_nodes,arm_bones,arm_nodes,root_rotation,root_translation):
 gun=WEAPONS[weapon];positions=frames['positions'];quaternions=unit_quaternions(frames['quaternions']);count=frames['frames']
 gun_index={b['name']:i for i,b in enumerate(gun['bones'])};assert set(gun_nodes)==set(gun_index)
 assert set(arm_nodes)==set(b['name']for b in arm_bones)
 arms_positions=np.zeros((count,len(arm_bones),3));arms_quaternions=np.zeros((count,len(arm_bones),4))
 for frame in range(count):
  worlds=[]
  for i,b in enumerate(gun['bones']):
   local=np.eye(4);local[:3,:3]=rotation_matrix(quaternions[frame,i]);local[:3,3]=np.asarray(positions[frame,i],dtype=np.float64)
   worlds.append(worlds[b['parent']]@local if b['parent']>=0 else local)
  by_name={b['name']:worlds[i]for i,b in enumerate(gun['bones'])};parents=[]
  for i,b in enumerate(arm_bones):
   parent=parents[b['parent']]if b['parent']>=0 else np.eye(4)
   rest=np.eye(4);rest[:3,:3]=rotation_matrix(np.asarray(b['quaternion'])/np.linalg.norm(b['quaternion']));rest[:3,3]=np.asarray(b['position'],dtype=np.float64)
   target=by_name[b['name']]if b['name']in by_name else parent@rest
   parents.append(target);local=np.linalg.inv(parent)@target
   arms_positions[frame,i]=local[:3,3];arms_quaternions[frame,i]=to_quaternion(local)
 tracks=[]
 for definitions,pos,quat,nodes in ((gun['bones'],positions,quaternions,gun_nodes),(arm_bones,arms_positions,arms_quaternions,arm_nodes)):
  for i,b in enumerate(definitions):
   translation=np.asarray(pos[:,i],dtype=np.float64).copy();rotation=normalise(np.asarray(quat[:,i],dtype=np.float64))
   if b['parent']<0:
    translation=translation@root_translation.T;rotation=np.array([mul(root_rotation,row)for row in rotation])
   tracks.append((nodes[b['name']],'translation',np.asarray(translation,dtype='<f4')))
   tracks.append((nodes[b['name']],'rotation',np.asarray(rotation,dtype='<f4')))
 return tracks
def solve_root_translation(source,shipped):
 candidates=[]
 for perm in itertools.permutations(range(3)):
  for signs in itertools.product((1,-1),repeat=3):
   matrix=np.zeros((3,3))
   for row,column in enumerate(perm):matrix[row,column]=signs[row]
   candidates.append(matrix)
 best=min(candidates,key=lambda m:float(np.abs(source@m.T-shipped).max()))
 return best,float(np.abs(source@best.T-shipped).max())
def compare(tracks,shipped,fps,category):
 """Score the rule against the already-shipped variant, channel by channel."""
 worst=0.0;compared=0;breakdown={}
 for node,path,values in tracks:
  if (node,path)not in shipped:continue
  times,expected=shipped[(node,path)];assert len(times)==len(values),(node,path,len(times),len(values))
  assert np.allclose(times.ravel(),(np.arange(len(values),dtype=np.float64)/fps).astype('<f4'),atol=1e-5),'shipped keyframe times are not an even grid'
  if path=='translation':deviation=float(np.abs(values.astype(np.float64)-expected.astype(np.float64)).max())
  else:deviation=float(np.minimum(np.abs(values.astype(np.float64)-expected.astype(np.float64)),np.abs(values.astype(np.float64)+expected.astype(np.float64))).max())
  key=(category(node),path);breakdown[key]=max(breakdown.get(key,0.0),deviation)
  worst=max(worst,deviation);compared+=1
 return compared,worst,{f'{a}/{b}':round(v,6)for (a,b),v in sorted(breakdown.items())}
results=[]
RECEIPT=ROOT/'output/source-rifle-fire-variant-append.json'
previous=json.loads(RECEIPT.read_text())if RECEIPT.exists()else []
known={row['asset']:row for row in previous}
for target in TARGETS:
 source=PUBLIC/target['asset'];manifest_path=source/target['manifest']
 oldManifest=json.loads(manifest_path.read_text());entry=next(f for f in oldManifest['files']if f['path']=='viewmodel.glb')
 raw=(source/'viewmodel.glb').read_bytes()
 # Running this twice must not append the same clips twice: the second run verifies
 # that what is there is what this script produced and records that.
 if target['asset']in known:
  assert sha(raw)==known[target['asset']]['resultGLBSHA256'],f'{target["asset"]} changed after this script appended it'
  results.append({**known[target['asset']],'alreadyAppended':True});print('RIFLE_FIRE_APPEND_ALREADY',target['asset']);continue
 assert sha(raw)==entry['sha256'],'shipped GLB does not match its own manifest'
 doc,binary=split_glb(raw);original=copy.deepcopy(doc);oldbin=binary
 gun=WEAPONS[target['weapon']];arm_bones=json.loads(ARMS[target['team']].read_text())['bones']
 gun_skin=next(s for s in doc['skins']if len(s['joints'])==target['gunJoints']);arm_skin=next(s for s in doc['skins']if len(s['joints'])==48)
 gun_nodes={doc['nodes'][n]['name']:n for n in gun_skin['joints']};arm_nodes={doc['nodes'][n]['name']:n for n in arm_skin['joints']}
 assert set(gun_nodes)==set(gun['boneNames']),(target['asset'],'gun node names differ from the audited model')
 assert set(arm_nodes)==set(b['name']for b in arm_bones),(target['asset'],'arms node names differ from the metadata')
 matched=set(gun_nodes)&set(arm_nodes);assert len(matched)==47,(target['asset'],len(matched))
 clips={d['sequence']:d for d in gun['decoded']}
 validate_sequence,validate_clip=target['validate'];assert clips[validate_sequence]['shippedClipName']==validate_clip
 frames={k:npz[target['weapon']+'_'+validate_sequence+'_'+k]for k in ('positions','quaternions')}
 frames.update(dict(frames=clips[validate_sequence]['frames'],fps=clips[validate_sequence]['fps']))
 shipped=clip_channels(doc,oldbin,validate_clip)
 root_name=gun['boneNames'][0];root_gun=gun_nodes[root_name];root_arm=arm_nodes[root_name]
 assert len(shipped)==2*(len(gun['bones'])+len(arm_bones)),(target['asset'],'unexpected shipped channel count',len(shipped))
 bare=build_tracks(target['weapon'],frames,gun_nodes,arm_bones,arm_nodes,np.array([0,0,0,1]),np.eye(3))
 take=lambda tracks,node,path:np.array([row for n,p,values in tracks if n==node and p==path for row in values])
 root_translation,translation_error=solve_root_translation(take(bare,root_gun,'translation'),shipped[(root_gun,'translation')][1])
 assert translation_error<TOLERANCE,(target['asset'],'root translation convention unexplained',translation_error)
 assert np.array_equal(root_translation,np.array([[1,0,0],[0,0,1],[0,-1,0]])),(target['asset'],'root translation convention is not the exporter\'s Source-to-Y-up map',root_translation.tolist())
 source_root_q=take(bare,root_gun,'rotation');shipped_root_q=np.asarray(shipped[(root_gun,'rotation')][1],dtype=np.float64)
 assert len(source_root_q)==len(shipped_root_q)
 # A constant pre-multiplied rotation carries every parentless bone's key onto the
 # shipped one; it has to be the same rotation on every frame.
 candidates=np.array([mul(b,inverse(a))for a,b in zip(source_root_q,shipped_root_q)])
 assert candidates.std(axis=0).max()<TOLERANCE,(target['asset'],'the root correction is not constant over time')
 root_rotation=candidates[0]/np.linalg.norm(candidates[0])
 for candidate in candidates[1:]:
  if np.dot(candidate,root_rotation)<0:candidate=-candidate
  root_rotation+=candidate
 root_rotation/=np.linalg.norm(root_rotation)
 assert quat_error(np.array([mul(root_rotation,a)for a in source_root_q]),shipped_root_q)<TOLERANCE,(target['asset'],'solved root correction does not reproduce the root keys')
 assert quat_error(root_rotation,np.array([-np.sqrt(.5),0,0,np.sqrt(.5)]))<TOLERANCE,(target['asset'],'root correction is not the exporter\'s X-axis conversion',root_rotation)
 tracks=build_tracks(target['weapon'],frames,gun_nodes,arm_bones,arm_nodes,root_rotation,root_translation)
 def category(node):
  name=doc['nodes'][node]['name']
  if node==root_gun:return 'gun-root'
  if node==root_arm:return 'arms-root'
  if node in set(gun_nodes.values()):return 'gun-bone'
  return 'arms-shared' if name in matched else 'arms-own'
 compared,deviation,breakdown=compare(tracks,shipped,clips[validate_sequence]['fps'],category)
 print('RIFLE_FIRE_VALIDATE',target['asset'],json.dumps(dict(compared=compared,worst=round(deviation,6),breakdown=breakdown,
   rootRotation=[round(float(v),6)for v in root_rotation])))
 assert compared==len(shipped),(target['asset'],'the rule does not cover every shipped channel',compared,len(shipped))
 assert deviation<TOLERANCE,(target['asset'],'the append rule does not reproduce the shipped variant',deviation)
 binary=bytearray(oldbin);added=[]
 for sequence,clip_name in target['append']:
  frames={k:npz[target['weapon']+'_'+sequence+'_'+k]for k in ('positions','quaternions')}
  frames.update(dict(frames=clips[sequence]['frames'],fps=clips[sequence]['fps']))
  clip_tracks=build_tracks(target['weapon'],frames,gun_nodes,arm_bones,arm_nodes,root_rotation,root_translation)
  def append(values,kind):
   values=np.ascontiguousarray(values,dtype='<f4');raw_values=values.tobytes();binary.extend(b'\0'*((-len(binary))%4))
   offset=len(binary);binary.extend(raw_values);view=len(doc['bufferViews'])
   doc['bufferViews'].append(dict(buffer=0,byteOffset=offset,byteLength=len(raw_values)))
   row=dict(bufferView=view,componentType=5126,count=len(values),type=kind)
   if kind=='SCALAR':row.update(min=[float(values.min())],max=[float(values.max())])
   index=len(doc['accessors']);doc['accessors'].append(row);return index
  time=append(np.arange(frames['frames'],dtype=np.float32)/np.float32(frames['fps']),'SCALAR');samplers=[];channels=[]
  for node,path,values in clip_tracks:
   output=append(values,'VEC3'if path=='translation'else 'VEC4')
   channels.append(dict(sampler=len(samplers),target=dict(node=node,path=path)))
   samplers.append(dict(input=time,output=output,interpolation='LINEAR'))
  doc['animations'].append(dict(name=clip_name,samplers=samplers,channels=channels,extras=dict(
    source_sequence=sequence,source_fps=frames['fps'],source_frames=frames['frames'],source_animation_index=clips[sequence]['descriptorIndex'],
    source_activity='ACT_VM_PRIMARYATTACK',source_events=clips[sequence]['events'],source_absolute=True,
    appended_by='scripts/append-source-rifle-fire-variants.py')))
  added.append(dict(sequence=sequence,clip_name=clip_name,frames=frames['frames'],fps=frames['fps'],channels=len(channels)))
 doc['buffers'][0]['byteLength']=len(binary)
 encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4);binary.extend(b'\0'*((-len(binary))%4))
 result=struct.pack('<III',0x46546c67,2,28+len(encoded)+len(binary))+struct.pack('<II',len(encoded),0x4E4F534A)+encoded+struct.pack('<II',len(binary),0x004E4942)+bytes(binary)
 assert result[28+len(encoded):28+len(encoded)+len(oldbin)]==oldbin,'existing binary bytes changed'
 for key in ('nodes','skins','meshes','materials','images','textures','samplers','scenes','scene','asset','extensionsUsed','extensionsRequired','extensions'):
  assert doc.get(key)==original.get(key),key
 assert doc['animations'][:len(original['animations'])]==original['animations'],'existing animations changed'
 assert doc['accessors'][:len(original['accessors'])]==original['accessors'],'existing accessors changed'
 assert doc['bufferViews'][:len(original['bufferViews'])]==original['bufferViews'],'existing bufferViews changed'
 reread,reread_bin=split_glb(result)
 for _,clip_name in target['append']:
  reread_channels=clip_channels(reread,reread_bin,clip_name)
  assert len(reread_channels)==2*(len(gun['bones'])+len(arm_bones)),(clip_name,len(reread_channels))
  times=reread_channels[(root_gun,'translation')][0];assert np.allclose(times.ravel(),np.arange(clips[[s for s,c in target['append']if c==clip_name][0]]['frames'])/clips[[s for s,c in target['append']if c==clip_name][0]]['fps'],atol=1e-6)
 (source/'viewmodel.glb').write_bytes(result)
 manifest=copy.deepcopy(oldManifest)
 for file in manifest['files']:
  if file['path']=='viewmodel.glb':file.update(bytes=len(result),sha256=sha(result))
 manifest['appendedFireClips']=[dict(sequence=row['sequence'],clip_name=row['clip_name'],activity='ACT_VM_PRIMARYATTACK',fps=row['fps'],frames=row['frames'],
   source_audit=str((AUDIT/'audit.json').relative_to(ROOT)),rootConversionSolvedFrom=validate_clip,rootTranslationMaximumError=translation_error)for row in added]
 manifest['appendedFireClipsValidation']=dict(comparedClip=validate_clip,comparedChannels=compared,maximumChannelDeviation=deviation,
   existingBinaryPrefixByteEqual=True,existingJsonStructuresUnchanged=True)
 manifest_path.write_bytes((json.dumps(manifest,indent=2,ensure_ascii=False)+'\n').encode())
 receipt=dict(status='passed-byte-preserving-rifle-fire-variant-append',asset=target['asset'],team=target['team'],weapon=target['weapon'],manifest=target['manifest'],
   previousGLBSHA256=sha(raw),resultGLBSHA256=sha(result),previousBytes=len(raw),resultBytes=len(result),existingBinaryBytes=len(oldbin),appended=added,
   validatedAgainst=validate_clip,comparedChannels=compared,maximumChannelDeviation=deviation,rootTranslationMaximumError=translation_error,
   rootRotationQuaternionXYZW=[float(v)for v in root_rotation],matchedBoneNames=len(matched),unmappedArmsBoneNames=sorted(set(arm_nodes)-set(gun_nodes)),
   gunJoints=target['gunJoints'],armsJoints=len(arm_bones),existingBinaryPrefixByteEqual=True,existingJsonStructuresUnchanged=True,
   existingAnimationsAndAccessorsAndBufferViewsEqual=True)
 results.append(receipt);print('RIFLE_FIRE_APPEND',json.dumps(receipt))
(ROOT/'output').mkdir(exist_ok=True);RECEIPT.write_text(json.dumps(results,indent=2)+'\n')
# The tracked record: the private exports and the shipped copies are not in the repository,
# so this is where the two identities and the validation they rest on are written down.
(ROOT/'research').mkdir(exist_ok=True)
(ROOT/'research/source-weapon-fire-variants.json').write_text(json.dumps(dict(
 format='source-rifle-fire-variants-v1',
 frames='research/source-weapon-activities.json',
 script='scripts/append-source-rifle-fire-variants.py',
 audit=str((AUDIT/'audit.json').relative_to(ROOT)),
 note='Both rifles give ACT_VM_PRIMARYATTACK three equal-weight sequences, but the frozen exporter kept one absolute sequence per category. This appends the other two, decoded from the same ANI with the same verified FRAMEANIM adapter, with the gun frames the model carries, the arms bone-merge rule the exporter used (shared names follow the weapon, Bip01 keeps its rest), and the exporter\'s root conversion solved from the already-shipped variant rather than assumed.',
 boundary='The append is byte-preserving for everything that already existed, and the rule is asserted against the shipped variant of the same activity on every one of that clip\'s channels. It reads no engine binary: how the engine chooses between the variants is taken from research/source-weapon-activities.json.',
 assets=results),indent=2)+'\n')
print('RIFLE_FIRE_APPEND_TOTAL',len(results))
