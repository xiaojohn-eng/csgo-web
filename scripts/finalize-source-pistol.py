"""Remove only invalid unused tangent semantics; preserve every BIN byte.
Source pistol VMT has no normalmap. Arm normalmap tangents remain untouched.
Run after import-source-pistol-viewmodel.py, before independent readback.
"""
from pathlib import Path
import json,struct,hashlib,sys
ROOT=Path(__file__).resolve().parents[1]
for directory in sys.argv[1:]:
 out=Path(directory);audit=json.loads((out/'audit.json').read_text());path=Path(audit['glb']['path']);old=path.read_bytes();size=struct.unpack_from('<I',old,12)[0];doc=json.loads(old[20:20+size]);binary=old[28+size:];removed=[]
 for mi,mesh in enumerate(doc['meshes']):
  for pi,p in enumerate(mesh['primitives']):
   if 'TANGENT'not in p['attributes']:continue
   a=doc['accessors'][p['attributes']['TANGENT']];v=doc['bufferViews'][a['bufferView']];assert a['componentType']==5126 and a['type']=='VEC4';offset=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',16)
   invalid=[i for i in range(a['count'])if sum(c*c for c in struct.unpack_from('<3f',binary,offset+i*stride))<1e-20]
   if not invalid:continue
   m=doc['materials'][p['material']];assert 'normalTexture'not in m,'Do not remove normal-mapped tangent';assert m['name']in ['pist_glock18','pist_223']
   removed.append(dict(mesh=mi,primitive=pi,material=m['name'],accessor=p['attributes'].pop('TANGENT'),invalidVertexIndices=invalid))
 if not removed:continue
 before=hashlib.sha256(old).hexdigest();encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4);new=struct.pack('<III',0x46546c67,2,28+len(encoded)+len(binary))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+binary;assert new[28+len(encoded):]==binary
 path.write_bytes(new);audit['glb'].update(bytes=len(new),sha256=hashlib.sha256(new).hexdigest());audit['unusedInvalidTangents']=dict(removed=removed,beforeGlbSHA256=before,binSha256=hashlib.sha256(binary).hexdigest(),allBinaryBytesUnchanged=True,reason='Source pistol VMT has no normal map; zero tangents invalid glTF. Original accessor and data retained.')
 (out/'audit.json').write_text(json.dumps(audit,indent=2)+'\n');metadata=json.loads((out/'metadata.json').read_text());metadata['glb']=audit['glb'];metadata['unusedInvalidTangents']=audit['unusedInvalidTangents'];(out/'metadata.json').write_text(json.dumps(metadata,indent=2)+'\n');(out/'gltf-structure.json').write_text(json.dumps(doc,indent=2)+'\n');print(directory,audit['glb']['sha256'])
