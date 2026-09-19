"""Original BSP lighting-mask planes/flags and explicit existing-physics metadata.
Run in isolated Blender; no base asset edits or render geometry conversion.
"""
from pathlib import Path
from collections import Counter,defaultdict
import hashlib,io,json,runpy,struct,zipfile
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public/source/csgo-12426148/fidelity-world-20260913/lighting-trace'
BSP=ROOT/'.reference-assets/csgo-legacy/csgo/maps/de_dust2.bsp'
raw=BSP.read_bytes();sha=lambda b:hashlib.sha256(b).hexdigest()
assert sha(raw)=='b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc'
receipts={}
def lump(i):
 a,n,v,c=struct.unpack_from('<4I',raw,8+i*16);assert not c;d=raw[a:a+n];receipts[str(i)]={'bytes':n,'version':v,'sha256':sha(d)};return d
def rows(i,fmt):return list(struct.iter_unpack(fmt,lump(i)))
planes=[list(v[:4]) for v in rows(1,'<4fi')]
nodes=[dict(plane=v[0],children=list(v[1:3])) for v in rows(5,'<3i6h2H2h')]
leavesRaw=lump(10);assert len(leavesRaw)%32==0
leaves=[struct.unpack_from('<ihH6h4Hh',leavesRaw,a) for a in range(0,len(leavesRaw),32)]
leafBrushes=[v[0] for v in rows(17,'<H')];brushes=rows(18,'<3i');sides=rows(19,'<HhhH');texinfo=rows(6,'<16f2i')
model=rows(14,'<9f3i')[0];head=model[9];pending=[head];ids=set();worldLeaves=set()
while pending:
 n=pending.pop()
 if n>=0:pending.extend(nodes[n]['children'])
 else:
  leaf=-n-1;worldLeaves.add(leaf);v=leaves[leaf];ids.update(leafBrushes[v[11]:v[11]+v[12]])
selected=[]
for i in sorted(ids):
 first,count,contents=brushes[i]
 if not contents&0x4481:continue
 ss=[];minimum=[-float('inf')]*3;maximum=[float('inf')]*3
 for sideIndex in range(first,first+count):
  plane,ti,di,bevel=sides[sideIndex];p=planes[plane];flags=texinfo[ti][16] if ti>=0 else 0
  ss.append([plane,flags,sideIndex,ti,bevel])
  for axis in range(3):
   if abs(p[axis])==1 and all(p[j]==0 for j in range(3) if j!=axis):
    if p[axis]>0:maximum[axis]=min(maximum[axis],p[3])
    else:minimum[axis]=max(minimum[axis],-p[3])
 assert np.isfinite(minimum+maximum).all() and all(a<b for a,b in zip(minimum,maximum)),i
 selected.append(dict(id=i,contents=contents,sides=ss,bounds=[minimum,maximum]))
assert len(selected)==881
collisionPath=ROOT/'public/source/csgo-12426148/dust2/collision.json';collisionRaw=collisionPath.read_bytes();collision=json.loads(collisionRaw)
existing={c['source']['brush'] for c in collision['colliders'] if c['source'].get('layer')=='brush'}
# Reconstruct the original collision export's displacement chunk order and its
# exact triangle-to-texinfo flags, without copying/replacing geometry.
verts=np.frombuffer(lump(3),dtype='<f4').reshape(-1,3).astype(np.float64)
edges=np.frombuffer(lump(12),dtype='<u2').reshape(-1,2);surf=np.frombuffer(lump(13),dtype='<i4')
faces=lump(7);infos=lump(26);dv=np.frombuffer(lump(33),dtype='<f4').reshape(-1,5);offsets=(dv[:,:3]*dv[:,3:4]).astype(np.float32)
disp=defaultdict(list);dispInfoCounts=Counter()
for di in range(len(infos)//176):
 at=di*176;startPosition=np.asarray(struct.unpack_from('<3f',infos,at));vs=struct.unpack_from('<i',infos,at+12)[0];power=struct.unpack_from('<i',infos,at+20)[0]
 contents=struct.unpack_from('<i',infos,at+32)[0];fi=struct.unpack_from('<H',infos,at+36)[0]
 first=struct.unpack_from('<i',faces,fi*56+4)[0];count=struct.unpack_from('<h',faces,fi*56+8)[0];ti=struct.unpack_from('<h',faces,fi*56+10)[0]
 se=surf[first:first+count];base=verts[edges[np.abs(se),1-(se>0).astype(np.uint8)]];assert len(base)==4
 start=int(np.argmin(np.linalg.norm(base-startPosition,axis=1)));n=(1<<power)+1;points=[]
 for row in range(n):
  left=base[start]+(base[(start+1)&3]-base[start])*row/(n-1);right=base[(start+3)&3]+(base[(start+2)&3]-base[(start+3)&3])*row/(n-1)
  points.extend(left+(right-left)*column/(n-1) for column in range(n))
 points=np.asarray(points)+offsets[vs:vs+n*n];key=','.join(map(str,[*np.floor(points.mean(axis=0)/1024).astype(int),contents]))
 flags=texinfo[ti][16];disp[key].append([2*(n-1)**2,flags,di]);dispInfoCounts[flags]+=1
geometries={g['id']:g for g in collision['geometries']};displacementRows=[]
for c in collision['colliders']:
 s=c['source']
 if s.get('layer')!='displacement':continue
 key=','.join(map(str,s['grid']+[s['contents']]));ranges=disp.pop(key);assert sum(r[0] for r in ranges)==len(geometries[c['geometry']]['indices'])//3
 displacementRows.append(dict(key=key,geometry=c['geometry'],contents=s['contents'],ranges=ranges))
assert not disp and len(displacementRows)==101
# Original studiohdr_t contents, verified by the pinned reader instead of
# treating every existing role/prop as SOLID by inference.
helper=runpy.run_path(str(ROOT/'scripts/inventory-source-items.py'));installation=helper['initialize']();sources=helper['Sources']();sources.read_budget=192_000_000
from SourceIO.library.models.mdl.structs.header import MdlHeaderV49
from SourceIO.library.utils import MemoryBuffer
pak=zipfile.ZipFile(io.BytesIO(lump(40)));names={n.lower():n for n in pak.namelist()}
props=[];models=sorted({c['source']['model'] for c in collision['colliders'] if c['source'].get('layer')=='propPhy'})
for modelName in models:
 data=pak.read(names[modelName.lower()]) if modelName.lower() in names else sources.read(modelName)
 h=MdlHeaderV49.from_buffer(MemoryBuffer(data));assert h.contents==struct.unpack_from('<I',data,332)[0]
 props.append(dict(model=modelName,contents=h.contents,mdlSha256=sha(data)))
value=dict(format='source-lighting-trace-v1',build=12426148,sourceBspSha256=sha(raw),collisionSha256=sha(collisionRaw),masks=[0x4481,0x4081],
 tree=dict(head=head,planes=planes,nodes=nodes,leafContents=[v[0] for v in leaves]),brushes=selected,displacements=displacementRows,props=props,
 evidence=dict(lumps=receipts,worldBrushes=len(ids),selectedWorldBrushes=len(selected),missingSelectedWorldBrushes=sorted(b['id'] for b in selected if b['id'] not in existing),
  skySides=sum(bool(s[1]&4) for b in selected for s in b['sides']),displacementSurfaceFlags=dict(dispInfoCounts),propContents=dict(Counter(p['contents'] for p in props)),
  sourceIO=installation,missingPHYSolidInstances=collision['missingPHY']),
 limitations=['World ray/plane clip retains Source epsilon but full native trace equivalence is a separate verification.',
  'Static-prop and displacement intersections reuse the existing original-geometry Rapier adapter; its numerical trace is not the native Source CM/VPhysics implementation.',
  'Missing-PHY static-prop fallback remains unverified; these models have no collider in the existing map. No replacement hull is fabricated.'])
OUT.mkdir(parents=True,exist_ok=True);payload=(json.dumps(value,separators=(',',':'))+'\n').encode();(OUT/'trace.json').write_bytes(payload)
manifest=dict(file='trace.json',bytes=len(payload),sha256=sha(payload),sourceBspSha256=sha(raw),collisionSha256=sha(collisionRaw),counts=dict(brushes=len(selected),planes=len(planes),nodes=len(nodes),leaves=len(leaves),displacements=len(displacementRows),propModels=len(props)))
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(ROOT/'game/source-lighting-trace-data.ts').write_text('// Generated from original BSP/MDL by export-source-lighting-trace.py.\nexport const SOURCE_LIGHTING_TRACE_ASSET='+json.dumps(manifest,separators=(',',':'))+' as const;\n')
print(json.dumps(dict(manifest=manifest,missingWorldBrushes=len(value['evidence']['missingSelectedWorldBrushes']),skySides=value['evidence']['skySides'],propContents=value['evidence']['propContents'])))
