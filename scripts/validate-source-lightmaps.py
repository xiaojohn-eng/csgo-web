"""Independent GLB readback of lightmapped geometry, face IDs, atlas UVs and bytes."""
from pathlib import Path
from collections import Counter
import hashlib,json,struct
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.reference-assets/source-exports/dust2-lightmapped'
def digest(data):return hashlib.sha256(data).hexdigest()
def load(path):
    raw=path.read_bytes();length,kind=struct.unpack_from('<II',raw,12)
    assert kind==0x4e4f534a
    doc=json.loads(raw[20:20+length]);offset=20+length
    size,kind=struct.unpack_from('<II',raw,offset);assert kind==0x004e4942
    return doc,raw[offset+8:offset+8+size],digest(raw)
def accessor(doc,data,index):
    a=doc['accessors'][index];v=doc['bufferViews'][a['bufferView']]
    dtype={5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1'}[a['componentType']]
    dimensions={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
    item=np.dtype(dtype).itemsize
    return np.ndarray((a['count'],dimensions),dtype=dtype,buffer=data,
        offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',dimensions*item),item)).copy()
def triangles(doc,data):
    result={}
    for mesh in doc['meshes']:
        for p in mesh['primitives']:
            name=doc['materials'][p['material']]['name']
            ids=accessor(doc,data,p['indices']).flatten()
            attributes={k:accessor(doc,data,v)[ids] for k,v in p['attributes'].items()}
            assert name not in result,'Unexpected duplicate material primitive'
            result[name]=attributes
    return result

a,ab,ah=load(ROOT/'.reference-assets/source-exports/dust2-corrected/world.glb')
b,bb,bh=load(OUT/'world.glb')
original,new=triangles(a,ab),triangles(b,bb)
assert set(original)==set(new)
atlas=json.loads((OUT/'lightmaps.json').read_text());count=0;face_ids=set()
lumps=ROOT/'output/source1/de_dust2/lumps'
def raw_rows(name,fmt):return list(struct.iter_unpack(fmt,(lumps/name).read_bytes()))
raw_faces=raw_rows('58-faces_hdr.bin','<HBBihhhh4Bif4iiHHI')
raw_vertices=np.array(raw_rows('03-vertices.bin','<3f'),dtype=np.float64)
raw_edges=raw_rows('12-edges.bin','<2H');raw_surfedges=[r[0]for r in raw_rows('13-surfedges.bin','<i')]
raw_disp=(lumps/'26-dispinfo.bin').read_bytes()
raw_dispverts=np.array(raw_rows('33-disp_vertices.bin','<5f'),dtype=np.float64)
displacement_count=0;displacement_error=0.
def verify_displacement(face_id,pixels,positions):
    global displacement_count,displacement_error
    raw=raw_faces[face_id];di=raw[6]
    if di<0:return
    start=np.array(struct.unpack_from('<3f',raw_disp,di*176))
    first,_,power=struct.unpack_from('<3i',raw_disp,di*176+12);side=(1<<power)+1
    corner_ids=[]
    for se in raw_surfedges[raw[3]:raw[3]+4]:corner_ids.append(raw_edges[abs(se)][0 if se>=0 else 1])
    corners=raw_vertices[corner_ids];at=np.argmin(np.linalg.norm(corners-start,axis=1))
    assert np.linalg.norm(corners[at]-start)<.1  # Original rounded corners differ by at most .02002 Source unit.
    corners=np.roll(corners,-at,axis=0)
    face=atlas['faces'][face_id];fraction=(pixels-face['atlas'])/np.array([face['width']-1,face['height']-1])
    grid=np.round(fraction*(side-1)).astype(int)
    assert np.max(abs(fraction*(side-1)-grid))<.002,'Displacement UV does not map to its original grid vertex'
    u=(grid[:,0]/(side-1))[:,None];v=(grid[:,1]/(side-1))[:,None]
    base=(1-u)*((1-v)*corners[0]+v*corners[1])+u*((1-v)*corners[3]+v*corners[2])
    dv=raw_dispverts[first+grid[:,1]*side+grid[:,0]]
    source=base+dv[:,:3]*dv[:,3,None]
    expected=source[:,[0,2,1]]*np.array([1,1,-1])
    error=float(np.max(np.abs(expected-positions)))
    if error>.01:raise ValueError(f'Displacement {face_id} original vertex/grid lightmap mismatch {error} source units')
    displacement_error=max(displacement_error,error);displacement_count+=1
def ordered_triangles(attributes):
    # A multiset ignores primitive triangle ordering but preserves winding and
    # each triangle's exact original corner positions, normals and base UVs.
    values=np.concatenate([attributes[k] for k in ('POSITION','NORMAL','TEXCOORD_0')],axis=1).reshape((-1,3,8))
    return Counter(row.astype('<f4').tobytes() for row in values)
for name,attributes in new.items():
    assert ordered_triangles(original[name])==ordered_triangles(attributes),name+' changed original render geometry'
    ids=attributes['TEXCOORD_2'][:,0]
    assert np.array_equal(ids,ids.astype(np.int32)),name+' lost original face IDs'
    ids=ids.astype(np.int32);tri=ids.reshape((-1,3))
    assert np.all(tri==tri[:,0,None]),name+' triangle crosses source faces'
    uv=attributes['TEXCOORD_1'].astype(np.float64)
    pixels=uv*np.array([atlas['width'],atlas['height']])-.5
    for face_id in np.unique(ids):
        face=atlas['faces'][int(face_id)];x,y=face['atlas'];selected=pixels[ids==face_id]
        if face['offset']>=0:
            low=np.array([x,y])-1e-3;high=np.array([x+face['width']-1,y+face['height']-1])+1e-3
            if not (np.all(selected>=low) and np.all(selected<=high)):
                raise ValueError(f'Face {face_id} UV outside its original lightmap luxel extent: {selected.min(0)}..{selected.max(0)} vs {low}..{high}')
        face_ids.add(int(face_id))
        verify_displacement(int(face_id),selected,attributes['POSITION'][ids==face_id])
    count+=len(ids)//3
for item in atlas['atlasFiles']:
    assert digest((OUT/item['file']).read_bytes())==item['sha256']
report={'status':'passed','originalSha256':ah,'lightmappedSha256':bh,'triangles':count,
    'materials':len(new),'sourceFaces':len(face_ids),'originalPositionsNormalsBaseUVAndWindingUnchanged':True,
    'faceIDsAndLuxelExtentsVerified':True,'atlasFileHashesVerified':True,
    'displacementFacesVerifiedAgainstRawGridAndVertices':displacement_count,'maxDisplacementPositionErrorSourceUnits':displacement_error,
    'boundary':'Geometry/atlas mapping only. GPU shader, original exposure and directional bump lighting require separate review.'}
(OUT/'lightmap-geometry-readback.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
