"""Stage only reviewed original VHV runtime/remap/lighting into its owned subtree.

Keeps the private runtime descriptor byte-for-byte (including ../ lighting URL).
Does not change the main map manifest, original/meshopt GLBs, HTML or game scene.
CPU verification is required; GPU acceptance remains an explicitly separate gate.
"""
from pathlib import Path
import hashlib,json,os,tempfile
ROOT=Path(__file__).resolve().parents[1];SOURCE=ROOT/'.reference-assets/source-exports/dust2-vhv'
DEST=ROOT/'public/source/csgo-12426148/dust2/vhv'
def sha(data):return hashlib.sha256(data).hexdigest()
def main():
    mapping=json.loads((SOURCE/'remap/verification.json').read_text());three=json.loads((SOURCE/'remap/three-verification.json').read_text())
    descriptor=(SOURCE/'remap/runtime.json').read_bytes();doc=json.loads(descriptor)
    assert mapping['status']=='independent_original_GLTF_to_raw_VVD_and_original_VHV_readback_passed'
    assert three['status']=='actual_Three_original_geometry_and_per_instance_uniform_readback_passed'
    assert doc['format']=='source-prop-vhv-v1' and doc['originalGLBSha256']==mapping['originalGLBSha256']==three['originalGLBSha256']
    assert doc['sourceBspSha256']==three['sourceBspSha256']
    sources={'runtime':('remap/runtime.json',descriptor)}
    for key in ('remap','lighting'):
        relative=Path('remap')/doc['files'][key]['url'];path=(SOURCE/relative).resolve();assert path.is_relative_to(SOURCE.resolve())
        data=path.read_bytes();receipt=doc['files'][key]
        assert len(data)==receipt['bytes'] and sha(data)==receipt['sha256'];sources[key]=(path.relative_to(SOURCE).as_posix(),data)
    assert sha(sources['remap'][1])==mapping['remapSha256'] and sha(sources['lighting'][1])==mapping['instanceLightingSha256']
    staged={}
    for key,(name,data) in sources.items():
        path=DEST/name;path.parent.mkdir(parents=True,exist_ok=True)
        if path.exists():assert sha(path.read_bytes())==sha(data),'Different pre-existing staged file: '+name
        else:
            with tempfile.NamedTemporaryFile(dir=path.parent,prefix=path.name+'.',suffix='.tmp',delete=False) as stream:
                stream.write(data);temporary=Path(stream.name)
            os.replace(temporary,path)
        assert sha(path.read_bytes())==sha(data)
        staged[key]={'url':name,'bytes':len(data),'sha256':sha(data)}
    manifest={'format':'source-prop-vhv-runtime-v1','sourceBspSha256':doc['sourceBspSha256'],'originalGLBSha256':doc['originalGLBSha256'],
      'baseURL':'/source/csgo-12426148/dust2/vhv/remap/','files':staged,'cpuVerifiedMeshes':three['appliedMeshes'],
      'cpuVerifiedTriangles':three['appliedTriangles'],'supportedMaterials':three['uniqueMaterials'],'lookupBytes':three['lookupBytes'],
      'gpuVerified':False,'limitations':['56 reviewed plain bumped VertexLitGeneric materials only','Unsupported and ambiguous primitives retain original material',
        'Source dynamic lights, exposure and complete shader pipeline remain separate','Original private resources; no ownership or redistribution rights inferred']}
    (DEST/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest,indent=2))
if __name__=='__main__':main()
