"""Read back isolated Dust2 GLBs, including every actual static-prop instance.

This does not render, change a server, or validate Source gameplay/collision.
Run with ordinary Python after convert-source-map.py has completed both layers.
"""
import argparse
import collections
import hashlib
import json
import math
from pathlib import Path
import re
import struct

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output',type=Path,default=ROOT/'.reference-assets/source-exports/dust2')
parser.add_argument('--layer',choices=['world','props','all'],default='all')
args=parser.parse_args();OUT=args.output.resolve()
if not OUT.is_relative_to(ROOT/'.reference-assets/source-exports'):raise ValueError('Isolated export directory required')

def require(value,message):
    if not value:raise AssertionError(message)

def qmul(a,b):
    x,y,z,w=a;X,Y,Z,W=b
    return [w*X+x*W+y*Z-z*Y,w*Y-x*Z+y*W+z*X,w*Z+x*Y-y*X+z*W,w*W-x*X-y*Y-z*Z]

def source_quaternion(angles):
    pitch,yaw,roll=[math.radians(x)/2 for x in angles]
    x=[math.sin(roll),0,0,math.cos(roll)]
    y=[0,math.sin(pitch),0,math.cos(pitch)]
    z=[0,0,math.sin(yaw),math.cos(yaw)]
    q=qmul(qmul(z,y),x)
    s=math.sqrt(.5)
    return qmul(qmul([-s,0,0,s],q),[s,0,0,s])

report={'scope':'GLB structural and source-transform readback, not browser/collision acceptance','layers':{}}
for layer in (['world','props'] if args.layer=='all' else [args.layer]):
    manifest=json.loads((OUT/f'{layer}-manifest.json').read_text())
    require(manifest['stage']=='complete',layer+' conversion not complete')
    data=(OUT/f'{layer}.glb').read_bytes()
    magic,version,size=struct.unpack_from('<4sII',data)
    require((magic,version,size)==(b'glTF',2,len(data)),'Invalid GLB header')
    length,kind=struct.unpack_from('<II',data,12)
    require(kind==0x4e4f534a,'First chunk must be JSON')
    doc=json.loads(data[20:20+length]);binary_offset=20+length
    binary_length,binary_kind=struct.unpack_from('<II',data,binary_offset)
    require(binary_kind==0x004e4942 and binary_offset+8+binary_length==len(data),'Invalid BIN chunk')
    binary=memoryview(data)[binary_offset+8:]
    for view in doc.get('bufferViews',[]):
        require(view.get('buffer',0)==0 and view.get('byteOffset',0)+view['byteLength']<=len(binary),'Buffer view out of range')
    def accessor(index):
        a=doc['accessors'][index];view=doc['bufferViews'][a['bufferView']]
        code,component_size={5120:('b',1),5121:('B',1),5122:('h',2),5123:('H',2),5125:('I',4),5126:('f',4)}[a['componentType']]
        width={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]
        step=view.get('byteStride',component_size*width)
        offset=view.get('byteOffset',0)+a.get('byteOffset',0)
        end=offset+max(0,a['count']-1)*step+component_size*width
        require(end<=view.get('byteOffset',0)+view['byteLength'],'Accessor out of range')
        unpack=struct.Struct('<'+code*width).unpack_from
        return (unpack(binary,offset+i*step) for i in range(a['count']))
    mesh_triangles=[]
    for mesh in doc.get('meshes',[]):
        triangles=0
        for primitive in mesh['primitives']:
            require(primitive.get('mode',4)==4,'Nontriangle primitive')
            positions=list(accessor(primitive['attributes']['POSITION']))
            require(positions and all(math.isfinite(v) for p in positions for v in p),'Nonfinite/empty positions')
            normals=accessor(primitive['attributes']['NORMAL'])
            require(all(all(math.isfinite(v) for v in n) and abs(sum(v*v for v in n)-1)<.001 for n in normals),
                    'Nonunit/nonfinite GLB normal')
            indices=accessor(primitive['indices'])
            require(all(0<=i[0]<len(positions) for i in indices),'Vertex index out of range')
            count=doc['accessors'][primitive['indices']]['count'];require(count%3==0,'Incomplete triangle')
            triangles+=count//3
            require(0<=primitive['material']<len(doc['materials']),'Missing material')
        mesh_triangles.append(triangles)
    parents={}
    for index,node in enumerate(doc['nodes']):
        for child in node.get('children',[]):
            require(child not in parents,'Node has multiple parents');parents[child]=index
    roots=[i for i,n in enumerate(doc['nodes']) if n.get('name')=='SourceUnits_to_Metres']
    require(len(roots)==1,'Single scale root required');root=roots[0]
    scale=manifest['outerMetersPerUnit']
    require(max(abs(s-scale) for s in doc['nodes'][root]['scale'])<1e-8,'Root scale mismatch')
    instantiated_triangles=sum(mesh_triangles[n['mesh']] for n in doc['nodes'] if 'mesh' in n)
    require(instantiated_triangles==manifest['geometry']['triangles'],'Triangle count changed during GLB export')
    images=doc.get('images',[])
    for image in images:
        require('bufferView' in image and 'uri' not in image,'GLB image must be embedded')
        view=doc['bufferViews'][image['bufferView']];start=view.get('byteOffset',0)
        raw=binary[start:start+view['byteLength']]
        require(bytes(raw[:8])==b'\x89PNG\r\n\x1a\n' or bytes(raw[:2])==b'\xff\xd8','Invalid embedded image')
    material_records={m['name']:m for m in manifest['materials']}
    diagnostic=[]
    for material in doc.get('materials',[]):
        name=material['name'];record=material_records[name]
        if record.get('error'):diagnostic.append(name)
        else:require('baseColorTexture' in material.get('pbrMetallicRoughness',{}),'Missing original base texture: '+name)
        if record.get('alphaTest'):
            require(material.get('alphaMode')=='MASK','Original alphatest must be MASK: '+name)
            require(abs(material.get('alphaCutoff',.5)-record['alphaCutoff'])<1e-6,'Alpha cutoff mismatch')
    result=dict(sha256=hashlib.sha256(data).hexdigest(),bytes=len(data),meshDefinitions=len(mesh_triangles),
        meshNodes=sum('mesh' in n for n in doc['nodes']),instantiatedTriangles=instantiated_triangles,
        materials=len(doc.get('materials',[])),embeddedImages=len(images),diagnosticMaterials=diagnostic,
        maxTranslationErrorMetres=0,maxQuaternionComponentError=0,staticAnchorsWithActualMesh=0)
    for repair in manifest.get('sourceTopologyRestored',[]):
        for primitive in doc['meshes'][repair['meshId']]['primitives']:
            for attribute,expected_hash in repair.get('attributeSHA256',{}).items():
                a=doc['accessors'][primitive['attributes'][attribute]];view=doc['bufferViews'][a['bufferView']]
                require('byteStride' not in view,'Unexpected repaired attribute stride')
                start=view.get('byteOffset',0)+a.get('byteOffset',0)
                width={'VEC2':2,'VEC3':3}[a['type']]
                actual=hashlib.sha256(binary[start:start+4*width*a['count']]).hexdigest()
                require(actual==expected_hash,'Original VVD/VTX attribute checksum changed')
    result['sourceTopologyMeshesRestored']=len(manifest.get('sourceTopologyRestored',[]))
    require(result['sha256']==manifest['glb']['sha256'],'GLB hash changed after manifest')
    if layer=='props':
        sources=json.loads((ROOT/'output/source1/de_dust2/static-props.json').read_text())['props']
        exported_records=json.loads((OUT/'prop-instances.json').read_text())
        anchors={int(n['name'].removeprefix('static_prop_')):(i,n) for i,n in enumerate(doc['nodes'])
                 if re.fullmatch(r'static_prop_\d+',n.get('name',''))}
        require(len(anchors)==len(sources)==manifest['actualMeshInstances'],'Not all source props exported')
        for index,source in enumerate(sources):
            i,node=anchors[index];require(parents.get(i)==root,'Prop outside scale root')
            require(node.get('extras',{}).get('sourceModel')==source['model'],'Model mismatch')
            require(node.get('extras',{}).get('sourceSkin')==source['skin'],'Skin metadata mismatch')
            require(any('mesh' in doc['nodes'][c] and mesh_triangles[doc['nodes'][c]['mesh']]>0 for c in node.get('children',[])),
                    'Empty placeholder for source prop '+str(index))
            expected_parts=exported_records[index]['meshMaterials']
            children=[doc['nodes'][c] for c in node.get('children',[]) if 'mesh' in doc['nodes'][c]]
            require(len(children)==len(expected_parts),'Model mesh-part count changed')
            for child in children:
                part=int(child['name'].rsplit('_',1)[1]);expected_names={m['name'] for m in expected_parts[part]}
                actual_names={doc['materials'][p['material']]['name'] for p in doc['meshes'][child['mesh']]['primitives']}
                require(actual_names<=expected_names,'Skin material changed during export')
            expected=[source['origin'][0],source['origin'][2],-source['origin'][1]]
            error=max(abs(a-b)*scale for a,b in zip(expected,node.get('translation',[0,0,0])))
            result['maxTranslationErrorMetres']=max(error,result['maxTranslationErrorMetres'])
            require(error<.0001,'Source prop translation drift')
            q=source_quaternion(source['rotation']);actual=node.get('rotation',[0,0,0,1])
            error=min(max(abs(a-b) for a,b in zip(q,actual)),max(abs(a+b) for a,b in zip(q,actual)))
            result['maxQuaternionComponentError']=max(error,result['maxQuaternionComponentError'])
            require(error<2e-6,'Source prop orientation drift')
            expected_scale=source.get('uniform_scale') or 1
            require(max(abs(s-expected_scale) for s in node.get('scale',[1,1,1]))<1e-7,'Prop instance scale mismatch')
        result['staticAnchorsWithActualMesh']=len(anchors)
        result['skins']=dict(collections.Counter(p['skin'] for p in sources))
    report['layers'][layer]=result
inventory_root=ROOT/'output/source1/de_dust2'
inventory=json.loads((inventory_root/'inventory.json').read_text())
require(inventory['extractionComplete'],'Source metadata inventory incomplete')
metadata_dir=OUT/'source-metadata';metadata_dir.mkdir(exist_ok=True)
references={}
for relative in ['inventory.json','entities.raw.txt','entities.json','static-props.json','collision-brushes.json',
                 'collision-vphysics.json','solid-props-missing-phy.json','sidecars/de_dust2.nav','sidecars/de_dust2.txt',
                 'lumps/28-physics_displacement.bin','lumps/29-physics_collide.bin','lumps/53-lighting_hdr.bin']:
    raw=(inventory_root/relative).read_bytes();destination=metadata_dir/Path(relative).name
    destination.write_bytes(raw)
    references[relative]={'file':str(destination.relative_to(OUT)),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
entities=json.loads((inventory_root/'entities.json').read_text())
scale=json.loads((OUT/'world-manifest.json').read_text())['outerMetersPerUnit']
spawns=[]
for entity in entities:
    if entity['classname'] not in ('info_player_terrorist','info_player_counterterrorist'):continue
    x,y,z=map(float,entity['origin'].split());pitch,yaw,roll=map(float,entity.get('angles','0 0 0').split())
    p=math.radians(pitch);a=math.radians(yaw)
    spawns.append({'classname':entity['classname'],'hammerid':entity.get('hammerid'),'sourceOrigin':[x,y,z],
        'sourceAngles':[pitch,yaw,roll],'browserMetresPosition':[scale*x,scale*z,-scale*y],
        'browserForward':[math.cos(p)*math.cos(a),-math.sin(p),-math.cos(p)*math.sin(a)]})
metadata={'sourceBspSha256':inventory['bspSha256'],'sourceioCommit':inventory['sourceioCommit'],
    'outerMetersPerUnit':scale,'browserTransform':'Source(x,y,z) -> scale*(x,z,-y)',
    'spawns':spawns,'environmentEntities':[e for e in entities if e['classname'] in
        ('sky_camera','light_environment','env_sun','env_fog_controller','env_tonemap_controller','shadow_control')],
    'references':references,'collisionImplemented':False,'entityGameplayImplemented':False,
    'limits':['45 solid=6 instances / 13 models lack PHY; no silent render-mesh replacement.',
              'SourceIO original PhysicsLump failed; bounded block wrapper preserved 43 blocks / 46 VPHY solids.',
              'Source 3D skybox objects remain at original distant source coordinates; no automatic recentering.']}
(OUT/'map-metadata.json').write_text(json.dumps(metadata,indent=2)+'\n')
report['complete']=True
(OUT/'verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
