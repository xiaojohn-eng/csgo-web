"""Stage independently verified complete ordinary AWP world graph and render rig."""
from pathlib import Path
import hashlib,json,struct
ROOT=Path(__file__).resolve().parents[1];source=ROOT/'.reference-assets/source-exports/awp-candidates/awp-world';target=ROOT/'public/source/csgo-12426148/awp-world'
sha=lambda raw:hashlib.sha256(raw).hexdigest()
read=lambda name:json.loads((source/name).read_text())
audit=read('audit.json');metadata=read('metadata.json');pose=read('continuous/pose-data.json');proof=read('dense-readback.json')
assert proof['status']=='passed'and proof['glbSha256']==audit['glb']['sha256']and proof['sourceFrames']==445 and proof['inverseBindMatrices']==94 and proof['validation']['numErrors']==0
raw=Path(audit['glb']['path']).read_bytes();assert sha(raw)==audit['glb']['sha256'];size=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+size]);assert len(doc['skins'])==1
skin=doc['skins'][0];bones={b['name']:i for i,b in enumerate(pose['bones'])};assert len(bones)==94
joints=[dict(bone=bones[doc['nodes'][node]['name']],sourceName=doc['nodes'][node]['name'],gltfNode=node,skinJoint=slot)for slot,node in enumerate(skin['joints'])]
magazine=[i for i,n in enumerate(doc['nodes'])if n.get('name')=='w_snip_awp_mag'];assert len(magazine)==1
rig=dict(format='source-awp-world-rig-v1',weaponId='awp',bones=pose['bones'],skinIndex=0,skinName=skin['name'],joints=joints,magazineNodes=magazine,attachments=pose['attachments'])
target.mkdir(parents=True,exist_ok=True);files=[]
def stage(raw,name,expected=None):
 h=sha(raw);assert expected is None or h==expected;path=target/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw);assert path.read_bytes()==raw;files.append(dict(path=name,bytes=len(raw),sha256=h))
stage(raw,'model.glb',audit['glb']['sha256']);stage((json.dumps(rig,separators=(',',':'))+'\n').encode(),'rig.json')
stage((source/'continuous/pose-data.json').read_bytes(),'pose-data.json');stage((source/'continuous/frames.f64.bin').read_bytes(),'frames.f64.bin',pose['frames']['sha256'])
for name in ['awp','awp_exponent','scope','scope_normal']:stage((source/f'textures/{name}-rgba.png').read_bytes(),f'textures/{name}-rgba.png')
model=next(m for m in metadata['item']['models']if m['role']=='model_world');stage((json.dumps(model['materials'],indent=2)+'\n').encode(),'material-inputs.json')
clips={name:dict(sourceSequence=c['sequence'],name=c['action_name'],fps=c['fps'],frames=c['frame_count'],duration=c['duration_seconds'],events=c['events'])for name,c in audit['clip_checks'].items()}
manifest=dict(format='source-awp-world-v1',sourceApp=740,build=12426148,weaponId='awp',itemDefinition=9,sourceModel=pose['sourceModel'],sourceSHA256=pose['sourceSHA256'],boneCount=94,attachmentCount=14,model='model.glb',rig='rig.json',pose='pose-data.json',frames='frames.f64.bin',clips=clips,files=files,metersPerSourceUnit=.0254,actorYawOffsetRadians=1.5707963267948966,verification=proof,limitations=['Standalone original 94-bone world weapon. Player AWP animation graph and bone merge are separate.','Scope surface retained; gameplay FOV, scope overlay and camera optics are separate.','Original cubemaps, phongalbedoboost and lighting remain material adaptation gaps.'])
raw=(json.dumps(manifest,indent=2)+'\n').encode();(target/'manifest.json').write_bytes(raw)
contract=dict(manifestSha256=sha(raw),**{key:next(f['sha256']for f in files if f['path']==name)for key,name in [('modelSha256','model.glb'),('rigSha256','rig.json'),('poseSha256','pose-data.json'),('framesSha256','frames.f64.bin')]})
(ROOT/'game/source-awp-world-contracts.ts').write_text('// Frozen original App740 AWP world rig; 445 frames and 94 raw IBMs verified.\nexport const SOURCE_AWP_WORLD_ASSETS = '+json.dumps(contract,indent=2)+' as const;\n')
report=dict(path=str(target),files=len(files),bytes=sum(f['bytes']for f in files),**contract);(ROOT/'output/source-awp-world-staged.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
