"""Map existing unchanged props GLB corners to verified source VHV IDs.

Exact POSITION + UV + oriented triangle/material keys only. Ambiguous source
identities are accepted solely when all original instance lighting bytes agree.
No nearest-neighbour lookup, geometry edit, normal rounding, or color averaging.
"""
from pathlib import Path
from collections import defaultdict,Counter
import hashlib
import importlib.util
import json
import struct
import sys
import time

ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'.reference-assets/source-exports/dust2-vhv/remap'
def sha(data):return hashlib.sha256(data).hexdigest()
def glb(path):
    data=path.read_bytes();size=struct.unpack_from('<I',data,12)[0];doc=json.loads(data[20:20+size]);return doc,memoryview(data)[28+size:28+size+doc['buffers'][0]['byteLength']],data
def accessor(doc,binary,index):
    a=doc['accessors'][index];v=doc['bufferViews'][a['bufferView']];assert not v.get('byteStride') and not a.get('sparse')
    dims={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']];kind={5123:'H',5125:'I',5126:'f'}[a['componentType']];size=struct.calcsize('<'+kind)*dims
    start=v.get('byteOffset',0)+a.get('byteOffset',0);return list(struct.iter_unpack('<'+kind*dims,binary[start:start+size*a['count']]))
def accessor_bytes(doc,binary,index):
    a=doc['accessors'][index];v=doc['bufferViews'][a['bufferView']];assert not v.get('byteStride') and not a.get('sparse')
    dims={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']];size={5123:2,5125:4,5126:4}[a['componentType']]*dims*a['count']
    start=v.get('byteOffset',0)+a.get('byteOffset',0);return binary[start:start+size]
def canonical(corners):
    rotations=[corners[i:]+corners[:i] for i in range(3)];i=min(range(3),key=lambda k:rotations[k]);return tuple(rotations[i]),i
def main():
    started=time.perf_counter();OUT.mkdir(exist_ok=True)
    vhv=json.loads((OUT.parent/'inventory.json').read_text());verified=json.loads((OUT.parent/'geometry/verification.json').read_text())
    source,sbin,sraw=glb(OUT.parent/'geometry/props-source-index.glb');old,obin,oraw=glb(ROOT/'.reference-assets/source-exports/dust2/props.glb')
    assert sha(oraw)==verified['unchangedOriginalGLBSha256'] and sha(sraw)==verified['candidateSha256']
    lighting=(OUT.parent/'instance-lighting.bin').read_bytes();assert sha(lighting)==vhv['binary']['lighting']['sha256']
    parents={c:i for i,n in enumerate(old['nodes']) for c in n.get('children',[])};identities={}
    for i,node in enumerate(old['nodes']):
        if 'mesh' in node:
            anchor=old['nodes'][parents[i]];extra=anchor['extras'];identities[node['mesh']]={'model':extra['sourceModel'],'skin':extra['sourceSkin'],'part':int(node['name'].rsplit('_',1)[1])}
    instances=defaultdict(list)
    for inst in vhv['instances']:instances[inst['model']].append(inst)
    result={'status':'running','originalGLBSha256':sha(oraw),'sourceIndexGLBSha256':sha(sraw),'instanceLightingSha256':sha(lighting),
        'records':[],'failures':[],'exactCornerCount':0,'equivalentLightingAmbiguities':0,'vertexConflictsWithEqualLighting':0,'originalGLBModified':False,'nearestPointUsed':False}
    raw_maps=bytearray();signature_cache={}
    for mesh_id,mesh in enumerate(old['meshes']):
        identity=identities[mesh_id];name=identity['model'];source_faces=defaultdict(list);source_counts=Counter();old_counts=Counter()
        signature_cache.clear()
        def signature(hw):
            if hw not in signature_cache:
                values=[lighting[i['groups'][0]['lightingOffset']+12*hw:i['groups'][0]['lightingOffset']+12*hw+12] for i in instances[name]]
                assert all(len(v)==12 for v in values);signature_cache[hw]=b''.join(values)
            return signature_cache[hw]
        for p in source['meshes'][mesh_id]['primitives']:
            positions=accessor(source,sbin,p['attributes']['POSITION']);uv=accessor(source,sbin,p['attributes']['TEXCOORD_0']);hws=accessor(source,sbin,p['attributes']['_SOURCE_VHV'])
            keys=[positions[i]+uv[i] for i in range(len(positions))];idx=[i[0] for i in accessor(source,sbin,p['indices'])]
            for off in range(0,len(idx),3):
                face=idx[off:off+3];key,rotation=canonical([keys[i] for i in face]);ids=[int(hws[i][0]) for i in face];ids=ids[rotation:]+ids[:rotation]
                k=(p['material'],key);source_faces[k].append(tuple(ids));source_counts[k]+=1
        candidate_records=[];mesh_errors=[]
        for primitive_id,p in enumerate(mesh['primitives']):
            positions=accessor(old,obin,p['attributes']['POSITION']);uv=accessor(old,obin,p['attributes']['TEXCOORD_0']);keys=[positions[i]+uv[i] for i in range(len(positions))]
            idx=[i[0] for i in accessor(old,obin,p['indices'])];mapped=[0xffffffff]*len(positions)
            for off in range(0,len(idx),3):
                face=idx[off:off+3];key,rotation=canonical([keys[i] for i in face]);k=(p['material'],key);old_counts[k]+=1
                choices=source_faces.get(k)
                if not choices:mesh_errors.append({'kind':'exact_oriented_source_triangle_missing','primitive':primitive_id,'triangle':off//3});continue
                chosen=choices[0]
                if len(choices)>1:
                    if not all(all(a==b or signature(a)==signature(b) for a,b in zip(chosen,other)) for other in choices[1:]):
                        mesh_errors.append({'kind':'identical_triangle_has_different_original_lighting','primitive':primitive_id,'triangle':off//3});continue
                    result['equivalentLightingAmbiguities']+=1
                canonical_face=face[rotation:]+face[:rotation]
                for vertex,hw in zip(canonical_face,chosen):
                    previous=mapped[vertex]
                    if previous!=0xffffffff and previous!=hw:
                        if signature(previous)!=signature(hw):mesh_errors.append({'kind':'one_GLTF_vertex_needs_distinct_original_lighting','primitive':primitive_id,'vertex':vertex});continue
                        result['vertexConflictsWithEqualLighting']+=1
                    else:mapped[vertex]=hw
                result['exactCornerCount']+=3
            raw=struct.pack('<'+'I'*len(mapped),*mapped)
            candidate_records.append({'mesh':mesh_id,'primitive':primitive_id,**identity,'material':p['material'],'materialName':old['materials'][p['material']]['name'],
                'materialSource':old['materials'][p['material']]['extras']['full_path'],
                'vertexCount':len(mapped),'indexCount':len(idx),'sourceModelIndex':instances[name][0]['modelIndex'],'unreferencedVertexCount':mapped.count(0xffffffff),
                'mapOffset':len(raw_maps),'mapBytes':len(raw),'mapSha256':sha(raw),
                'attributeSha256':{key:sha(accessor_bytes(old,obin,value)) for key,value in p['attributes'].items()},
                'indexSha256':sha(accessor_bytes(old,obin,p['indices']))})
            raw_maps.extend(raw)
        if source_counts!=old_counts:mesh_errors.append({'kind':'oriented_triangle_multiset_differs','sourceTriangles':sum(source_counts.values()),'gltfTriangles':sum(old_counts.values())})
        if mesh_errors:
            result['failures'].append({'mesh':mesh_id,**identity,'errors':mesh_errors[:12],'totalErrors':len(mesh_errors)})
            for r in candidate_records:r['verified']=False
        else:
            for r in candidate_records:r['verified']=True
        result['records'].extend(candidate_records)
        if mesh_id%100==0:print('SOURCE_PROP_REMAP',mesh_id,'failures',len(result['failures']),flush=True)
    target=OUT/'original-prop-to-vhv.u32';target.write_bytes(raw_maps)
    result.update(status='exact_existing_GLTF_corner_mapping_passed' if not result['failures'] else 'partial_exact_mapping_with_explicit_failures',
        file=target.name,bytes=len(raw_maps),sha256=sha(raw_maps),meshes=len(old['meshes']),primitives=len(result['records']),
        verifiedPrimitives=sum(r['verified'] for r in result['records']),seconds=time.perf_counter()-started,
        sentinel='0xffffffff for vertices unreferenced by this primitive; never sampled by its index buffer')
    (OUT/'manifest.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k not in ('records','failures')},indent=2))
    if result['failures']:print(json.dumps(result['failures'][:5],indent=2))
    props=json.loads((ROOT/'.reference-assets/source-exports/dust2/props-manifest.json').read_text())
    runtime={'format':'source-prop-vhv-v1','sourceBspSha256':vhv['sourceBspSha256'],'originalGLBSha256':sha(oraw),
        'files':{'remap':{'url':target.name,'bytes':len(raw_maps),'sha256':sha(raw_maps)},
          'lighting':{'url':'../instance-lighting.bin','bytes':len(lighting),'sha256':sha(lighting)}},
        'records':result['records'],'instances':[{'index':i['index'],'model':i['model'],'skin':i['skin'],'modelIndex':i['modelIndex'],
          'lightingVertexOffset':i['groups'][0]['lightingOffset']//12,'lightingVertexCount':i['header']['vertexCount']} for i in vhv['instances']],
        'materials':props['materials'],'mappingFailures':result['failures']}
    (OUT/'runtime.json').write_text(json.dumps(runtime,indent=2)+'\n')
if __name__=='__main__':main()
