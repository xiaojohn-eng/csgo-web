"""Append only original lighting PVS/leaf flags; do not rewrite trace geometry."""
from pathlib import Path
import base64,hashlib,json,struct
ROOT=Path(__file__).resolve().parents[1];raw=(ROOT/'.reference-assets/csgo-legacy/csgo/maps/de_dust2.bsp').read_bytes()
sha=lambda b:hashlib.sha256(b).hexdigest();assert sha(raw)=='b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc'
def lump(i):
 a,n,v,c=struct.unpack_from('<4I',raw,8+i*16);assert not c;return raw[a:a+n]
leaves=lump(10);vis=lump(4);count=struct.unpack_from('<i',vis)[0];rowBytes=(count+7)//8;rows=[]
for i in range(count):
 at=struct.unpack_from('<i',vis,4+i*8)[0]
 if at==-1:rows.append(None);continue
 assert 4+count*8<=at<len(vis);row=bytearray()
 while len(row)<rowBytes:
  b=vis[at];at+=1
  if b:row.append(b)
  else:
   n=vis[at];at+=1;assert n>0;row.extend(bytes(n))
 assert len(row)==rowBytes;rows.append(base64.b64encode(row).decode())
value=dict(format='source-lighting-visibility-v1',sourceBspSha256=sha(raw),clusterCount=count,
 leafClusters=[struct.unpack_from('<h',leaves,i+4)[0] for i in range(0,len(leaves),32)],
 leafFlags=[struct.unpack_from('<H',leaves,i+6)[0]>>9 for i in range(0,len(leaves),32)],pvsRows=rows,
 evidence=dict(originalLeafLumpSha256=sha(leaves),originalVisibilityLumpSha256=sha(vis),leafFlagPacking='dleaf_t area low9/flags high7',
 missingPVSPolicy='Missing cluster/row uses original no-vis all-ones row; negative target worldlight.cluster remains rejected'))
out=ROOT/'public/source/csgo-12426148/fidelity-world-20260913/lighting-trace';out.mkdir(parents=True,exist_ok=True)
payload=(json.dumps(value,separators=(',',':'))+'\n').encode();(out/'visibility.json').write_bytes(payload)
manifest=dict(file='visibility.json',bytes=len(payload),sha256=sha(payload),sourceBspSha256=sha(raw),leaves=len(value['leafFlags']),clusters=count)
(ROOT/'game/source-lighting-trace-visibility-data.ts').write_text('// Generated from original BSP4/BSP10 by export-source-lighting-visibility.py.\nexport const SOURCE_LIGHTING_VISIBILITY_ASSET='+json.dumps(manifest,separators=(',',':'))+' as const;\n')
print(json.dumps(manifest))
