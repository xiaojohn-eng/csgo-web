"""Private exact OLIVE leaf bindings from raw prop metadata plus unchanged GLB matrices."""
from pathlib import Path
import hashlib,importlib.util,json,sys,re
import numpy as np
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'.reference-assets/source-exports/dust2-vhv/olive-foliage';OUT.mkdir(exist_ok=True)
spec=importlib.util.spec_from_file_location('tree_glb',ROOT/'scripts/audit-source-foliage.py');a=importlib.util.module_from_spec(spec);sys.modules[spec.name]=a;spec.loader.exec_module(a)
glb=a.Glb(ROOT/'.reference-assets/source-exports/dust2/props.glb');g=glb.json
oracle=json.loads((ROOT/'.reference-assets/source-exports/dust2-foliage-audit/olive-power/treesway/oracle.json').read_text())
cases={c['propId']:c for c in oracle['cases']}
C=np.array([[1,0,0,0],[0,0,1,0],[0,-1,0,0],[0,0,0,1]],float);scale=np.diag([.0254,.0254,.0254,1]);rows=[];errors=[];domains=[]
def walk(index,parent,prop_id=None):
    node=g['nodes'][index];matrix=parent@a.local_matrix(node)
    if re.fullmatch(r'static_prop_\d+',node.get('name','')):prop_id=int(node['name'][12:])
    for primitive_id,p in enumerate(g['meshes'][node['mesh']]['primitives'] if 'mesh' in node else []):
        m=g['materials'][p['material']];source=m.get('extras',{}).get('full_path',m.get('name',''))
        if source not in [a.PREFIX+'olive_branch_01']:continue
        case=cases[prop_id];assert source==case['material']
        source_matrix=np.array([*case['sourceModelRows'],[0,0,0,1]])
        expected=scale@C@source_matrix@C.T
        verts=glb.accessor(p['attributes']['POSITION']);hom=np.column_stack([verts,np.ones(len(verts))])
        minimum=float(np.linalg.norm(verts,axis=1).min());assert np.isfinite(verts).all() and minimum>0
        domains.append({'propId':prop_id,'vertices':len(verts),'minSourcePositionLength':minimum})
        # All actual leaf GLTF vertices, not just nearest positions / sampled IDs.
        delta=hom@(matrix-expected).T;error=float(np.linalg.norm(delta[:,:3],axis=1).max());errors.append(error)
        assert error<.0002,(prop_id,error)
        rows.append({'propId':prop_id,'mesh':node['mesh'],'primitive':primitive_id,'model':case['model'],'material':source,
            'sourceModelRows':case['sourceModelRows'],'meshToSceneMatrix':matrix.T.reshape(-1).tolist(),'maxSourceMatrixVertexErrorMetres':error})
    for child in node.get('children',[]):walk(child,matrix,prop_id)
for root in g['scenes'][g.get('scene',0)]['nodes']:walk(root,np.eye(4))
assert len(rows)==64
# Compact exact original bytes; same VHV IDs, no re-encoding or nearest matching.
vhv=ROOT/'.reference-assets/source-exports/dust2-vhv'
runtime=json.loads((vhv/'remap/runtime.json').read_text())
records={(r['mesh'],r['primitive']):r for r in runtime['records']}
instances={r['index']:r for r in runtime['instances']}
remap_raw=(vhv/'remap/original-prop-to-vhv.u32').read_bytes();light_raw=(vhv/'instance-lighting.bin').read_bytes()
assert hashlib.sha256(remap_raw).hexdigest()==runtime['files']['remap']['sha256']
assert hashlib.sha256(light_raw).hexdigest()==runtime['files']['lighting']['sha256']
map_bytes=bytearray();light_bytes=bytearray();mapped={};lighted={}
for row in rows:
    key=(row['mesh'],row['primitive']);record=records[key];instance=instances[row['propId']]
    if key not in mapped:
        mapped[key]=len(map_bytes)//4;map_bytes.extend(remap_raw[record['mapOffset']:record['mapOffset']+record['mapBytes']])
    if row['propId'] not in lighted:
        lighted[row['propId']]=len(light_bytes)//12;offset=instance['lightingVertexOffset']*12
        light_bytes.extend(light_raw[offset:offset+instance['lightingVertexCount']*12])
    row.update(mappingOffset=mapped[key],lightingVertexOffset=lighted[row['propId']],lightingVertexCount=instance['lightingVertexCount'],
        vertexCount=record['vertexCount'],indexCount=record['indexCount'],attributeSha256=record['attributeSha256'],indexSha256=record['indexSha256'],materialName=record['materialName'])
files={}
for name,data in [('remap.u32',map_bytes),('lighting.bin',light_bytes)]:
    (OUT/name).write_bytes(data);files[name]={'url':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
payload={'format':'source-prop-olive-v1','sourceBspSha256':'b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc','originalGLBSha256':a.digest(ROOT/'.reference-assets/source-exports/dust2/props.glb'),'programSha256':oracle['program']['programSha256'],'records':rows,'files':files,'materials':[m for m in runtime['materials'] if m['source'] in [a.PREFIX+'olive_branch_01']],'originalVerticesRetained':True,'maxSourceMatrixVertexErrorMetres':max(errors),'boundary':'Original Source model rows and GLB rest coordinate correspondence. Explicit time/wind inputs; no env_wind state simulation.'}
raw=(json.dumps(payload,indent=2)+'\n').encode();(OUT/'bindings.json').write_bytes(raw)
receipt={'format':'source-prop-olive-receipt-v1','file':{'url':'bindings.json','bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}}
(OUT/'manifest.json').write_text(json.dumps(receipt,indent=2)+'\n');(OUT/'vertex-domain.json').write_text(json.dumps({'records':domains,'minSourcePositionLength':min(r['minSourcePositionLength'] for r in domains),'allOriginalLeafPositionsFiniteAndNonzero':True},indent=2)+'\n');print(json.dumps({'records':len(rows),'maxMatrixVertexErrorMetres':max(errors),**receipt},indent=2))
