"""Stage verified local Dust2 candidates and a private loader manifest.

Does not switch any running room or claim final Source visual/physics parity.
"""
from pathlib import Path
import hashlib,json,re,shutil

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'.reference-assets/source-exports'
PUBLIC=ROOT/'public/source/csgo-12426148/dust2'
PRIVATE=SOURCE/'dust2-runtime'
PUBLIC.mkdir(parents=True,exist_ok=True);PRIVATE.mkdir(parents=True,exist_ok=True)
receipt=json.loads((SOURCE/'dust2-lightmapped/lightmap-geometry-readback.json').read_text())
assert receipt['status']=='passed' and receipt['displacementFacesVerifiedAgainstRawGridAndVertices']==8324
assert receipt['lightmappedSha256']=='91b52e52b988e1b41b07b9cd365c159d615934fa49f07c3fa1e438d43269ffa8'
props=json.loads((SOURCE/'dust2/props-manifest.json').read_text())
paths={
    'world':('dust2-lightmapped/world.glb','world.glb'),
    'props':('dust2/props.glb','props.glb'),
    'lightmaps':('dust2-lightmapped/lightmaps.json','lightmaps.json'),
    'atlas':('dust2-lightmapped/lightmap-0.rgbexp32','lightmap-0.rgbexp32'),
    'visibility':('dust2/visibility/visibility.json','visibility.json'),
    'level':('dust2/level.json','level.json'),
    'collision':('dust2/collision-ivp-corrected/collision.json','collision.json'),
    'navigation':('dust2/navigation/navigation.json','navigation.json'),
    'sky':('dust2/sky/sky.json','sky.json'),
    'skyTexture2':('dust2/sky/nuke_clouds_001.png','sky-cloud-texture2.png'),
    'environment':('dust2/environment.json','environment.json'),
}
manifest={'format':'source-map-runtime-v1','id':'de_dust2',
    'sourceBspSha256':'b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc',
    'worldTriangles':302307,'propTriangles':6269945,'files':{},
    'limitations':['Original world directional bump lightmaps and secondary displacement textures pending',
      'Original prop VHV coverage remains branch-specific',
      'Source sky clouds: the two-texture shader draws its own product (texture0 * texture1 * '
      'the material modulation, then rgb * cLightScale from the map\'s own light_environment), '
      'and the scene fades with the map\'s own fog ramp; the port still does not auto-expose to '
      'the range the map states, draw its sun sprite, or apply its colour-correction lookup',
      'Original collision missing-PHY and virtualterrain boundaries remain; NAV is static reachability only']}
private={**manifest,'files':{}}
cloud_texture=json.loads((SOURCE/'dust2/sky/cloud-texture2.json').read_text())
assert cloud_texture['status']=='cloud_texture2_extracted'
for key,(relative,name) in paths.items():
    source=SOURCE/relative;data=source.read_bytes();digest=hashlib.sha256(data).hexdigest()
    if key=='world':assert digest==receipt['lightmappedSha256']
    if key=='props':assert digest==props['glb']['sha256']
    if key=='skyTexture2':
        assert digest==cloud_texture['png']['sha256'] and len(data)==cloud_texture['png']['bytes']
        # The cloud descriptor names this file by the material's own texture name; the staged
        # name is what the loader's manifest serves. Both must describe the same material.
        staged=json.loads((SOURCE/'dust2/sky/sky.json').read_text())
        cloud=[m for m in staged['unlitMaterials'] if m['shader']=='unlittwotexture']
        assert len(cloud)==1 and cloud[0]['second']['file']==Path(relative).name, cloud
    if key=='environment':
        # The runtime reads this map's environment from the generated table; the staged copy is the
        # same bytes, and the table records their hash, so the two cannot describe different maps.
        table=(ROOT/'game/source-environment-data.ts').read_text()
        recorded=re.search(r"environmentJsonSha256: '([0-9a-f]{64})'",table)
        assert recorded and recorded.group(1)==digest, (key,digest)
    if key=='collision':
        audit=json.loads((ROOT/'output/tests/source-physics-models.json').read_text())
        assert audit['status']=='PASS' and audit['collisionSha256']==digest
        assert digest=='55184f994bc852dc229bbed0cb772cb843b1bc662054013c5076df98ce2a43cb'
    target=PUBLIC/name
    if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest()!=digest:shutil.copyfile(source,target)
    assert hashlib.sha256(target.read_bytes()).hexdigest()==digest
    record={'bytes':len(data),'sha256':digest}
    manifest['files'][key]={**record,'url':name};private['files'][key]={**record,'url':'../'+relative}
(PUBLIC/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(PRIVATE/'manifest.json').write_text(json.dumps(private,indent=2)+'\n')
print(json.dumps({'files':len(paths),'bytes':sum(f['bytes']for f in manifest['files'].values()),
    'publicManifest':str(PUBLIC/'manifest.json'),'privateManifest':str(PRIVATE/'manifest.json')},indent=2))
