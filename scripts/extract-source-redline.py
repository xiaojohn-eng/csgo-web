"""Extract original AK47 Redline composition inputs, without synthesizing a finish.
Run with project Blender --background --factory-startup --python this_file.py.
"""
from pathlib import Path
from datetime import datetime, timezone
import hashlib,json,runpy,struct,sys
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.reference-assets/source-exports/ak47-redline-inputs'
OUT.mkdir(parents=True,exist_ok=True)
(OUT/'inputs.json').write_text(json.dumps({'status':'running','startedAt':datetime.now(timezone.utc).isoformat()})+'\n')
helpers=runpy.run_path(str(ROOT/'scripts/inventory-source-items.py'))
environment=helpers['initialize']()
source=helpers['Sources']()
from SourceIO.library.utils import TinyPath
from SourceIO.library.utils.pylib.vtf import load_vtf_texture
from SourceIO.library.utils.pylib.image import encode_png
import numpy as np

def digest(data):return hashlib.sha256(data).hexdigest()
def save_source(path):
 data=source.read(path);target=OUT/'raw'/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data);return data

items_path='scripts/items/items_game.txt';items_data=source.read(items_path)
items=helpers['parse_kv'](items_data,items_path)['items_game'];sections=helpers['merge_sections'](items)
paint=items['paint_kits']['282'];assert paint['name']=='cu_ak47_cobra' and paint['style']=='7'
vmts={};missing_includes=[]
pending=['materials/models/weapons/customization/rif_ak47/rif_ak47.vmt','materials/models/weapons/v_models/rif_ak47/ak47.vmt','materials/models/weapons/customization/paints/paint.vmt','materials/models/weapons/customization/paints/custom/bullet_rain_m4.vmt']
while pending:
 p=pending.pop(0)
 if p in vmts:continue
 if not source.exists(p):missing_includes.append(p);continue
 assert len(vmts)<12
 data=save_source(p);parsed=helpers['parse_kv'](data,p);vmts[p]={'text':data.decode('utf-8-sig'),'parsed':parsed,'sha256':digest(data)}
 if 'patch'in parsed and 'include'in parsed['patch']:pending.append(parsed['patch']['include'].replace('\\','/'))
paths=set()
for p in source.entries:
 if p.startswith('materials/models/weapons/customization/rif_ak47/') and p.endswith('.vtf') and '_decal_' not in p:paths.add(p)
paths.add('materials/models/weapons/customization/paints/custom/'+paint['pattern']+'.vtf')
paths.add('materials/models/weapons/customization/uvs/weapon_ak47.vtf')
# Include existing VTFs referenced by the weapon, default material and shared paint inputs.
def visit(value):
 if isinstance(value,dict):
  for k,v in value.items():
   if isinstance(v,str):
    candidate='materials/'+v.replace('\\','/').removesuffix('.vtf')+'.vtf'
    if source.exists(candidate):paths.add(candidate)
   else:visit(v)
for p,v in vmts.items():
 if p.endswith('/rif_ak47.vmt') or p.endswith('/rif_ak47/ak47.vmt') or p.endswith('/paints/paint.vmt'):visit(v['parsed'])
textures=[]
for p in sorted(paths):
 data=save_source(p);pixels,w,h,is_float=load_vtf_texture(data)
 assert not is_float,'Float texture needs a separate lossless export'
 png=encode_png(pixels,w,h,4);target=OUT/'png'/Path(p).relative_to('materials').with_suffix('.png');target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(png)
 rgba=np.frombuffer(pixels,np.uint8).reshape(h,w,4)
 stats={c:{'min':int(rgba[:,:,i].min()),'max':int(rgba[:,:,i].max()),'uniqueValues':int(len(np.unique(rgba[:,:,i]))),'mean':float(rgba[:,:,i].mean())}for i,c in enumerate('RGBA')}
 assert data[:4]==b'VTF\0'
 assert (w,h)==struct.unpack_from('<HH',data,16)
 assert struct.unpack_from('<H',data,24)[0]==1,'Multi-frame VTF needs explicit frame export'
 textures.append({'path':p,'bytes':len(data),'sha256':digest(data),'png':str(target.relative_to(ROOT)),'pngSha256':digest(png),'rgba8Sha256':digest(pixels),'width':w,'height':h,
  'vtfVersion':list(struct.unpack_from('<II',data,4)),'vtfHeaderBytes':struct.unpack_from('<I',data,12)[0],'vtfFlags':struct.unpack_from('<I',data,20)[0],
  'vtfFrameCount':struct.unpack_from('<H',data,24)[0],'vtfHighResFormat':struct.unpack_from('<i',data,52)[0],'vtfMipCount':data[56],'channels':stats})
shader_sources=[{'path':p,'bytes':v['bytes']}for p,v in source.entries.items()if p.endswith(('.vcs','.fxc','.hlsl')) and any(w in p.lower()for w in ['customweapon','weaponpaint','weapon_paint'])]

report={'status':'inputs_extracted_no_composite','completedAt':datetime.now(timezone.utc).isoformat(),'environment':environment,'scriptSha256':digest(Path(__file__).read_bytes()),'helperSha256':digest((ROOT/'scripts/inventory-source-items.py').read_bytes()),'vpk':source.index_info,
 'missingTemplateIncludes':missing_includes,'paintKitId':282,'paintKit':paint,'paintKitDefaults':items['paint_kits']['0'],'repeatedSections':sections,'vmts':vmts,'textures':textures,
 'vpkMatchingShaderSources':shader_sources,'sourceReads':source.reads,'sourceReadBytes':source.total_read_bytes,
 'boundaries':['Original native VTF RGBA8 decoded and encoded losslessly to PNG; no finish synthesis or color conversion.',
 'Names/parameters establish roles, not unverified per-channel formulas.', 'Current official guide may contain CS2 updates; original CS:GO fragment pages are tracked separately.']}
(OUT/'inputs.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print('REDLINE_INPUTS',json.dumps({'textures':len(textures),'bytesRead':source.total_read_bytes,'output':str(OUT),'vmts':list(vmts),'missingTemplateIncludes':missing_includes},ensure_ascii=False))
