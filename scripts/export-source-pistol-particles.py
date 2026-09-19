"""Read-only original PCF closure and VMT/VTF export. Run with factory Blender.
No particle default, child, texture frame or renderer is inferred from its name.
"""
from pathlib import Path
import importlib.util,io,json,struct,sys
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.reference-assets/source-exports/pistol-particles'
spec=importlib.util.spec_from_file_location('pistol_particle_items',ROOT/'scripts/inventory-source-items.py')
items=importlib.util.module_from_spec(spec);spec.loader.exec_module(items)
context=items.initialize();sources=items.Sources()
from SourceIO.library.utils import datamodel
from SourceIO.library.utils.pylib.vtf import load_vtf_texture
from SourceIO.library.utils.pylib.image import encode_png

def write(name,data):
 path=OUT/name;path.parent.mkdir(parents=True,exist_ok=True)
 if path.exists()and path.read_bytes()!=data:raise ValueError('Existing original particle export differs: '+name)
 path.write_bytes(data)
 if path.read_bytes()!=data:raise ValueError('Particle export readback differs: '+name)
 return dict(path=name,bytes=len(data),sha256=items.digest(data))
def jsonfile(name,data):return write(name,(json.dumps(data,indent=2,ensure_ascii=False)+'\n').encode())
def canonical(path):
 path=path.replace('\\','/').lower()
 if not path.startswith('materials/'):path='materials/'+path
 if '..'in Path(path).parts:raise ValueError('Unsafe original material path')
 return path

pcf='particles/weapons/cs_weapon_fx.pcf';raw=sources.read(pcf);dm=datamodel.load(in_file=io.BytesIO(raw))
systems={e.name:e for e in dm.elements if e.type=='DmeParticleSystemDefinition'}
target=systems['weapon_muzzle_flash_pistol'];seen={};fallbacks=[]
def visit(e):
 key=str(e.id)
 if key in seen:return
 seen[key]=dict(id=key,name=e.name,type=e.type,attributes={},attributeTypes={k:type(v).__name__ for k,v in e.items()})
 def value(v):
  if isinstance(v,datamodel.Element):visit(v);return dict(ref=str(v.id),name=v.name)
  if isinstance(v,bytes):return dict(binaryHex=v.hex())
  if isinstance(v,(str,bool,int,float))or v is None:return v
  return [value(x)for x in v]
 seen[key]['attributes']={k:value(v)for k,v in e.items()}
 for k in ['fallback replacement definition','cull replacement definition']:
  if e.get(k):
   name=e[k]
   if name not in systems:raise ValueError('Unresolved original named replacement: '+name)
   fallbacks.append(dict(source=key,field=k,target=str(systems[name].id),name=name));visit(systems[name])
visit(target)
pcfFile=write('original/cs_weapon_fx.pcf',raw)
materials=[];textures={}
for path in sorted({canonical(e['attributes']['material'])for e in seen.values()if e['type']=='DmeParticleSystemDefinition'and e['attributes'].get('material')}):
 data=sources.read(path);definition=items.parse_kv(data,path);file=write('original/'+path,data)
 row=dict(source=path,file=file,definition=definition,textures=[])
 for key,value in items.walk(definition):
  if isinstance(value,str)and ('texture'in str(key).lower()or str(key).lower()in ['$bumpmap','$detail']):
   texturePath=canonical(value.removesuffix('.vtf')+'.vtf')
   if not sources.exists(texturePath):continue
   row['textures'].append(dict(parameter=key,source=texturePath))
   if texturePath in textures:continue
   vtf=sources.read(texturePath)
   if vtf[:4]!=b'VTF\0':raise ValueError('Original particle texture is not VTF')
   major,minor,headerSize=struct.unpack_from('<III',vtf,4);width,height=struct.unpack_from('<HH',vtf,16)
   flags=struct.unpack_from('<I',vtf,20)[0];frames=struct.unpack_from('<H',vtf,24)[0]
   if major!=7 or minor<3 or headerSize<80:raise ValueError('Unreviewed original particle VTF layout')
   resourceCount=struct.unpack_from('<I',vtf,68)[0]
   if 80+resourceCount*8>headerSize:raise ValueError('Invalid VTF resource table')
   resources=[]
   for n in range(resourceCount):
    at=80+n*8;tag=vtf[at:at+3].hex();resourceFlags=vtf[at+3];offset=struct.unpack_from('<I',vtf,at+4)[0]
    resource=dict(tag=tag,flags=resourceFlags,value=offset)
    if tag=='100000'and not resourceFlags&2:
     size=struct.unpack_from('<I',vtf,offset)[0];chunk=vtf[offset+4:offset+4+size]
     if len(chunk)!=size:raise ValueError('Truncated original particle sheet data')
     resource['sheetFile']=write('sheets/'+Path(texturePath).stem+'.bin',chunk)
     resource['decoded']=False
    resources.append(resource)
   texture=dict(source=texturePath,file=write('original/'+texturePath,vtf),version=[major,minor],width=width,height=height,flags=flags,frames=frames,resources=resources,images=[])
   # Installed native decoder accepts only its documented original single-image
   # call. Preserve a multi-frame VTF rather than silently exporting frame zero.
   texture['frameDecodeStatus']='complete'if frames==1 else'unsupported-multiframe-native-decoder'
   for frame in range(frames if frames==1 else 0):
    pixels,w,h,isFloat=load_vtf_texture(vtf)
    if isFloat or w!=width or h!=height:raise ValueError('Unreviewed floating/size particle VTF conversion')
    png=encode_png(pixels,w,h,4);name='textures/'+Path(texturePath).stem+f'-frame-{frame}.png'
    texture['images'].append(dict(frame=frame,file=write(name,png),rgbaSha256=items.digest(pixels)))
   textures[texturePath]=texture
 materials.append(row)
graph=dict(format='source-pistol-particles-v1',build=12426148,root=str(target.id),source=sources.reads[pcf],pcfFile=pcfFile,
 elements=list(seen.values()),namedReplacements=fallbacks,materials=materials,textures=list(textures.values()),
 boundaries=dict(defaults='Absent PCF parameters remain absent; native unpack defaults are not guessed.',runtime='Graph and raw assets only; original operators and shader execution not yet reproduced.'))
graphFile=jsonfile('graph.json',graph)
receipt=dict(format='source-pistol-particles-receipt-v1',context=context,graph=graphFile,sourceFiles=sources.reads,
 systemCount=sum(e['type']=='DmeParticleSystemDefinition'for e in seen.values()),elementCount=len(seen),
 functionNames=sorted({e['attributes']['functionName']for e in seen.values()if 'functionName'in e['attributes']}),
 materialCount=len(materials),textureCount=len(textures),textureFrameCount=sum(v['frames']for v in textures.values()))
jsonfile('receipt.json',receipt);print('PARTICLE_EXPORT',json.dumps(receipt,ensure_ascii=False))
