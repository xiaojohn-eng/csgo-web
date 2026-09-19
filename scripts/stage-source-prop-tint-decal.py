"""Stage the exact GPU-reviewed optional compound crate data; no default toggle."""
from pathlib import Path
import hashlib,json,os,tempfile
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'.reference-assets/source-exports/dust2-vhv/tint-decal';DEST=ROOT/'public/source/csgo-12426148/dust2/vhv/tint-decal'
sha=lambda b:hashlib.sha256(b).hexdigest()
def main():
    proof=ROOT/'output/playwright/source-vhv-r5-gpu.json';gpu=json.loads(proof.read_bytes());m=json.loads((BASE/'manifest.json').read_bytes());uv=json.loads((BASE/'uv-remap.json').read_bytes())
    assert gpu['errors']==[] and gpu['baseline']==gpu['released'] and gpu['visualReview']['reviewedAllFourImages']
    assert gpu['defaultEnableTintDecal'] is False and gpu['frozenR4ScreenshotsByteIdentical']
    assert len(gpu['numeric']['cases'])==64 and gpu['numeric']['maximumError']<.5/255 and gpu['numeric']['baseline']==gpu['numeric']['released']
    for key in ('sourceHashes','screenshotHashes'):
        for path,expected in gpu[key].items():assert sha((ROOT/path).read_bytes())==expected,path
    assert m['format']=='source-prop-tint-decal-v1' and len(m['materials'])==2 and len(m['textures'])==3 and m['sourceBspSha256']==uv['sourceBspSha256']
    assert len(uv['records'])==uv['verifiedRecords']==11 and all(r['verified'] for r in uv['records'])
    assert len(gpu['borrowedOriginalTextureProof'])==2
    for team in ('ct','t'):
        a,b=[f for f in gpu['frames'] if f['team']==team];assert (a['mode'],b['mode'])==('r4','r5')
        before,after=a['state']['lighting'],b['state']['lighting'];assert (before['appliedMeshes'],after['appliedMeshes'],after['tintDecalMeshes'])==(2257,2325,68)
        assert after['verification']['eligibleTriangles']-before['verification']['eligibleTriangles']==278616
        assert (after['tintMaskMeshes'],after['decalMultiplyMeshes'])==(249,40)
        assert after['tintDecalTextures']['ownedTextures']==1 and after['tintDecalTextures']['borrowedTextures']==2
        for key in ('calls','triangles'):assert a['state']['asset']['render'][key]==b['state']['asset']['render'][key]
    files={}
    for receipt in m['textures']+[m['instanceRGBA'],uv['file']]:
        path=BASE/receipt['url'];assert path.parent==BASE;data=path.read_bytes();assert len(data)==receipt['bytes'] and sha(data)==receipt['sha256'];files[path.name]=data
    files.update({name:(BASE/name).read_bytes() for name in ('manifest.json','uv-remap.json')});DEST.mkdir(parents=True,exist_ok=True)
    def put(name,data):
        path=DEST/name
        if path.exists():assert path.read_bytes()==data,'Different staged original resource: '+name
        else:
            with tempfile.NamedTemporaryFile(dir=DEST,prefix=name+'.',suffix='.tmp',delete=False) as stream:stream.write(data);temp=Path(stream.name)
            os.replace(temp,path)
        assert sha(path.read_bytes())==sha(data)
    for name,data in files.items():put(name,data)
    receipt={'format':'source-prop-tint-decal-stage-v1','baseURL':'/source/csgo-12426148/dust2/vhv/tint-decal/','sourceBspSha256':m['sourceBspSha256'],
        'originalGLBSha256':uv['originalGLBSha256'],'encodingEvidenceSha256':m['encodingEvidenceSha256'],'gpuReceiptSha256':sha(proof.read_bytes()),
        'files':{name:{'bytes':len(data),'sha256':sha(data)}for name,data in files.items()},'defaultEnableTintDecal':False,
        'enableParameter':'loadSourcePropLighting(gltf,{baseURL:vhvRemapURL,maxTextureSize,enablePlainUnbumped:true,enableDecalMultiply:true,enableTintMask:true,enableTintDecal:true})',
        'appliedCompoundMeshes':68,'appliedCompoundTriangles':278616,'totalAppliedMeshes':2325,
        'additionalMemoryWhenR3R4Loaded':{'ownedTintTextureBytesIncludingMipmaps':1398100,'ownedUV2LookupBytes':819200,'borrowedTextures':2},
        'limitations':['Two exact opaque original crate VMTs, mode1 only','Original alpha, envmap, selfillum and other material features excluded','Numeric probe uses 8-bit output and decoded-token float32 oracle; not bit-exact original D3D GPU','No original-client same-camera exposure/full appearance comparison']}
    data=(json.dumps(receipt,indent=2)+'\n').encode();put('stage-receipt.json',data)
    print(json.dumps({'path':str(DEST/'stage-receipt.json'),'sha256':sha(data),'filesVerified':len(files),'gpuReceiptSha256':sha(proof.read_bytes())},indent=2))
if __name__=='__main__':main()
