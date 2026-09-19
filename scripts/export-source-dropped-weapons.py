"""Export the six shipped dropped weapon models and their original PHY shapes.
Read-only VPK inputs; only output/fidelity-character/dropped-weapons is written.
Run in factory-startup Blender. Raw IVP -> Source basis is the independently
executed conversion already covered by audit-source-physics-models.py.
"""
from pathlib import Path
import importlib.util,json,struct
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output/fidelity-character/dropped-weapons';OUT.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('source_items',ROOT/'scripts/inventory-source-items.py');items=importlib.util.module_from_spec(spec);spec.loader.exec_module(items)
context=items.initialize();sources=items.Sources()
from SourceIO.library.models.mdl.v49 import MdlV49
from SourceIO.library.models.phy.phy import Phy
from SourceIO.library.utils import MemoryBuffer
from SourceIO.library.models.vvd import Vvd
from SourceIO.library.models.vtx.v7.vtx import Vtx
from SourceIO.blender_bindings.models.common import merge_meshes
from SourceIO.library.utils.pylib.vtf import load_vtf_texture
from SourceIO.library.utils.pylib.image import encode_png
catalog=json.loads((ROOT/'research/source-items-catalog.json').read_text())
surface_path='scripts/surfaceproperties_cs.txt'
surface_raw=sources.read(surface_path);surfaces=items.parse_kv(surface_raw,surface_path)
def resolve_surface(name,seen=()):
 assert name not in seen
 row=surfaces[name];return {**(resolve_surface(row['base'],seen+(name,)) if 'base'in row else {}),**row}
weapon_surface=resolve_surface('weapon')
models=[];render_models=[];physics_models=[];files={}
def write(name,data):
 path=OUT/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data);assert path.read_bytes()==data
 row=dict(path=name,bytes=len(data),sha256=items.digest(data));files[name]=row;return row
def stage_source(path):
 raw=sources.read(path);write('original/'+path,raw);return raw

def export_weapon(weapon,dropped,held,phy_raw,phy,record):
 mdl=MdlV49.from_buffer(MemoryBuffer(sources.read(dropped)))
 vvd=Vvd.from_buffer(MemoryBuffer(stage_source(dropped.removesuffix('.mdl')+'.vvd')))
 vtx=Vtx.from_buffer(MemoryBuffer(stage_source(dropped.removesuffix('.mdl')+'.dx90.vtx')))
 checksum=mdl.header.checksum&0xffffffff
 assert phy.header.checksum==checksum==vvd.header.checksum==vtx.header.checksum
 assert len(phy.solids)==1 and mdl.bones[0].name=='weapon_hand_R' and mdl.bones[0].parent_id==-1
 assert max(abs(x)for x in mdl.bones[0].position)<1e-7
 assert np.max(np.abs(np.array(mdl.bones[0].quat)-[0,0,0,1]))<1e-7
 chunks=[];offset=0;meshes=[];all_positions=[]
 def array(name,a):
  nonlocal offset
  data=np.asarray(a,dtype='<u4' if name=='indices' else '<f4').tobytes();view=dict(byteOffset=offset,byteLength=len(data),count=len(a));chunks.append(data);offset+=len(data);return view
 for body,vtbody in zip(mdl.body_parts,vtx.body_parts):
  for body_index,(model,vtmodel)in enumerate(zip(body.models,vtbody.models)):
   if not model.vertex_count:continue
   # Original default bodygroup 0: keep alternate silencer/strap visibility in
   # metadata without drawing an unused holster strap by default.
   vv=vvd.lod_data[0][model.vertex_offset:model.vertex_offset+model.vertex_count]
   selected,indices,materials=merge_meshes(model,vtmodel.model_lods[0]);vertices=vv[selected]
   indices=np.flip(np.asarray(indices,dtype=np.uint32)).reshape(-1,3);materials=np.asarray(materials)[::-1]
   # SourceIO's audited LOD0 index order produces CCW triangles. UV remains the
   # original top-left VTF UV (no Blender/glTF round-trip or double V flip).
   for material in sorted(set(materials.tolist())):
    chosen=indices[materials==material].flatten()
    used=np.unique(chosen);mapping={int(v):i for i,v in enumerate(used)}
    positions=vertices['vertex'][used];normals=vertices['normal'][used];uv=vertices['uv'][used]
    assert np.isfinite(positions).all() and np.isfinite(normals).all() and np.isfinite(uv).all()
    all_positions.extend(positions.tolist())
    meshes.append(dict(name=model.name,bodygroup=body.name,bodygroupIndex=body_index,visibleByDefault=body_index==0,material=int(material),position=array('position',positions),normal=array('normal',normals),uv=array('uv',uv),indices=array('indices',np.asarray([mapping[int(i)]for i in chosen]))))
 meshfile=write(weapon+'/mesh.bin',b''.join(chunks))
 materials=[]
 for index,material in enumerate(mdl.materials):
  if not any(m['material']==index for m in meshes):continue
  candidates=['materials/'+material.name+'.vmt']+['materials/'+prefix.replace('\\','/').strip('/')+'/'+material.name+'.vmt'for prefix in mdl.materials_paths]
  path=next(p.lower() for p in candidates if sources.exists(p.lower()));raw=stage_source(path);definition=items.parse_kv(raw,path)
  assert 'vertexlitgeneric'in definition,(weapon,path,definition)
  values=definition['vertexlitgeneric'];textures={}
  for parameter in ['$basetexture','$bumpmap','$phongexponenttexture']:
   value=values.get(parameter)
   if not value:continue
   source='materials/'+value.replace('\\','/').lower().removesuffix('.vtf')+'.vtf'
   tex=stage_source(source);pixels,w,h,isfloat=load_vtf_texture(tex);assert not isfloat
   png=write('textures/'+source.removeprefix('materials/').removesuffix('.vtf')+'.png',encode_png(pixels,w,h,4))
   textures[parameter]=dict(source=source,file=png,width=w,height=h,rgbaSha256=items.digest(pixels))
  materials.append(dict(index=index,name=material.name,source=path,parameters=values,textures=textures))
 convex=[]
 for solid in phy.solids:
  nodes=[solid.collision_model.root_tree]
  while nodes:
   node=nodes.pop()
   if node.left_node:nodes.append(node.left_node)
   if node.right_node:nodes.append(node.right_node)
   leaf=node.convex_leaf
   if not leaf:continue
   assert not leaf.has_children,'Unexpected indirect PHY leaf needs independent handling'
   if not leaf.triangles:continue
   ids=sorted(leaf.unique_vertices);ivp=np.array([struct.unpack_from('<4f',phy_raw,leaf.vertex_data_offset+i*16)[:3]for i in ids])
   # Native IVP x,y,z -> Source x,z,-y in inches; the runtime applies the same
   # Source->WebGL basis to geometry and colliders exactly once.
   points=ivp[:,[0,2,1]]/.0254;points[:,2]*=-1
   assert len(points)>=4 and np.isfinite(points).all()
   convex.append(dict(boneId=leaf.bone_id,points=points.flatten().tolist(),triangles=len(leaf.triangles)))
 assert convex
 kv=items.parse_kv(phy.kv.encode(),'weapon PHY');solid=kv['solid'];assert solid['index']=='0'
 physical=dict(weapon=weapon,model=dropped,checksum=checksum,source=record['phy']['path'],mass=float(solid['mass']),damping=float(solid['damping']),rotdamping=float(solid['rotdamping']),inertia=float(solid['inertia']),surfaceprop=solid['surfaceprop'],friction=float(weapon_surface['friction']),elasticity=float(weapon_surface['elasticity']),surfaceSource=dict(path=surface_path,sha256=items.digest(surface_raw),baseChain=['weapon','metal','solidmetal']),originalVolume=float(solid['volume']),convex=convex,handBone='weapon_hand_R')
 physics_models.append(physical)
 render_models.append(dict(weapon=weapon,source=dropped,checksum=checksum,mesh=meshfile,meshes=meshes,materials=materials,sourceBounds=[np.min(all_positions,axis=0).tolist(),np.max(all_positions,axis=0).tolist()],coordinateSystem='Source x forward y left z up; original inches; root is weapon_hand_R identity'))
for weapon,item_id in [('vandal','7'),('m4a4','16'),('awp','9'),('glock','4'),('usp','61'),('deagle','1')]:
 item=next(w for w in catalog['weapons'] if w['id']==item_id)
 paths={k:v for k,v in item['resolvedDefinition'].items() if 'model' in k}
 print(weapon,paths,flush=True)
 dropped=paths['model_dropped'];held=paths['model_world']
 record=dict(weapon=weapon,itemId=item_id,dropped=dropped,held=held,models={})
 for role,path in [('dropped',dropped),('held',held)]:
  raw=stage_source(path);mdl=MdlV49.from_buffer(MemoryBuffer(raw))
  record['models'][role]=dict(path=path,checksum=mdl.header.checksum,flags=int(mdl.header.flags),bones=[dict(name=b.name,parent=b.parent_id,position=list(b.position),quaternion=list(b.quat),inverseBind=b.pose_to_bone.T.tolist(),physicsBone=b.physics_bone_index)for b in mdl.bones],materials=[m.name for m in mdl.materials],materialPaths=list(mdl.materials_paths),bodyparts=[dict(name=b.name,models=[m.name for m in b.models])for b in mdl.body_parts])
 phy_path=dropped.removesuffix('.mdl')+'.phy';raw=sources.read(phy_path);phy=Phy.from_buffer(MemoryBuffer(raw))
 record['phy']=dict(path=phy_path,checksum=phy.header.checksum,solids=len(phy.solids),keyvalues=phy.kv)
 write('original/'+phy_path,raw)
 export_weapon(weapon,dropped,held,raw,phy,record)
 models.append(record)
report=dict(format='source-dropped-weapon-inventory-v1',context=context,models=models,sources=sources.reads)
(OUT/'inventory.json').write_text(json.dumps(report,indent=2,default=lambda x:x.tolist() if hasattr(x,'tolist')else str(x))+'\n')
print('DROPPED_WEAPON_INVENTORY',[(m['weapon'],len(m['models']['dropped']['bones']),m['phy']['solids'])for m in models])

physics=dict(format='source-dropped-weapon-physics-v1',build=12426148,metersPerSourceUnit=.0254,models=physics_models)
write('physics.json',(json.dumps(physics,indent=2)+'\n').encode())
write('models.json',(json.dumps(dict(format='source-dropped-weapon-models-v1',build=12426148,models=render_models),indent=2)+'\n').encode())
write('receipt.json',(json.dumps(dict(format='source-dropped-weapon-receipt-v1',context=context,sources=sources.reads,files=list(files.values())),indent=2)+'\n').encode())
# Server startup receives the same small original convex definitions; the client
# fetches original model buffers/textures by the receipts, not by guessed names.
(ROOT/'game/source-dropped-weapon-physics.json').write_text(json.dumps(physics,indent=2)+'\n')
(ROOT/'game/source-dropped-weapon-resources.json').write_text(json.dumps([v for k,v in files.items() if not k.startswith('original/')],indent=2)+'\n')
print('DROPPED_EXPORT_OK',[(m['weapon'],len(m['meshes']))for m in render_models],flush=True)
