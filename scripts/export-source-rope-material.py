"""Decode the original rope VMT/VTF to an independent, receipt-checked sidecar."""
from pathlib import Path
import runpy,struct,hashlib,json
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public/source/csgo-12426148/fidelity-world-20260913/ropes'
def main():
 h=runpy.run_path(str(ROOT/'scripts/inventory-source-items.py'));environment=h['initialize']();s=h['Sources']()
 from SourceIO.library.utils.pylib.vtf import load_vtf_texture
 from SourceIO.library.utils.pylib.image import encode_png
 sha=lambda b:hashlib.sha256(b).hexdigest()
 raw=s.read('materials/cable/nuke_cable.vmt');parsed=h['parse_kv'](raw,'cable/nuke_cable');print('ROPE_VMT',parsed)
 shader,params=next(iter(parsed.items()));textures=[];OUT.mkdir(parents=True,exist_ok=True)
 for key in ['$basetexture','$bumpmap']:
  if key not in params:continue
  path=params[key].lower().removesuffix('.vtf');vtf=s.read('materials/'+path+'.vtf');pixels,w,h,isfloat=load_vtf_texture(vtf)
  assert not isfloat
  png=encode_png(pixels,w,h,4);name=sha(vtf)[:16]+'.png';(OUT/name).write_bytes(png)
  textures.append(dict(parameter=key,source=path,file=name,bytes=len(png),sha256=sha(png),vtfSha256=sha(vtf),width=w,height=h))
 result=dict(format='source-rope-material-v1',material='cable/nuke_cable',shader=shader,parameters=params,vmtSha256=sha(raw),textures=textures,environment=environment)
 b=(json.dumps(result,indent=2)+'\n').encode();(OUT/'manifest.json').write_bytes(b)
 receipt=dict(file='manifest.json',bytes=len(b),sha256=sha(b))
 (ROOT/'game/source-ropes-material-data.ts').write_text('// Original VPK decode; scripts/export-source-rope-material.py\nexport const SOURCE_ROPE_MATERIAL_RECEIPT='+json.dumps(receipt)+' as const;\n')
 print('ROPE_MATERIAL',json.dumps(result))
if __name__=='__main__':main()
