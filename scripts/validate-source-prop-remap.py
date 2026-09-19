"""Independent existing GLB -> exact raw VVD file index readback.

No candidate GLB, SourceIO, Blender, nearest matching or normal quantization.
The mapper separately proves the complete oriented triangle/material multiset.
This validator proves every accepted drawn vertex points to exact original
position/UV, and every instance's addressed 12B span equals the original VHV.
"""
from pathlib import Path
from collections import Counter
import hashlib,importlib.util,json,struct,sys,time,zipfile
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'.reference-assets/source-exports/dust2-vhv';GAME=ROOT/'.reference-assets/csgo-legacy/csgo'
def sha(data):return hashlib.sha256(data).hexdigest()
def main():
    started=time.perf_counter();receipt=json.loads((OUT/'remap/manifest.json').read_text());inventory=json.loads((OUT/'inventory.json').read_text())
    original=(ROOT/'.reference-assets/source-exports/dust2/props.glb').read_bytes();assert sha(original)==receipt['originalGLBSha256']
    n=struct.unpack_from('<I',original,12)[0];doc=json.loads(original[20:20+n]);binary=memoryview(original)[28+n:]
    remap=(OUT/'remap/original-prop-to-vhv.u32').read_bytes();source_map=(OUT/'source-vertex-map.u32').read_bytes();light=(OUT/'instance-lighting.bin').read_bytes()
    assert sha(remap)==receipt['sha256'] and sha(light)==receipt['instanceLightingSha256']
    assert sha(source_map)==inventory['binary']['mapping']['sha256']
    def values(index):
        a=doc['accessors'][index];v=doc['bufferViews'][a['bufferView']];assert not v.get('byteStride') and not a.get('sparse')
        count={'SCALAR':1,'VEC2':2,'VEC3':3}[a['type']];kind={5123:'H',5125:'I',5126:'f'}[a['componentType']]
        start=v.get('byteOffset',0)+a.get('byteOffset',0);size=struct.calcsize('<'+kind)*count*a['count']
        return list(struct.iter_unpack('<'+kind*count,binary[start:start+size]))
    spec=importlib.util.spec_from_file_location('prop_remap_vpk',ROOT/'scripts/inventory-source-map.py');module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
    index=module.VPKIndex(GAME/'pak01_dir.vpk');cache={};remaining=Counter(r['model'] for r in receipt['records'] if r['verified'])
    vertices=corners=primitives=0
    with zipfile.ZipFile(ROOT/'output/source1/de_dust2/lumps/40-pakfile.bin') as pak:
        members={p.lower():p for p in pak.namelist()}
        for record in receipt['records']:
            if not record['verified']:continue
            name=record['model'];model=inventory['models'][record['sourceModelIndex']];assert name==model['path']
            if name not in cache:
                path=(name[:-4]+'.vvd').lower();vvd=pak.read(members[path]) if path in members else (GAME/path).read_bytes() if (GAME/path).is_file() else index.read(path)
                assert sha(vvd)==inventory['dependencies'][path]['sha256'];assert struct.unpack_from('<I',vvd,48)[0]==0
                start=struct.unpack_from('<I',vvd,56)[0];file_ids=[]
                for group in model['groups']:
                    file_ids.extend(x[1] for x in struct.iter_unpack('<2I',source_map[group['mappingOffset']:group['mappingOffset']+group['mappingBytes']]))
                positions=[]
                for file_id in file_ids:
                    x,y,z=struct.unpack_from('<3f',vvd,start+48*file_id+16);u,v=struct.unpack_from('<2f',vvd,start+48*file_id+40);positions.append((x,z,-y,u,v))
                cache[name]=positions
            positions=cache[name];p=doc['meshes'][record['mesh']]['primitives'][record['primitive']]
            xyz=values(p['attributes']['POSITION']);uv=values(p['attributes']['TEXCOORD_0']);indices=[x[0] for x in values(p['indices'])]
            mapped=[x[0] for x in struct.iter_unpack('<I',remap[record['mapOffset']:record['mapOffset']+record['mapBytes']])]
            used=set(indices)
            for i in used:
                hw=mapped[i];assert hw<len(positions),(name,i,hw);assert xyz[i]+uv[i]==positions[hw],(name,i)
            assert all(hw==0xffffffff or hw<len(positions) for hw in mapped)
            vertices+=len(used);corners+=len(indices);primitives+=1;remaining[name]-=1
            if not remaining[name]:del cache[name]
        payloads=0
        for instance in inventory['instances']:
            raw=pak.read(instance['vhv']);assert sha(raw)==instance['vhvSha256'];base=instance['groups'][0]['lightingOffset'];flat=0
            for group in instance['groups']:
                lod,count,offset=struct.unpack_from('<3I',raw,40+28*group['sourceGroup'])
                assert lod==0 and count==group['vertexCount'] and group['lightingOffset']==base+flat*12
                assert light[base+flat*12:base+(flat+count)*12]==raw[offset:offset+count*12];flat+=count;payloads+=1
    result={'status':'independent_original_GLTF_to_raw_VVD_and_original_VHV_readback_passed','verifiedPrimitives':primitives,'uniqueDrawnVerticesChecked':vertices,
        'drawnTriangleCornersChecked':corners,'originalVHVGroupPayloadsChecked':payloads,'originalInstances':len(inventory['instances']),
        'originalGLBSha256':receipt['originalGLBSha256'],'remapSha256':sha(remap),'instanceLightingSha256':sha(light),
        'excludedAmbiguousMeshes':len(receipt['failures']),'excludedAmbiguousPrimitives':len(receipt['records'])-primitives,
        'candidateGLBUsed':False,'nearestMatching':False,'geometryModified':False,'gpuVerified':False,'seconds':time.perf_counter()-started}
    (OUT/'remap/verification.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
if __name__=='__main__':main()
