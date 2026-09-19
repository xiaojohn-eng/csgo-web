"""Stage only the four original tint textures and exact per-instance RGBA bytes.

Requires the independent R3/R4 GPU comparison and the source files it exercised.
Does not enable the production option, replace R3 data, or alter original assets.
"""
from pathlib import Path
import hashlib,json,os,tempfile

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'.reference-assets/source-exports/dust2-vhv/tint'
DEST=ROOT/'public/source/csgo-12426148/dust2/vhv/tint'
sha=lambda data:hashlib.sha256(data).hexdigest()

def main():
    proof=ROOT/'output/playwright/source-vhv-r4-gpu.json'
    gpu=json.loads(proof.read_bytes());m=json.loads((BASE/'manifest.json').read_bytes())
    assert gpu['errors']==[] and gpu['baseline']==gpu['released']
    assert gpu['visualReview']['reviewedAllFourImages'] and gpu['defaultEnableTintMask'] is False
    for path,expected in gpu['sourceHashes'].items():assert sha((ROOT/path).read_bytes())==expected,path
    for path,expected in gpu['screenshotHashes'].items():assert sha((ROOT/path).read_bytes())==expected,path
    assert len(gpu['frames'])==4
    for team in ('ct','t'):
        r3,r4=[f for f in gpu['frames'] if f['team']==team]
        assert (r3['mode'],r4['mode'])==('r3','r4')
        a,b=r3['state']['lighting'],r4['state']['lighting']
        assert (a['appliedMeshes'],b['appliedMeshes'],b['tintMaskMeshes'],b['decalMultiplyMeshes'])==(2008,2257,249,40)
        assert b['verification']['eligibleTriangles']-a['verification']['eligibleTriangles']==867781
        assert b['tintTextures']['hashVerified'] and not b['tintTextures']['instanceAlphaUsed']
        for key in ('calls','triangles'):assert r3['state']['asset']['render'][key]==r4['state']['asset']['render'][key]
    assert m['format']=='source-prop-tint-v1' and len(m['textures'])==len(m['materials'])==4
    assert m['encodingEvidenceSha256']==gpu['sourceHashes']['.reference-assets/source-exports/dust2-vhv/encoding/tint/tint-evidence.json']
    files={}
    for receipt in m['textures']+[m['instanceRGBA']]:
        path=BASE/receipt['url'];assert path.parent==BASE
        data=path.read_bytes();assert len(data)==receipt['bytes'] and sha(data)==receipt['sha256'],path
        files[path.name]=data
    files['manifest.json']=(BASE/'manifest.json').read_bytes()
    DEST.mkdir(parents=True,exist_ok=True)
    for name,data in files.items():
        path=DEST/name
        if path.exists():assert path.read_bytes()==data,'Different staged original resource: '+name
        else:
            with tempfile.NamedTemporaryFile(dir=DEST,prefix=name+'.',suffix='.tmp',delete=False) as stream:
                stream.write(data);temp=Path(stream.name)
            os.replace(temp,path)
        assert sha(path.read_bytes())==sha(data),path
    receipt={'format':'source-prop-tint-stage-v1','baseURL':'/source/csgo-12426148/dust2/vhv/tint/',
        'sourceBspSha256':m['sourceBspSha256'],'encodingEvidenceSha256':m['encodingEvidenceSha256'],
        'files':{name:{'bytes':len(data),'sha256':sha(data)} for name,data in files.items()},
        'gpuReceiptSha256':sha(proof.read_bytes()),'defaultEnableTintMask':False,
        'enableParameter':'loadSourcePropLighting(gltf,{baseURL:vhvRemapURL,maxTextureSize,enablePlainUnbumped:true,enableDecalMultiply:true,enableTintMask:true})',
        'gpuAppliedTintMeshes':249,'gpuAppliedTintTriangles':867781,'gpuTotalAppliedMeshes':2257,
        'limits':{'additionalTintTextures':4,'textureBytesIncludingMipmaps':10136232,'originalInstanceRGBACount':3158},
        'limitations':['Only four exact original pure bumped+tint materials with default white material color',
            'Tint+decal, unbumped tint, envmap/selfillum and original instance alpha remain excluded',
            'No original-client same-camera exposure comparison or full Source appearance claim']}
    data=(json.dumps(receipt,indent=2)+'\n').encode();path=DEST/'stage-receipt.json'
    if path.exists():assert path.read_bytes()==data,'Different staged tint receipt'
    else:path.write_bytes(data)
    assert path.read_bytes()==data
    print(json.dumps({'stage':str(path),'receiptSha256':sha(data),'verifiedFiles':len(files),'gpuReceiptSha256':receipt['gpuReceiptSha256']},indent=2))

if __name__=='__main__':main()
