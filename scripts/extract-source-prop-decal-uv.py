"""Recover original VVD secondary UV without changing existing props geometry.
Rechecks every oriented triangle and every duplicate candidate using raw UV2;
equal VHV colors never justify an ambiguous decal UV. Pure Python, read only.
"""
from pathlib import Path
from collections import defaultdict,Counter
import hashlib,importlib.util,json,math,struct,sys,zipfile
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'.reference-assets/source-exports/dust2-vhv';OUT=BASE/'decal'
sha=lambda data:hashlib.sha256(data).hexdigest()
def module(name,file):
    s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(s);sys.modules[name]=m;s.loader.exec_module(m);return m
def main():
    m=module('decal_exact_map','map-source-prop-vhv.py');v=module('decal_uv_vpk','inventory-source-map.py')
    index=v.VPKIndex(ROOT/'.reference-assets/csgo-legacy/csgo/pak01_dir.vpk')
    original,obin,oraw=m.glb(ROOT/'.reference-assets/source-exports/dust2/props.glb');source,sbin,sraw=m.glb(BASE/'geometry/props-source-index.glb')
    oldcheck=json.loads((BASE/'geometry/verification.json').read_text());assert sha(oraw)==oldcheck['unchangedOriginalGLBSha256'];assert sha(sraw)==oldcheck['candidateSha256']
    inventory=json.loads((BASE/'inventory.json').read_text());runtime=json.loads((BASE/'remap/runtime.json').read_text());material=json.loads((OUT/'manifest.json').read_text())
    eligible={row['material'] for row in material['materials']};models={row['path']:row for row in inventory['models']};cache={};dependencies={};records=[];binary=bytearray();corners=0;ambiguities=0
    pak=zipfile.ZipFile(ROOT/'output/source1/de_dust2/lumps/40-pakfile.bin');members={p.lower():p for p in pak.namelist()}
    def raw_uv(name):
        if name in cache:return cache[name]
        path=name[:-4].lower()+'.vvd';loose=ROOT/'.reference-assets/csgo-legacy/csgo'/path
        data=pak.read(members[path]) if path in members else loose.read_bytes() if loose.is_file() else index.read(path)
        assert sha(data)==inventory['dependencies'][path]['sha256'];header=struct.unpack_from('<4s15I',data)
        magic,version,checksum,lods=header[:4];count=header[4];assert magic==b'IDSV' and version==4 and checksum==models[name]['checksum'] and header[12]==0
        extraStart=header[15]+16*count;attributeCount,total=struct.unpack_from('<2I',data,extraStart)
        assert total==len(data)-extraStart and 0<attributeCount<9
        attributes=[struct.unpack_from('<3I',data,extraStart+8+12*i) for i in range(attributeCount)]
        matches=[a for a in attributes if a[0]==1];assert len(matches)==1;kind,offset,stride=matches[0]
        assert stride==8 and offset>=8+12*attributeCount and offset+count*8<=total
        uv=list(struct.iter_unpack('<2f',data[extraStart+offset:extraStart+offset+count*8]))
        vertices=[struct.unpack_from('<8f',data,header[14]+48*i+16) for i in range(count)]
        dependencies[path]={'sha256':sha(data),'bytes':len(data),'checksum':checksum,'vertices':count,'extraStart':extraStart,'totalBytesIncludingHeader':total,'attributeType':kind,'offset':offset,'stride':stride,'nonFiniteUV2Vertices':sum(not all(map(math.isfinite,row)) for row in uv)}
        cache[name]=(uv,vertices);return cache[name]
    for record in runtime['records']:
        if record['materialSource'] not in eligible:continue
        meshId,primitiveId=record['mesh'],record['primitive'];uv2,raw=raw_uv(record['model']);faces=defaultdict(list);sourceCounts=Counter();oldCounts=Counter()
        for primitive in source['meshes'][meshId]['primitives']:
            if primitive['material']!=record['material']:continue
            pos=m.accessor(source,sbin,primitive['attributes']['POSITION']);uv=m.accessor(source,sbin,primitive['attributes']['TEXCOORD_0']);ids=[int(x[0]) for x in m.accessor(source,sbin,primitive['attributes']['_SOURCE_VVD'])]
            for i,rid in enumerate(ids):
                x,y,z,nx,ny,nz,u,v=raw[rid];assert pos[i]==(x,z,-y) and uv[i]==(u,v)
            indices=[r[0] for r in m.accessor(source,sbin,primitive['indices'])];keys=[p+t for p,t in zip(pos,uv)]
            for at in range(0,len(indices),3):
                tri=indices[at:at+3];key,rotation=m.canonical([keys[i] for i in tri]);values=[uv2[ids[i]] for i in tri];values=values[rotation:]+values[:rotation];faces[key].append(values);sourceCounts[key]+=1
        primitive=original['meshes'][meshId]['primitives'][primitiveId];pos=m.accessor(original,obin,primitive['attributes']['POSITION']);uv=m.accessor(original,obin,primitive['attributes']['TEXCOORD_0']);keys=[p+t for p,t in zip(pos,uv)]
        indices=[r[0] for r in m.accessor(original,obin,primitive['indices'])];mapped=[None]*len(pos);errors=[]
        for at in range(0,len(indices),3):
            tri=indices[at:at+3];key,rotation=m.canonical([keys[i] for i in tri]);choices=faces.get(key,[]);oldCounts[key]+=1
            if not choices:errors.append('source triangle absent');continue
            if any(not all(math.isfinite(v) for row in choice for v in row) for choice in choices):errors.append('referenced raw UV2 is non-finite');continue
            if any(other!=choices[0] for other in choices[1:]):errors.append('identical source triangle has distinct UV2');continue
            if len(choices)>1:ambiguities+=1
            for vertex,value in zip(tri[rotation:]+tri[:rotation],choices[0]):
                if mapped[vertex] is not None and mapped[vertex]!=value:errors.append('one existing vertex needs distinct UV2')
                else:mapped[vertex]=value
            corners+=3
        if oldCounts!=sourceCounts:errors.append('oriented triangle multiset differs')
        values=[r or (0.,0.) for r in mapped];payload=b''.join(struct.pack('<2f',*row) for row in values);offset=len(binary)//8;binary.extend(payload)
        records.append({'mesh':meshId,'primitive':primitiveId,'model':record['model'],'material':record['materialSource'],'offset':offset,'vertexCount':len(values),
          'verified':not errors and record['verified'],'errors':dict(Counter(errors)),'sha256':sha(payload),'unreferencedVertices':mapped.count(None),
          'UV2DifferentFromBaseVertices':sum(a is not None and a!=b for a,b in zip(mapped,uv))})
    target=OUT/'original-decal-uv.f32';target.write_bytes(binary)
    result={'format':'source-prop-decal-uv-v1','sourceBspSha256':runtime['sourceBspSha256'],'originalGLBSha256':sha(oraw),'sourceIndexGLBSha256':sha(sraw),
      'file':{'url':target.name,'bytes':len(binary),'sha256':sha(binary)},'records':records,'dependencies':dependencies,'verifiedRecords':sum(r['verified'] for r in records),
      'exactCorners':corners,'equalUV2DuplicateCandidates':ambiguities,'originalGeometryModified':False,'nearestPointMatching':False,
      'sourceIOBoundary':'Original totalBytes includes 8-byte extra header; SourceIO compares it after consuming header and incorrectly skips the valid tail'}
    (OUT/'uv-remap.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k not in ('records','dependencies')},indent=2));print('failures',[r for r in records if not r['verified']])
if __name__=='__main__':main()
