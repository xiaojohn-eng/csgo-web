"""Independent byte comparison: only original-animation outputs may change."""
import json,struct,hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[1];assets=root/'.reference-assets/source-exports'
backup=assets/'section-before-20260909/.reference-assets/source-exports'
baseline=backup if backup.exists()else assets
def read(f):
 b=f.read_bytes();n=struct.unpack_from('<I',b,12)[0];return json.loads(b[20:20+n]),b[28+n:]
def acc(d,b,i):
 a=d['accessors'][i];v=d['bufferViews'][a['bufferView']];off=v.get('byteOffset',0)+a.get('byteOffset',0);width={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]*{5121:1,5123:2,5125:4,5126:4}[a['componentType']];return b''.join(b[off+j*v.get('byteStride',width):off+j*v.get('byteStride',width)+width]for j in range(a['count']))
results=[]
for team,old in [('t','ak47-arms'),('ct','ak47-ct-arms')]:
 new=assets/f'ak47-{team}-section-candidate';a,ab=read(baseline/old/'v_rif_ak47-with-arms-source-unit.glb');b,bb=read(new/'v_rif_ak47-with-arms-source-unit.glb')
 assert len(a['meshes'])==len(b['meshes'])and len(a['skins'])==len(b['skins'])
 assert [n.get('name')for n in a['nodes']]==[n.get('name')for n in b['nodes']]
 attrs=0
 for am,bm in zip(a['meshes'],b['meshes']):
  for ap,bp in zip(am['primitives'],bm['primitives']):
   for k,ai in ap['attributes'].items():assert acc(a,ab,ai)==acc(b,bb,bp['attributes'][k]),(team,k);attrs+=1
   assert acc(a,ab,ap['indices'])==acc(b,bb,bp['indices'])
 for sa,sb in zip(a['skins'],b['skins']):assert acc(a,ab,sa['inverseBindMatrices'])==acc(b,bb,sb['inverseBindMatrices'])
 changed=[]
 for olda,newa in zip(a['animations'],b['animations']):
  assert olda['name']==newa['name']
  oldc={(c['target']['node'],c['target']['path']):olda['samplers'][c['sampler']]for c in olda['channels']};newc={(c['target']['node'],c['target']['path']):newa['samplers'][c['sampler']]for c in newa['channels']};assert oldc.keys()==newc.keys()
  for key,s in oldc.items():
   t=newc[key];assert acc(a,ab,s['input'])==acc(b,bb,t['input'])
   av,bv=acc(a,ab,s['output']),acc(b,bb,t['output']);assert len(av)==len(bv)
   if av!=bv:
    width={'VEC3':12,'VEC4':16}[a['accessors'][s['output']]['type']];rows=[j//width for j in range(0,len(av),width)if av[j:j+width]!=bv[j:j+width]]
    changed.append(dict(clip=olda['name'],node=key[0],name=a['nodes'][key[0]]['name'],path=key[1],rows=rows,frames=len(av)//width))
 for ai,bi in zip(a['images'],b['images']):
  av=a['bufferViews'][ai['bufferView']];bv=b['bufferViews'][bi['bufferView']];assert ab[av.get('byteOffset',0):av.get('byteOffset',0)+av['byteLength']]==bb[bv.get('byteOffset',0):bv.get('byteOffset',0)+bv['byteLength']]
 results.append(dict(team=team,status='passed-unchanged-geometry-IBM-images-times',geometryAttributes=attrs,images=len(a['images']),ibm=sum(len(s['joints'])for s in a['skins']),changedAnimationChannels=changed,
  changedClipNames=sorted({c['clip']for c in changed}),onlyFinalFrameChanged=all(c['rows']==[c['frames']-1]for c in changed),newSHA256=hashlib.sha256((new/'v_rif_ak47-with-arms-source-unit.glb').read_bytes()).hexdigest()))
(root/'output/source-ak-section-candidate-diff.json').write_text(json.dumps(results,indent=2)+'\n')
print([(r['team'],r['newSHA256'],len(r['changedAnimationChannels']),r['onlyFinalFrameChanged'],r['changedClipNames'])for r in results])
