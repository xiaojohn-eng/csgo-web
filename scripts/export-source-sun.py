"""Stage the installed Dust2 sun material and colour correction bytes.
Run in factory-startup Blender for the existing SourceIO VTF decoder only.
"""
import hashlib, importlib.util, json, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.tools'))
from SourceIO.library.utils.pylib.vtf import load_vtf_texture
from SourceIO.library.utils.pylib.image import encode_png
spec=importlib.util.spec_from_file_location('sun_items',ROOT/'scripts/inventory-source-items.py')
items=importlib.util.module_from_spec(spec);spec.loader.exec_module(items)
items.initialize();sources=items.Sources();sources.read_budget=8000000
dest=ROOT/'public/source/csgo-12426148/sun';dest.mkdir(parents=True,exist_ok=True)
receipt={'format':'source-sun-v1','files':[],'materials':{}}
sha=lambda raw:hashlib.sha256(raw).hexdigest()
def write(name,raw):
 (dest/name).write_bytes(raw)
 row={'path':name,'bytes':len(raw),'sha256':sha(raw)};receipt['files'].append(row);return row
for name in ['sprites/light_glow02_add_noz']:
 path='materials/'+name+'.vmt';raw=sources.read(path)
 shader,params=next(iter(items.parse_kv(raw,path).items()))
 texpath='materials/'+params['$basetexture']+'.vtf';vtf=sources.read(texpath)
 pixels,w,h,is_float=load_vtf_texture(vtf);assert not is_float
 png=write('sun.png',encode_png(pixels,w,h,4))
 receipt['materials'][name]={'source':path,'rawVmt':raw.decode('utf-8-sig'),'sha256':sha(raw),'shader':shader,'parameters':params,
  'texture':{'source':texpath,'sha256':sha(vtf),'width':w,'height':h,'png':png}}
lutpath='materials/correction/cc_dust2.raw';lut=sources.read(lutpath)
receipt['colorCorrection']={'source':lutpath,**write('cc_dust2.raw',lut)}
write('manifest.json',json.dumps(receipt,indent=2).encode())
(ROOT/'research/source-sun-assets.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt,indent=2))
