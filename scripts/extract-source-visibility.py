"""Read frozen original Dust2 BSP visibility; never rewrite map geometry.

PVS and sprp leaf links are original. Displacement membership is a conservative
AABB/plane traversal from all original displaced vertices, explicitly recorded.
"""
from pathlib import Path
import base64, collections, hashlib, json, math, struct, time

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.reference-assets/source-exports/dust2/visibility'
OUT.mkdir(parents=True,exist_ok=True)
META=json.loads((ROOT/'.reference-assets/source-exports/dust2/map-metadata.json').read_text())
BSP=ROOT/'.reference-assets/csgo-legacy/csgo/maps/de_dust2.bsp'
started=time.monotonic();source=BSP.read_bytes()
sha=lambda b:hashlib.sha256(b).hexdigest()
assert sha(source)==META['sourceBspSha256']
assert source[:4]==b'VBSP'
header=[struct.unpack_from('<4i',source,8+i*16)for i in range(64)]
receipts={}
def lump(i):
    start,length,version,compressed=header[i]
    assert min(start,length)>=0 and start+length<=len(source) and compressed==0
    data=source[start:start+length]
    receipts[i]={'offset':start,'bytes':length,'version':version,'sha256':sha(data)}
    return data
def rows(i,fmt):
    b=lump(i);assert len(b)%struct.calcsize(fmt)==0
    return list(struct.iter_unpack(fmt,b))
def save(name,value):
    (OUT/name).write_text(json.dumps(value,separators=(',',':'),ensure_ascii=False)+'\n')

planes=rows(1,'<4fi');nodes=rows(5,'<3i6h2H2h');model=rows(14,'<9f3i')[0]
assert header[10][2]==1
leaf_bytes=lump(10);assert len(leaf_bytes)%32==0
leaves=[struct.unpack_from('<ihH6h4Hh',leaf_bytes,i)for i in range(0,len(leaf_bytes),32)]
leaf_faces=[r[0]for r in rows(16,'<H')];faces=rows(7,'<HBBihhhh4Bif4iiHHI')
world_start,world_count=model[10:12];world_ids=list(range(world_start,world_start+world_count))
assert world_start>=0 and world_start+world_count<=len(faces)
def point_leaf(point):
    node=model[9];steps=0
    while node>=0:
        assert node<len(nodes) and steps<=len(nodes);steps+=1
        n=nodes[node];p=planes[n[0]];d=sum(p[i]*point[i]for i in range(3))-p[3]
        node=n[1 if d>=0 else 2]
    leaf=-1-node;assert 0<=leaf<len(leaves);return leaf

# Direct original VIS PVS/PAS offsets; zero-byte run length decoding.
vis=lump(4);cluster_count=struct.unpack_from('<i',vis,0)[0];assert 0<cluster_count<=65536
row_bytes=(cluster_count+7)//8;offsets=[struct.unpack_from('<2i',vis,4+i*8)for i in range(cluster_count)]
assert 4+cluster_count*8<=len(vis)
def decompress(offset):
    if offset==-1:return None
    assert 4+cluster_count*8<=offset<len(vis)
    result=bytearray()
    while len(result)<row_bytes:
        assert offset<len(vis);value=vis[offset];offset+=1
        if value:result.append(value)
        else:
            assert offset<len(vis);count=vis[offset];offset+=1
            assert count>0 and len(result)+count<=row_bytes
            result.extend(bytes(count))
    return bytes(result)
pvs=[decompress(pair[0])for pair in offsets]
# Parse PAS too to validate the shared offset table, but do not use it as PVS.
pas=[decompress(pair[1])for pair in offsets]
(OUT/'original-visibility-lump.bin').write_bytes(vis)

# Preserve original sprp leaf table, rather than trying to classify by prop origin.
game=lump(35);game_count=struct.unpack_from('<i',game,0)[0];sprp=None
for i in range(game_count):
    key,flags,version,offset,length=struct.unpack_from('<4sHHii',game,4+16*i)
    if key[::-1]==b'sprp':
        assert not flags and version==11 and 0<=offset<offset+length<=len(source)
        sprp=source[offset:offset+length];sprp_record={'offset':offset,'bytes':length,'version':version,'sha256':sha(sprp)}
assert sprp is not None
at=0
def integer():
    global at
    n=struct.unpack_from('<i',sprp,at)[0];at+=4;assert n>=0;return n
model_names=[]
for _ in range(integer()):model_names.append(sprp[at:at+128].split(b'\0')[0].decode());at+=128
count=integer();sprp_leaves=list(struct.unpack_from('<'+str(count)+'H',sprp,at));at+=count*2
prop_count=integer();assert (len(sprp)-at)%prop_count==0
prop_size=(len(sprp)-at)//prop_count;assert prop_size==80
previous=json.loads((ROOT/'.reference-assets/source-exports/dust2/source-metadata/static-props.json').read_text())['props']
assert len(previous)==prop_count
prop_links=[]
for i in range(prop_count):
    data=sprp[at+i*prop_size:at+(i+1)*prop_size]
    model_id,first,count=struct.unpack_from('<3H',data,24)
    assert model_id<len(model_names) and first+count<=len(sprp_leaves)
    assert (model_id,first,count)==(previous[i]['prop_type'],previous[i]['first_leaf'],previous[i]['leaf_count'])
    ids=sprp_leaves[first:first+count];assert all(0<=leaf<len(leaves)for leaf in ids)
    prop_links.append({'id':i,'leafIds':ids})

# Raw node/leaf face association. Gather node ancestors of visible leaves by
# precomputing each node's descendant cluster set (no camera/distance heuristic).
face_clusters=[set()for _ in world_ids]
node_clusters={};visiting=set();world_leaves=set()
def descendant_clusters(node):
    if node<0:
        leaf=-1-node;assert leaf<len(leaves);world_leaves.add(leaf)
        cluster=leaves[leaf][1];return {cluster}if cluster>=0 else set()
    if node in node_clusters:return node_clusters[node]
    assert node<len(nodes) and node not in visiting;visiting.add(node)
    n=nodes[node];assert 0<=n[0]<len(planes)
    result=descendant_clusters(n[1])|descendant_clusters(n[2]);node_clusters[node]=result;visiting.remove(node)
    assert n[9]+n[10]<=len(faces)
    for face in range(n[9],n[9]+n[10]):
        if world_start<=face<world_start+world_count:face_clusters[face-world_start].update(result)
    return result
descendant_clusters(model[9])
for leaf in world_leaves:
    l=leaves[leaf];assert l[9]+l[10]<=len(leaf_faces)
    if l[1]<0:continue
    assert l[1]<cluster_count
    for face in leaf_faces[l[9]:l[9]+l[10]]:
        assert face<len(faces)
        if world_start<=face<world_start+world_count:face_clusters[face-world_start].add(l[1])

vertices=rows(3,'<3f');edges=rows(12,'<2H');surfedges=[r[0]for r in rows(13,'<i')]
disp_info=lump(26);assert len(disp_info)%176==0;disp_verts=rows(33,'<5f')
def intersecting_leaves(mins,maxs):
    center=[(a+b)*.5 for a,b in zip(mins,maxs)];extent=[(b-a)*.5 for a,b in zip(mins,maxs)]
    stack=[model[9]];result=[]
    while stack:
        node=stack.pop()
        if node<0:result.append(-1-node);continue
        n=nodes[node];p=planes[n[0]];distance=sum(p[i]*center[i]for i in range(3))-p[3];radius=sum(abs(p[i])*extent[i]for i in range(3))
        if distance+radius>=0:stack.append(n[1])
        if distance-radius<=0:stack.append(n[2])
    return result
disp_receipts=[]
for face_id in world_ids:
    face=faces[face_id];disp_id=face[6]
    if disp_id<0:continue
    assert face[4]==4 and (disp_id+1)*176<=len(disp_info)
    start=struct.unpack_from('<3f',disp_info,disp_id*176);vertex_start,tri_start,power=struct.unpack_from('<3i',disp_info,disp_id*176+12)
    assert 2<=power<=4
    corners=[]
    for surfedge in surfedges[face[3]:face[3]+4]:
        edge=edges[abs(surfedge)];corners.append(vertices[edge[0 if surfedge>=0 else 1]])
    closest=min(range(4),key=lambda i:sum((corners[i][j]-start[j])**2 for j in range(3)))
    assert sum((corners[closest][j]-start[j])**2 for j in range(3))<.01
    corners=corners[closest:]+corners[:closest];side=(1<<power)+1
    assert 0<=vertex_start and vertex_start+side*side<=len(disp_verts)
    mins=[math.inf]*3;maxs=[-math.inf]*3
    for y in range(side):
        v=y/(side-1)
        for x in range(side):
            u=x/(side-1);dv=disp_verts[vertex_start+y*side+x]
            for axis in range(3):
                base=(1-u)*((1-v)*corners[0][axis]+v*corners[1][axis])+u*((1-v)*corners[3][axis]+v*corners[2][axis])
                value=base+dv[axis]*dv[3];mins[axis]=min(mins[axis],value);maxs[axis]=max(maxs[axis],value)
    # 0.01 Source unit is a conservative float32 boundary tolerance, not a
    # visibility distance. Every displaced vertex lies inside this expanded box.
    ids=intersecting_leaves([v-.01 for v in mins],[v+.01 for v in maxs])
    clusters={leaves[leaf][1]for leaf in ids if leaves[leaf][1]>=0}
    face_clusters[face_id-world_start].update(clusters)
    disp_receipts.append({'face':face_id,'displacement':disp_id,'sourceBounds':[mins,maxs],'leafIds':ids,'clusters':sorted(clusters)})

# Source renders the 3D sky separately. Until that pass is reproduced, retain
# every object/face touching a sky_camera area; this can overdraw, never hide sky.
sky_cameras=[];sky_areas=set()
for entity in META['environmentEntities']:
    if entity['classname']!='sky_camera':continue
    point=[float(v)for v in entity['origin'].split()];leaf=point_leaf(point);area=leaves[leaf][2]&511
    sky_cameras.append({'sourcePosition':point,'leaf':leaf,'cluster':leaves[leaf][1],'area':area});sky_areas.add(area)
sky_clusters={l[1]for l in leaves if l[1]>=0 and (l[2]&511)in sky_areas}
always_faces=[world_start+i for i,clusters in enumerate(face_clusters)if not clusters or clusters&sky_clusters]
always_props=[p['id']for p in prop_links if not p['leafIds']or any(leaves[i][1]<0 or (leaves[i][2]&511)in sky_areas for i in p['leafIds'])]
data={'format':'source-visibility-v1','sourceBspSha256':sha(source),'metersPerSourceUnit':.0254,
      'sourceBounds':[model[:3],model[3:6]],'worldHeadNode':model[9],'worldFirstFace':world_start,'worldFaceCount':world_count,'faceCount':len(faces),
      'planes':[p[:4]for p in planes],'nodes':[{'plane':n[0],'children':n[1:3],'firstFace':n[9],'faceCount':n[10]}for n in nodes],
      'leaves':[{'cluster':l[1],'area':l[2]&511,'firstLeafFace':l[9],'leafFaceCount':l[10]}for l in leaves],
      'leafFaces':leaf_faces,'clusterCount':cluster_count,'pvsRows':[base64.b64encode(row).decode()if row is not None else None for row in pvs],
      'faceClusters':[sorted(v)for v in face_clusters],'staticProps':prop_links,'alwaysVisibleFaceIds':always_faces,'alwaysVisiblePropIds':always_props}
save('visibility.json',data)
save('displacement-membership.json',disp_receipts)
def sample(point):
    leaf=point_leaf(point);cluster=leaves[leaf][1]
    if cluster<0 or pvs[cluster]is None:return {'leaf':leaf,'cluster':cluster,'allVisible':True,'faces':world_ids,'props':list(range(prop_count))}
    row=pvs[cluster];visible=lambda c:c>=0 and bool(row[c//8]&(1<<(c%8)))
    vf=[world_start+i for i,c in enumerate(face_clusters)if world_start+i in always_faces or any(visible(x)for x in c)]
    vp=[p['id']for p in prop_links if p['id']in always_props or any(visible(leaves[i][1])for i in p['leafIds'])]
    return {'leaf':leaf,'cluster':cluster,'allVisible':False,'faces':vf,'props':vp}
fixtures=[]
for spawn in META['spawns']:
    origin=spawn['sourceOrigin'];eye=[origin[0],origin[1],origin[2]+64]
    fixtures.append({'hammerid':spawn['hammerid'],'team':spawn['classname'],'sourceOrigin':origin,'browserOrigin':[origin[0]*.0254,origin[2]*.0254,-origin[1]*.0254],
                     'sourceEye64':eye,'browserEye64':[eye[0]*.0254,eye[2]*.0254,-eye[1]*.0254],'originExpected':sample(origin),'eyeExpected':sample(eye)})
save('spawn-fixtures.json',fixtures)
save('manifest.json',{'status':'extracted','sourceBsp':str(BSP.relative_to(ROOT)),'sourceBspSha256':sha(source),'scriptSha256':sha(Path(__file__).read_bytes()),
     'lumps':receipts,'sprp':sprp_record,'sprpRecordBytes':prop_size,'sprpLeafTableCount':len(sprp_leaves),'visibilityOffsetsPvsPas':offsets,
     'counts':{'planes':len(planes),'nodes':len(nodes),'leaves':len(leaves),'clusters':cluster_count,'worldFaces':world_count,'displacements':len(disp_receipts),'props':prop_count,'spawns':len(fixtures)},
     'pvsRowsSha256':sha(b''.join(r if r is not None else bytes(row_bytes)for r in pvs)),
     'missingPvsRows':sum(r is None for r in pvs),'missingPasRows':sum(r is None for r in pas),
     'skyCameras':sky_cameras,'skyAreas':sorted(sky_areas),'alwaysVisibleFaces':len(always_faces),'alwaysVisibleProps':len(always_props),
     'limits':['PVS only; dynamic areaportals, occluders, frustum and 3D sky pass are separate.',
               'Displacement cluster membership is conservative source-vertex AABB intersection, not a stored leafface association.',
               'Sky-camera areas and unknown memberships remain visible; no distance-based culling.'],
     'elapsedSeconds':time.monotonic()-started})
print(json.dumps({'status':'extracted','clusters':cluster_count,'props':prop_count,'displacements':len(disp_receipts),'spawns':len(fixtures),'alwaysFaces':len(always_faces),'alwaysProps':len(always_props),'seconds':time.monotonic()-started}))
