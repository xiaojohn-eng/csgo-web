"""Isolated world re-export adding exact HDR atlas UVs and original face IDs.

Instruments the pinned import functions only inside this factory-startup process.
Does not edit SourceIO, original GLBs, the game or public assets.
"""
from pathlib import Path
import importlib.util
import inspect
import json
import sys
import textwrap
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.reference-assets/source-exports/dust2-lightmapped'
atlas=json.loads((OUT/'lightmaps.json').read_text())
faces=atlas['faces'];width,height=atlas['width'],atlas['height']
spec=importlib.util.spec_from_file_location('source_items',ROOT/'scripts/inventory-source-items.py')
items=importlib.util.module_from_spec(spec);spec.loader.exec_module(items);items.initialize()
from SourceIO.blender_bindings.source1.bsp.entities.abstract_entity_handlers import AbstractEntityHandler
import SourceIO.blender_bindings.source1.bsp.import_bsp as bsp_import

def uv_for(face_id,points):
    face=faces[face_id];x,y=face['atlas']
    if face['offset']<0:
        return np.tile([(x+.5)/width,1-(y+.5)/height],(len(points),1))
    vectors=np.array(face['lightmapVectors'],dtype=np.float64)
    luxels=np.asarray(points,dtype=np.float64)@vectors[:,:3].T+vectors[:,3]-np.asarray(face['mins'])
    return np.column_stack(((x+luxels[:,0]+.5)/width,1-(y+luxels[:,1]+.5)/height))

def assign_brush_ids(mesh,ids):
    if len(mesh.polygons)!=len(ids):raise ValueError('Original brush face order differs')
    attribute=mesh.attributes.new('_source_face_id','INT','FACE')
    attribute.data.foreach_set('value',ids)

def decorate_brush(mesh):
    ids=np.empty(len(mesh.polygons),dtype=np.int32)
    mesh.attributes['_source_face_id'].data.foreach_get('value',ids)
    lightmap=mesh.uv_layers.get('lightmap')
    source_face=mesh.uv_layers.new(name='SourceFace')
    for polygon,face_id in zip(mesh.polygons,ids):
        points=[mesh.vertices[mesh.loops[i].vertex_index].co[:] for i in polygon.loop_indices]
        uv=uv_for(int(face_id),points)
        for index,value in zip(polygon.loop_indices,uv):
            lightmap.data[index].uv=value
            source_face.data[index].uv=(float(face_id),0.)

def decorate_displacement(mesh,face_id,points,vertex_indices):
    # Source CCoreDispSurface::CalcLuxelCoords assigns the adjusted four corners
    # (0,0), (0,V), (U,V), (U,0); CalcDispSurfCoords interpolates that grid.
    # Displacement lightmap extents are NOT world-space texinfo projections.
    side=int(round(len(points)**.5))
    if side*side!=len(points):raise ValueError('Displacement grid is not square')
    face=faces[face_id];x,y=face['atlas']
    rows,columns=np.indices((side,side),dtype=np.float64)
    u=columns.flatten()/(side-1)*(face['width']-1)
    v=rows.flatten()/(side-1)*(face['height']-1)
    uv=np.column_stack(((x+u+.5)/width,1-(y+v+.5)/height))
    mesh.uv_layers.new(name='lightmap').data.foreach_set('uv',uv[vertex_indices].astype(np.float32).flatten())
    ids=np.zeros((len(vertex_indices),2),dtype=np.float32);ids[:,0]=face_id
    mesh.uv_layers.new(name='SourceFace').data.foreach_set('uv',ids.flatten())
    assign_brush_ids(mesh,np.full(len(mesh.polygons),face_id,dtype=np.int32))

def replace_once(text,old,new):
    if text.count(old)!=1:raise ValueError('Pinned SourceIO instrumentation mismatch: '+old)
    return text.replace(old,new)

original=AbstractEntityHandler._load_brush_model
code=textwrap.dedent(inspect.getsource(original))
code=replace_once(code,'faces = []\n','faces = []\n    source_face_ids = []\n')
code=replace_once(code,'for map_face in bsp_faces[model.first_face:model.first_face + model.face_count]:',
    'for source_face_id, map_face in enumerate(bsp_faces[model.first_face:model.first_face + model.face_count],model.first_face):')
code=replace_once(code,'faces.append(face)','faces.append(face)\n        source_face_ids.append(source_face_id)')
code=replace_once(code,'if mesh_data.validate(verbose=True):','_assign_brush_ids(mesh_data,source_face_ids)\n    if mesh_data.validate(verbose=True):')
code=replace_once(code,'return mesh_obj','_decorate_brush(mesh_data)\n    return mesh_obj')
namespace={**original.__globals__,'_assign_brush_ids':assign_brush_ids,'_decorate_brush':decorate_brush}
exec(compile(code,'<Source brush HDR face attribution>','exec'),namespace)
AbstractEntityHandler._load_brush_model=namespace['_load_brush_model']

original=bsp_import.import_disp
code=inspect.getsource(original)
fix_spec=importlib.util.spec_from_file_location('source_displacement_start',ROOT/'scripts/source-displacement-start.py')
fix=importlib.util.module_from_spec(fix_spec);fix_spec.loader.exec_module(fix)
code=fix.instrument(code)
code=replace_once(code,"uv_data.foreach_set('uv', disp_uv[vertex_indices].flatten())",
    "uv_data.foreach_set('uv', disp_uv[vertex_indices].flatten())\n        _decorate_displacement(mesh_data,disp_info.map_face,disp_vertices,vertex_indices)")
namespace={**original.__globals__,'_decorate_displacement':decorate_displacement,'_source_displacement_start':fix.source_start}
exec(compile(code,'<Source displacement HDR face attribution>','exec'),namespace)
bsp_import.import_disp=namespace['import_disp']

converter=ROOT/'scripts/convert-source-map.py'
code=converter.read_text()
code=replace_once(code,"root['sourceMetersPerUnit']=args.meters_per_unit",
    "root['sourceMetersPerUnit']=args.meters_per_unit\n    root['sourceLightmaps']='lightmaps.json'\n    root['sourceLightmapUV']='TEXCOORD_1'\n    root['sourceFaceUV']='TEXCOORD_2'")
sys.argv=['blender','--factory-startup','--','--download-complete','--layer','world','--output',str(OUT)]
exec(compile(code,str(converter),'exec'),{'__file__':str(converter),'__name__':'__main__'})
(OUT/'displacement-start-corrections.json').write_text(json.dumps(fix.corrections,indent=2)+'\n')
