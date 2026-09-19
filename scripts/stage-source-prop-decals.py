"""Stage the GPU-reviewed optional R3 original decal subtree only."""
from pathlib import Path
import json,hashlib,os,tempfile
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'.reference-assets/source-exports/dust2-vhv/decal';DEST=ROOT/'public/source/csgo-12426148/dust2/vhv/decal'
sha=lambda data:hashlib.sha256(data).hexdigest()
def main():
 m=json.loads((BASE/'manifest.json').read_bytes());uv=json.loads((BASE/'uv-remap.json').read_bytes());proof=ROOT/'output/playwright/source-vhv-r3-gpu.json';gpu=json.loads(proof.read_bytes())
 assert m['sourceBspSha256']==uv['sourceBspSha256'] and gpu['errors']==[] and gpu['baseline']==gpu['released'] and gpu['visualReview']['reviewedAllFourImages']
 for path,expected in gpu['sourceHashes'].items():assert sha((ROOT/path).read_bytes())==expected,path
 assert len(gpu['frames'])==4 and all(f['state']['lighting']['decalMultiplyMeshes']==40 for f in gpu['frames'] if f['mode']=='r3')
 files={}
 for receipt in m['textures']+[uv['file']]:
  path=BASE/receipt['url'];assert path.parent==BASE;data=path.read_bytes();assert len(data)==receipt['bytes'] and sha(data)==receipt['sha256'];files[path.name]=data
 files.update({name:(BASE/name).read_bytes() for name in ('manifest.json','uv-remap.json')})
 DEST.mkdir(parents=True,exist_ok=True)
 for name,data in files.items():
  path=DEST/name
  if path.exists():assert path.read_bytes()==data,'Different staged original resource: '+name
  else:
   with tempfile.NamedTemporaryFile(dir=DEST,prefix=name+'.',suffix='.tmp',delete=False) as stream:stream.write(data);temp=Path(stream.name)
   os.replace(temp,path)
  assert sha(path.read_bytes())==sha(data)
 receipt={'format':'source-prop-decal-stage-v1','baseURL':'/source/csgo-12426148/dust2/vhv/decal/','sourceBspSha256':m['sourceBspSha256'],'originalGLBSha256':uv['originalGLBSha256'],
  'files':{name:{'bytes':len(data),'sha256':sha(data)} for name,data in files.items()},'gpuReceiptSha256':sha(proof.read_bytes()),
  'enableParameter':'loadSourcePropLighting(gltf,{baseURL:vhvRemapURL,maxTextureSize,enablePlainUnbumped:true,enableDecalMultiply:true})',
  'gpuAppliedDecalMeshes':40,'limitations':['Optional original bump+decal mode1/2 only; tint/envmap/etc stay original','Autocombine UV2 nonfinite record skipped','Not original-client matched-exposure final appearance']}
 (DEST/'stage-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt,indent=2))
if __name__=='__main__':main()
