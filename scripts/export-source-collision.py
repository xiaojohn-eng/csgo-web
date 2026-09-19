"""Export actual Dust2 BSP halfspaces, displacement grids and VPHY convex leaves.

Run with Blender --background --factory-startup --python-exit-code 1 --python
scripts/export-source-collision.py -- --download-complete. No scene or game edit.
"""
from __future__ import annotations
import argparse
from collections import Counter,defaultdict
import hashlib
import itertools
import json
from pathlib import Path
import re
import struct
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.reference-assets/source-exports/dust2/collision-ivp-corrected'
PIN='cfc2591d096628a35f570aa830ab75cc8665108b'

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--download-complete',action='store_true',required=True)
    parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    import bpy
    import numpy as np
    from mathutils import Euler,Matrix
    if not bpy.app.background or '--factory-startup' not in sys.argv:raise ValueError('Independent factory-startup Blender required')
    source=ROOT/'.tools/SourceIO';game=ROOT/'.reference-assets/csgo-legacy/csgo'
    acf=(game.parent/'steamapps/appmanifest_740.acf').read_text()
    if not re.search(r'"StateFlags"\s+"4"',acf):raise ValueError('Download completion gate failed')
    if subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()!=PIN:raise ValueError('SourceIO pin changed')
    if subprocess.check_output(['git','-C',str(source),'status','--porcelain','--untracked-files=no'],text=True).strip():raise ValueError('SourceIO source modified')
    sys.path.insert(0,str(source.parent))
    from SourceIO.library.utils import TinyPath,FileBuffer,MemoryBuffer
    from SourceIO.library.shared.app_id import SteamAppId
    from SourceIO.library.shared.content_manager import ContentManager
    from SourceIO.library.shared.content_manager.providers.loose_files import LooseFilesContentProvider
    from SourceIO.library.shared.content_manager.providers.vpk_provider import VPKContentProvider
    from SourceIO.library.source1.bsp.bsp_file import open_bsp
    import SourceIO.library.source1.bsp.lumps
    from SourceIO.library.models.phy.phy import Phy,SolidHeader,CollisionModel
    from SourceIO.library.models.mdl.v49 import MdlV49
    from SourceIO.library.models.mdl.structs.header import StudioHDRFlags
    from SourceIO.library.utils.math_utilities import convert_rotation_source1_to_blender
    started=time.perf_counter();OUT.mkdir(parents=True,exist_ok=True)
    inventory_root=ROOT/'output/source1/de_dust2'
    inventory=json.loads((inventory_root/'inventory.json').read_text())
    brushdata=json.loads((inventory_root/'collision-brushes.json').read_text())
    sourceprops=json.loads((inventory_root/'static-props.json').read_text())['props']
    entities=json.loads((inventory_root/'entities.json').read_text())
    metadata=json.loads((OUT.parent/'map-metadata.json').read_text());scale=metadata['outerMetersPerUnit']
    axis_evidence=json.loads((ROOT/'output/tests/source-physics-axis.json').read_text())
    if axis_evidence['status']!='original_App740_SSE_conversion_block_passed' or axis_evidence['ivpToSource']!='(x,z,-y)/.0254':
        raise ValueError('Current-build native IVP axis conversion evidence is missing')
    cm=ContentManager();bsp_path=game/'maps/de_dust2.bsp'
    bsp=open_bsp(TinyPath(bsp_path),FileBuffer(TinyPath(bsp_path)),cm,SteamAppId.COUNTER_STRIKE_GO)
    providers=[bsp.get_lump('LUMP_PAK'),LooseFilesContentProvider(TinyPath(game),SteamAppId.COUNTER_STRIKE_GO),
               VPKContentProvider(TinyPath(game/'pak01_dir.vpk'),SteamAppId.COUNTER_STRIKE_GO)]
    for provider in providers:cm.add_child(provider)
    cm.priority_list=providers
    # Source SDK 2013 public bspflags.h. Exact CS:GO dynamic entity policies are
    # deliberately outside this static-world module.
    masks={'player':0x0201400b,'bullet':0x46004003,'projectile':0x0200400b}
    report=dict(format='source-map-collision-v1',sourceMap='de_dust2',sourceBspSha256=inventory['bspSha256'],
        metersPerSourceUnit=scale,coordinates='Y-up metres; Source(x,y,z)->scale*(x,z,-y)',
        masks=masks,geometries=[],colliders=[],sensors=[],deferredEntities=[],missingPHY=[],errors=[],
        physicsAxis=dict(nativeBinarySha256=axis_evidence['binarySha256'],sourceToIVP=axis_evidence['sourceToIVP'],
            ivpToSource=axis_evidence['ivpToSource'],correction='Negate SourceIO-returned column 2 after its Y/Z swap; applies to world VPHY and static PHY.',
            supersedes='Old collision/ omitted IVP Y sign and is not valid original-world collision evidence.'),
        limits=['MASK_SOLID is the explicit static projectile mask; original CS:GO projectile timing/filter rules are not implemented.',
                'Displacement collision uses original full BSP grids for hull/ray surfaces. Original virtualterrain cache spans are validated and retained, not interpreted as VPHY.',
                'Original material friction/restitution, breakability and entity I/O remain separate.'],
        sources={'brushes':'original LUMP_PLANES/BRUSHSIDES/BRUSHES + model tree ownership',
                 'worldVphy':'original bounded LUMP_PHYSCOLLIDE VPHY convex leaves',
                 'displacement':'original LUMP_DISPINFO/DISP_VERTS/DISP_TRIS, not world.glb',
                 'staticProps':'original MDL checksum-matched PHY convex leaves; no render-mesh/AABB substitute'})
    def save(stage):
        print('SOURCE_COLLISION_STAGE',stage,'shapes',len(report['geometries']),'colliders',len(report['colliders']),flush=True)
    def transform(points):
        result=np.asarray(points,np.float64)[...,[0,2,1]].copy()*scale;result[...,2]*=-1;return result
    flip=np.array([[1,0,0],[0,0,1],[0,-1,0]],np.float64)
    def rotation(angles):
        matrix=np.asarray(Euler(convert_rotation_source1_to_blender(angles),'XYZ').to_matrix(),np.float64)
        q=Matrix((flip@matrix@flip.T).tolist()).to_quaternion()
        return matrix,[q.x,q.y,q.z,q.w]
    def geometry(points,kind,source,triangles=None):
        points=np.asarray(points,np.float64)
        if len(points)<(4 if kind=='convex' else 3) or not np.isfinite(points).all():raise ValueError('Invalid original geometry '+str(source))
        center=points.mean(axis=0);local=transform(points-center).astype(np.float32)
        value=dict(id=len(report['geometries']),kind=kind,vertices=local.ravel().tolist(),source=source)
        if triangles is not None:value['indices']=np.asarray(triangles,np.uint32).ravel().tolist()
        report['geometries'].append(value);return value['id'],center
    def instance(geo,center,roles,source,origin=(0,0,0),angles=(0,0,0),uniform=1,sensor=False):
        matrix,q=rotation(angles);p=transform(matrix@(np.asarray(center)*uniform)+np.asarray(origin))
        value=dict(geometry=geo,translation=p.tolist(),rotation=q,scale=uniform,roles=roles,source=source)
        (report['sensors'] if sensor else report['colliders']).append(value)
    def roles_for(contents,allowed):return [role for role in allowed if contents&masks[role]]
    def brush_vertices(index):
        brush=brushdata['brushes'][index]
        sides=brushdata['sides'][brush['firstSide']:brush['firstSide']+brush['sideCount']]
        planes=[brushdata['planes'][side['plane']] for side in sides]
        coeff=np.array([p['normal'] for p in planes]);dist=np.array([p['dist'] for p in planes]);points=[]
        for triple in itertools.combinations(range(len(planes)),3):
            m=coeff[list(triple)]
            if abs(np.linalg.det(m))<1e-9:continue
            v=np.linalg.solve(m,dist[list(triple)])
            # Use numerical solve tolerance only. Source's coarse trace epsilon
            # must not create extra near-outside corners before a native hull.
            if np.all(coeff@v-dist<=1e-7):points.append(v)
        if not points:raise ValueError('No bounded source brush vertices '+str(index))
        points=np.unique(np.round(np.array(points),9),axis=0)
        if np.linalg.matrix_rank(points-points.mean(axis=0),tol=1e-6)<3:raise ValueError('Nonvolumetric source brush '+str(index))
        if np.max(coeff@points.T-dist[:,None])>1.1e-7:raise ValueError('Source halfspace violation')
        return points
    models={m['model']:m for m in brushdata['models']};entity_by_model={int(e['model'][1:]):e for e in entities if str(e.get('model','')).startswith('*')}
    brush_cache={}
    for model_id,model in models.items():
        entity=entity_by_model.get(model_id,{'classname':'worldspawn'})
        classname=entity['classname'];sensor=classname.startswith('trigger_') or classname in ('func_bomb_target','func_buyzone')
        origin=[float(v) for v in entity.get('origin','0 0 0').split()];angles=[float(v) for v in entity.get('angles','0 0 0').split()]
        enabled=entity.get('startdisabled','0')!='1'
        if model_id and not sensor and classname not in ('func_brush','func_clip_vphysics'):
            report['deferredEntities'].append(entity);continue
        if classname=='func_brush' and (entity.get('solidity')=='1' or not enabled):
            report['deferredEntities'].append(entity);continue
        if not enabled:report['deferredEntities'].append(entity);continue
        for index in model['brushIds']:
            contents=brushdata['brushes'][index]['contents']
            roles=['projectile'] if classname=='func_clip_vphysics' else roles_for(contents,['player','bullet'])
            if not roles and not sensor:continue
            if index not in brush_cache:brush_cache[index]=geometry(brush_vertices(index),'convex',dict(layer='brush',brush=index,contents=contents))
            geo,center=brush_cache[index]
            instance(geo,center,roles,dict(layer='brush',brush=index,model=model_id,classname=classname,
                hammerid=entity.get('hammerid'),contents=contents),origin,angles,sensor=sensor)
    save('brush halfspaces')
    def phy_leaves(solid,buffer):
        root=solid.collision_model.root_tree;nodes=[root];leaves=[];all_ids=set()
        while nodes:
            node=nodes.pop()
            if node.left_node is not None:nodes.append(node.left_node)
            if node.right_node is not None:nodes.append(node.right_node)
            if node.convex_leaf is not None:
                leaf=node.convex_leaf;all_ids.update(leaf.unique_vertices)
                if not leaf.has_children and leaf.triangles:leaves.append(leaf)
        if not all_ids or min(all_ids)<0:raise ValueError('Invalid VPHY leaf index/tree')
        # Current App740 vphysics.so ConvexFromVerts SSE block independently
        # proves IVP=(Source.x,-Source.z,Source.y)*.0254. SourceIO swaps IVP Y/Z
        # but omits the negative sign. Its column 2 must be negated before it is
        # treated as Source Z; otherwise non-symmetric props and world VPHY are
        # reflected through the model/world XY plane. No render bbox inference.
        # Real world trees may have no convex leaf on the root. Each leaf has an
        # explicit relative vertex-table pointer; share reads by that actual span.
        groups={}
        for leaf in leaves:
            key=leaf.vertex_data_offset;entry=groups.get(key)
            if entry is None or max(leaf.unique_vertices)>entry[1]:groups[key]=(leaf,max(leaf.unique_vertices))
        tables={}
        for key,(leaf,last) in groups.items():
            source_vertices=CollisionModel.get_vertex_data(buffer,leaf,last+1)/.0254
            source_vertices[:,2]*=-1
            tables[key]=source_vertices
        result=[]
        for leaf in leaves:
            vertices=tables[leaf.vertex_data_offset]
            ids=np.array(sorted(leaf.unique_vertices),np.int32);tri=np.array(leaf.triangles,np.int32)
            if ids.max()>=len(vertices):raise ValueError('VPHY index outside bounded vertex block')
            indices=np.searchsorted(ids,tri)
            result.append((vertices[ids],indices,leaf))
        return result
    data=(inventory_root/'lumps/29-physics_collide.bin').read_bytes();offset=0;world_solids=0
    while offset<len(data):
        model_id,data_size,script_size,count=struct.unpack_from('<4i',data,offset);offset+=16
        if model_id==-1:
            if (data_size,script_size,count)!=(-1,0,0) or offset!=len(data):raise ValueError('VPHY terminal mismatch')
            break
        end=offset+data_size;script=data[end:end+script_size].decode('latin1')
        content_rows={int(i):int(c) for i,c in re.findall(r'staticsolid\s*\{\s*"index"\s*"(\d+)"\s*"contents"\s*"(\d+)"',script)}
        for solid_index in range(count):
            size=struct.unpack_from('<I',data,offset)[0]+4
            if offset+size>end:raise ValueError('VPHY outside model span')
            buffer=MemoryBuffer(data[offset:offset+size]);solid=SolidHeader.from_buffer(buffer);offset+=size;world_solids+=1
            contents=content_rows.get(solid_index,1)
            # Player/ray BSP brush geometry is already present. Only the world
            # VPHY contributes projectile collision, avoiding duplicate contacts.
            entity=entity_by_model.get(model_id,{})
            active=model_id==0 or (entity.get('classname')=='func_brush' and entity.get('startdisabled','0')!='1' and entity.get('solidity')!='1')
            roles=roles_for(contents,['projectile']) if active else []
            origin=[float(v) for v in entity.get('origin','0 0 0').split()]
            angles=[float(v) for v in entity.get('angles','0 0 0').split()]
            for leaf_index,(points,indices,leaf) in enumerate(phy_leaves(solid,buffer)):
                geo,center=geometry(points,'convex',dict(layer='worldVphy',model=model_id,solid=solid_index,leaf=leaf_index,contents=contents),indices)
                if roles:instance(geo,center,roles,dict(layer='worldVphy',model=model_id,solid=solid_index,leaf=leaf_index,contents=contents),origin,angles)
        if offset!=end:raise ValueError('VPHY solid span not exact')
        offset=end+script_size
    report['worldVphySolidCount']=world_solids;save('world VPHY')
    # Actual BSP displacement hull/ray mesh construction, separately sourced
    # from original grid vectors. All current Dust2 contents=SOLID, minTess low
    # flags=0; flag variations require an explicit branch, not blanket collision.
    infos=bsp.get_lump('LUMP_DISPINFO').infos;verts=bsp.get_lump('LUMP_VERTICES').vertices
    edges=bsp.get_lump('LUMP_EDGES').edges;surf=bsp.get_lump('LUMP_SURFEDGES').surf_edges
    offsets=bsp.get_lump('LUMP_DISP_VERTS').transformed_vertices;chunks=defaultdict(lambda:[[],[]]);displacement_count=0
    tags=np.frombuffer((inventory_root/'lumps/48-disp_triangles.bin').read_bytes(),dtype='<u2')
    for index,info in enumerate(infos):
        if info.min_tess&0xffff:raise ValueError('Unreviewed displacement collision flags')
        face=info.get_source_face(bsp);se=surf[face.first_edge:face.first_edge+face.edge_count]
        base=np.asarray(verts[edges[np.abs(se),1-(se>0).astype(np.uint8)]],np.float64)
        if len(base)!=4:raise ValueError('Displacement base is not quad')
        start=int(np.argmin(np.linalg.norm(base-np.asarray(info.start_position),axis=1)))
        if np.linalg.norm(base[start]-np.asarray(info.start_position))>.1:raise ValueError('Displacement start corner mismatch')
        n=(1<<info.power)+1;points=[]
        for row in range(n):
            left=base[start]+(base[(start+1)&3]-base[start])*row/(n-1)
            right=base[(start+3)&3]+(base[(start+2)&3]-base[(start+3)&3])*row/(n-1)
            points.extend(left+(right-left)*column/(n-1) for column in range(n))
        points=np.asarray(points)+offsets[info.disp_vert_start:info.disp_vert_start+n*n];indices=[]
        for row in range(n-1):
            for column in range(n-1):
                i=row*n+column
                indices.extend([(i,i+1,i+n),(i+1,i+n+1,i+n)] if i&1 else [(i,i+n+1,i+n),(i,i+1,i+n+1)])
        tri_tags=tags[info.disp_tri_start:info.disp_tri_start+len(indices)]
        if len(tri_tags)!=len(indices):raise ValueError('Missing original displacement triangle tags')
        if np.any(tri_tags&32):raise ValueError('Explicit removed displacement triangles need separate handling')
        key=(*np.floor(points.mean(axis=0)/1024).astype(int),info.contents)
        cverts,ctris=chunks[key];base_index=len(cverts);cverts.extend(points.tolist());ctris.extend((np.asarray(indices)+base_index).tolist());displacement_count+=1
    for key,(points,indices) in chunks.items():
        geo,center=geometry(points,'trimesh',dict(layer='displacement',grid=list(map(int,key[:3])),contents=key[3]),indices)
        instance(geo,center,roles_for(key[3],masks),dict(layer='displacement',grid=list(map(int,key[:3])),contents=key[3]))
    physdisp=(inventory_root/'lumps/28-physics_displacement.bin').read_bytes();n=struct.unpack_from('<H',physdisp)[0]
    sizes=struct.unpack_from('<'+'H'*n,physdisp,2)
    if n!=len(infos) or 2+2*n+sum(size for size in sizes if size!=65535)!=len(physdisp):raise ValueError('Original virtualterrain spans do not match')
    report['displacements']=dict(sourceCount=displacement_count,chunks=len(chunks),virtualTerrainSpans=n,
        virtualTerrainBytes=len(physdisp),virtualTerrainGeometryDecoded=False,sourceTriangleTags=dict(Counter(map(int,tags))))
    save('displacement collision grids')
    prop_cache={};phy_verified=[]
    for index,prop in enumerate(sourceprops):
        if prop['solid']!=6:continue
        name=prop['model']
        if name not in prop_cache:
            path=TinyPath(name);buffer=cm.find_file(path.with_suffix('.phy'))
            if buffer is None:prop_cache[name]=None
            else:
                raw=buffer.read();buffer.seek(0);phy=Phy.from_buffer(buffer);mdl=MdlV49.from_buffer(cm.find_file(path))
                if phy.header.checksum!=(mdl.header.checksum&0xffffffff):raise ValueError('MDL/PHY checksum mismatch: '+name)
                if not mdl.header.flags&StudioHDRFlags.STATIC_PROP:raise ValueError('Nonstatic PHY bone pose requires separate mapping: '+name)
                # All 616 original Dust2 solid models have exactly one identity
                # bind root (audit-source-physics-models.py). Do not silently
                # extend this model-space PHY policy to a nonidentity bone tree.
                if len(mdl.bones)!=1 or mdl.bones[0].parent_id!=-1 or not np.array_equal(mdl.bones[0].matrix,np.eye(4)) or not np.array_equal(mdl.bones[0].pose_to_bone.T,np.eye(4)[:3]):
                    raise ValueError('Original static PHY model requires a separately verified bone mapping: '+name)
                shapes=[]
                for solid_index,solid in enumerate(phy.solids):
                    for leaf_index,(points,indices,leaf) in enumerate(phy_leaves(solid,buffer)):
                        shapes.append(geometry(points,'convex',dict(layer='propPhy',model=name,solid=solid_index,leaf=leaf_index,bone=leaf.bone_id),indices))
                if not shapes:raise ValueError('Empty PHY for solid prop '+name)
                prop_cache[name]=shapes;phy_verified.append(dict(model=name,checksum=phy.header.checksum,sha256=hashlib.sha256(raw).hexdigest(),convexLeaves=len(shapes)))
        shapes=prop_cache[name]
        if shapes is None:report['missingPHY'].append(dict(index=index,model=name,origin=prop['origin'],rotation=prop['rotation']));continue
        for geo,center in shapes:
            instance(geo,center,list(masks),dict(layer='propPhy',prop=index,model=name,solid=6),prop['origin'],prop['rotation'],prop.get('uniform_scale') or 1)
    report['staticPhyModels']=phy_verified;report['deferredEntities'].extend(e for e in entities if e['classname']=='prop_physics_multiplayer')
    report['stats']=dict(geometries=len(report['geometries']),colliders=len(report['colliders']),sensors=len(report['sensors']),
        sourceLayers=dict(Counter(c['source']['layer'] for c in report['colliders'])),
        roles={role:sum(role in c['roles'] for c in report['colliders']) for role in masks},
        missingSolidPropInstances=len(report['missingPHY']),missingSolidPropModels=len({p['model'] for p in report['missingPHY']}))
    report['elapsedSeconds']=time.perf_counter()-started;report['blenderSceneObjectsCreated']=0
    target=OUT/'collision.json';target.write_text(json.dumps(report,separators=(',',':'))+'\n')
    receipt={k:v for k,v in report.items() if k not in ('geometries','colliders','sensors','staticPhyModels','deferredEntities')}
    receipt['artifact']=dict(file=str(target),bytes=target.stat().st_size,sha256=hashlib.sha256(target.read_bytes()).hexdigest())
    (OUT/'manifest.json').write_text(json.dumps(receipt,indent=2)+'\n');save('complete');print(json.dumps(report['stats']))

if __name__=='__main__':main()
