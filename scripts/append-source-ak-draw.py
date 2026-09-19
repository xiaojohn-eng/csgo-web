"""Append an original AK draw clip, preserving every existing GLB binary byte.
Only private t/ct candidates; no active/public source asset or loader changes.
"""
from pathlib import Path
import copy,hashlib,json,struct
import numpy as np
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'.reference-assets/source-exports/ak47-draw-candidates';AUDIT=ROOT/'.reference-assets/source-exports/ak47-draw-audit';data=json.loads((AUDIT/'audit.json').read_text());sha=lambda b:hashlib.sha256(b).hexdigest()
npz=np.load(AUDIT/'draw-original-frames.npz');p=npz['ak47_draw_positions'].astype(np.float64);q=npz['ak47_draw_quaternions'].astype(np.float64);q/=np.linalg.norm(q,axis=-1,keepdims=True);assert p.shape==(31,58,3)and q.shape==(31,58,4)
def mul(a,b):
 v=a[3]*b[:3]+b[3]*a[:3]+np.cross(a[:3],b[:3]);out=np.r_[v,a[3]*b[3]-np.dot(a[:3],b[:3])];return out/np.linalg.norm(out)
def rot(q):
 x,y,z,w=q;v=q[:3];return(w*w-np.dot(v,v))*np.eye(3)+2*np.outer(v,v)+2*w*np.array([[0,-z,y],[z,0,-x],[-y,x,0]])
def inverse(q):return np.r_[-q[:3],q[3]]
C=np.array([[1,0,0],[0,0,1],[0,-1,0]]);cq=np.array([-np.sqrt(.5),0,0,np.sqrt(.5)]);wp=np.zeros_like(p);wq=np.zeros_like(q)
for frame in range(31):
 for i,b in enumerate(data['bones']):
  parent=b['parent'];wp[frame,i]=p[frame,i]if parent<0 else wp[frame,parent]+rot(wq[frame,parent])@p[frame,i];wq[frame,i]=q[frame,i]if parent<0 else mul(wq[frame,parent],q[frame,i])
results=[]
for team,folder,manifestName,expected in [('t','ak47','provenance.json','8e93eb7f575bcf4ae7cd05cfce32d374fd8d114d9993e76dd5f1adc5182b0baa'),('ct','ak47-ct','manifest.json','8a8a31f668a54255eeea1556859878910828ad84001f670b566c5e43b5a43e55')]:
 source=ROOT/'public/source/csgo-12426148'/folder;dest=OUT/team;dest.mkdir(parents=True,exist_ok=True);old=(source/'viewmodel.glb').read_bytes();assert sha(old)==expected;length=struct.unpack_from('<I',old,12)[0];doc=json.loads(old[20:20+length]);original=copy.deepcopy(doc);oldbin=old[28+length:];binary=bytearray(oldbin);assert len(doc['animations'])==4 and len(doc['skins'])==2;skin=next(s for s in doc['skins']if len(s['joints'])==58);gunNodes={doc['nodes'][n]['name']:n for n in skin['joints']};assert set(gunNodes)==set(data['boneNames']);armSkin=next(s for s in doc['skins']if len(s['joints'])==48);armNodes={doc['nodes'][n]['name']:n for n in armSkin['joints']}
 armsSource=ROOT/('.reference-assets/source-exports/m4a4-t-arms/t-metadata.json'if team=='t'else'.reference-assets/source-exports/ak47-ct-arms/ct-metadata.json');arms=json.loads(armsSource.read_text());bones=arms['bones'];assert set(armNodes)=={b['name']for b in bones};mapped=set(armNodes)&set(gunNodes);assert len(mapped)==47
 tracks=[];ap=np.zeros((31,48,3));aq=np.zeros((31,48,4));gunIndex={b['name']:i for i,b in enumerate(data['bones'])}
 for frame in range(31):
  targetsP=[];targetsQ=[]
  for i,b in enumerate(bones):
   parent=b['parent'];pp=np.zeros(3)if parent<0 else targetsP[parent];pq=np.array([0,0,0,1])if parent<0 else targetsQ[parent];bq=np.array(b['quaternion']);bq=bq/np.linalg.norm(bq)
   if b['name']in gunIndex:at=gunIndex[b['name']];tp=wp[frame,at];tq=wq[frame,at]
   else:tp=pp+rot(pq)@np.array(b['position']);tq=mul(pq,bq)
   targetsP.append(tp);targetsQ.append(tq);ap[frame,i]=rot(pq).T@(tp-pp);aq[frame,i]=mul(inverse(pq),tq)
 for definitions,positions,quaternions,nodes,role in [(data['bones'],p,q,gunNodes,'weapon'),(bones,ap,aq,armNodes,'arms')]:
  # CT still uses its original matrix bone-merge hook in the runtime; baked draw
  # tracks also make the candidate glTF coherent in generic clip inspection.
  for i,b in enumerate(definitions):
   positions=positions if positions.flags.writeable else positions.copy();v=positions[:,i].copy();r=quaternions[:,i].copy()
   if b['parent']<0:v=v@C.T;r=np.array([mul(cq,x)for x in r])
   for j in range(1,len(r)):
    if np.dot(r[j-1],r[j])<0:r[j]*=-1
   tracks.extend([(nodes[b['name']],'translation',np.asarray(v,dtype='<f4')),(nodes[b['name']],'rotation',np.asarray(r,dtype='<f4'))])
 def append(values,kind):
  raw=values.tobytes();binary.extend(b'\0'*((-len(binary))%4));offset=len(binary);binary.extend(raw);view=len(doc['bufferViews']);doc['bufferViews'].append(dict(buffer=0,byteOffset=offset,byteLength=len(raw)));a=dict(bufferView=view,componentType=5126,count=len(values),type=kind)
  if kind=='SCALAR':a.update(min=[float(values.min())],max=[float(values.max())])
  index=len(doc['accessors']);doc['accessors'].append(a);return index
 time=append(np.arange(31,dtype=np.float32)/np.float32(30),'SCALAR');samplers=[];channels=[]
 for node,path,values in tracks:
  output=append(values,'VEC3'if path=='translation'else'VEC4');channels.append(dict(sampler=len(samplers),target=dict(node=node,path=path)));samplers.append(dict(input=time,output=output,interpolation='LINEAR'))
 clip=dict(name='draw__ak47_draw',samplers=samplers,channels=channels,extras=dict(source_sequence='ak47_draw',source_fps=30,source_frames=31,source_animation_index=4,source_events=data['events'],source_absolute=True));doc['animations'].append(clip);doc['buffers'][0]['byteLength']=len(binary);encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4);binary.extend(b'\0'*((-len(binary))%4));result=struct.pack('<III',0x46546c67,2,28+len(encoded)+len(binary))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+binary;(dest/'viewmodel.glb').write_bytes(result)
 assert result[28+len(encoded):28+len(encoded)+len(oldbin)]==oldbin
 for key in ['nodes','skins','meshes','materials','images','textures','samplers','scenes','scene','asset','extensionsUsed','extensionsRequired','extensions']:
  assert doc.get(key)==original.get(key),key
 assert doc['animations'][:4]==original['animations']and doc['accessors'][:len(original['accessors'])]==original['accessors']and doc['bufferViews'][:len(original['bufferViews'])]==original['bufferViews']
 oldManifest=json.loads((source/manifestName).read_text());manifest=copy.deepcopy(oldManifest)
 for entry in manifest['files']:
  name=entry['path'];content=result if name=='viewmodel.glb'else(source/name).read_bytes()
  if name!='viewmodel.glb':assert sha(content)==entry['sha256']
  path=dest/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(content);entry.update(bytes=len(content),sha256=sha(content))
 manifest['clips']['draw']=dict(action_name='draw__ak47_draw',duration_seconds=1,fps=30,frame_count=31,events=data['events']);manifest['candidate']=dict(originalModelSHA256=expected,newModelSHA256=sha(result),sourceDrawAudit=str(AUDIT/'audit.json'),existingBinaryBytes=len(oldbin),existingBinarySHA256=sha(oldbin),allPreviousClipReferencesAndBytesUnchanged=True,noDeployUnlockInference=True)
 # Sound pairs have already been audited against the actual VPK and prior cache.
 for sound in data['sounds']:
  name='sounds/'+Path(sound['sourcePath']).name;content=(AUDIT/sound['output']).read_bytes();assert sha(content)==sound['sha256'];path=dest/name;path.parent.mkdir(exist_ok=True);path.write_bytes(content)
  if not any(f['path']==name for f in manifest['files']):manifest['files'].append(dict(path=name,bytes=len(content),sha256=sha(content)))
 manifest['drawSoundEvents']=data['events'];manifest['drawSoundFiles']=data['sounds'];mraw=(json.dumps(manifest,indent=2)+'\n').encode();(dest/manifestName).write_bytes(mraw)
 sourceFrames=dict(bones=data['bones'],attachments=data['attachments'],armsBones=bones,matchingBoneNames=sorted(mapped),frames=31,fps=30,positions=p.tolist(),quaternions=q.tolist());(dest/'draw-source-frames.json').write_text(json.dumps(sourceFrames,separators=(',',':'))+'\n')
 receipt=dict(status='passed-byte-preserving-ak-draw-append',team=team,originalGLBSHA256=expected,candidateGLBSHA256=sha(result),candidateManifest=manifestName,candidateManifestSHA256=sha(mraw),oldBinaryBytes=len(oldbin),oldBinarySHA256=sha(oldbin),oldBinaryPrefixEqual=True,originalFourAnimationsExactlyEqual=True,oldNodesSkinsMeshesMaterialsImagesUnchanged=True,drawTracks=len(tracks),drawFrames=31,drawFPS=30,bones=[58,48],matchingArms=47,requiresOriginalCTRuntimeBoneMerge=team=='ct',privatePath=str(dest));(dest/'append-readback.json').write_text(json.dumps(receipt,indent=2)+'\n');results.append(receipt)
(OUT/'candidates.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(results,indent=2))
