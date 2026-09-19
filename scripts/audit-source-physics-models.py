"""Independently compare raw IVP vertices, original MDL bones and exported props.

Factory-startup Blender provides SourceIO's native VPK ABI. No Blender objects
are constructed. Collision truth comes from PHY bytes and native axis evidence,
not render extents. SDK AngleMatrix is implemented directly, without the
exporter's Blender Euler helper. Both original and corrected exports are read.
"""
from pathlib import Path
from collections import Counter
import hashlib
import json
import math
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools'))
import bpy
import numpy as np
from SourceIO.library.utils import TinyPath, FileBuffer, MemoryBuffer
from SourceIO.library.shared.app_id import SteamAppId
from SourceIO.library.shared.content_manager import ContentManager
from SourceIO.library.shared.content_manager.providers.loose_files import LooseFilesContentProvider
from SourceIO.library.shared.content_manager.providers.vpk_provider import VPKContentProvider
from SourceIO.library.source1.bsp.bsp_file import open_bsp
import SourceIO.library.source1.bsp.lumps
from SourceIO.library.models.phy.phy import Phy, SolidHeader
from SourceIO.library.models.mdl.v49 import MdlV49
from SourceIO.library.models.mdl.structs.header import StudioHDRFlags
from SourceIO.library.models.vvd.header import Header as VVDHeader

assert bpy.app.background and '--factory-startup' in sys.argv
folder = ROOT / '.reference-assets/source-exports/dust2'
corrected_bytes = (folder / 'collision-ivp-corrected/collision.json').read_bytes()
data = json.loads(corrected_bytes)
old = json.loads((folder / 'collision/collision.json').read_bytes())
assert len(data['colliders']) == len(old['colliders'])
assert len(data['geometries']) == len(old['geometries'])
props = json.loads((ROOT / 'output/source1/de_dust2/static-props.json').read_bytes())['props']
axis = json.loads((ROOT / 'output/tests/source-physics-axis.json').read_bytes())
assert axis['status'] == 'original_App740_SSE_conversion_block_passed'
game = ROOT / '.reference-assets/csgo-legacy/csgo'
cm = ContentManager()
bsp = open_bsp(TinyPath(game/'maps/de_dust2.bsp'), FileBuffer(TinyPath(game/'maps/de_dust2.bsp')), cm, SteamAppId.COUNTER_STRIKE_GO)
providers = [bsp.get_lump('LUMP_PAK'), LooseFilesContentProvider(TinyPath(game), SteamAppId.COUNTER_STRIKE_GO),
             VPKContentProvider(TinyPath(game/'pak01_dir.vpk'), SteamAppId.COUNTER_STRIKE_GO)]
for provider in providers:
    cm.add_child(provider)
cm.priority_list = providers
u = .0254
C = np.array([[1,0,0], [0,0,1], [0,-1,0]], dtype=np.float64)


def sdk_angle_matrix(angles):
    # Fixed SDK mathlib_base.cpp AngleMatrix: columns forward, left, up.
    pitch, yaw, roll = map(math.radians, angles)
    sp, cp, sy, cy, sr, cr = math.sin(pitch), math.cos(pitch), math.sin(yaw), math.cos(yaw), math.sin(roll), math.cos(roll)
    return np.array([[cp*cy, sp*sr*cy-cr*sy, sp*cr*cy+sr*sy],
                     [cp*sy, sp*sr*sy+cr*cy, sp*cr*sy-sr*cy], [-sp, sr*cp, cr*cp]])


def quat_matrix(q):
    x,y,z,w = q
    return np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                     [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
                     [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])


def original_leaves(solid, raw):
    nodes = [solid.collision_model.root_tree]
    leaves = []
    while nodes:
        node = nodes.pop()
        if node.left_node is not None: nodes.append(node.left_node)
        if node.right_node is not None: nodes.append(node.right_node)
        leaf = node.convex_leaf
        if leaf is not None and not leaf.has_children and leaf.triangles: leaves.append(leaf)
    result = []
    for leaf in leaves:
        ids = sorted(leaf.unique_vertices)
        # Direct bounded vec4 reads: intentionally bypass get_vertex_data.
        ivp = np.array([struct.unpack_from('<4f', raw, leaf.vertex_data_offset + i*16)[:3] for i in ids], dtype=np.float64)
        source = ivp[:, [0,2,1]].copy() / u
        source[:,2] *= -1
        result.append((leaf, ivp, source))
    return result


def world_vertices(instance, export):
    g = export['geometries'][instance['geometry']]
    v = np.asarray(g['vertices']).reshape((-1,3)) * instance['scale']
    return v @ quat_matrix(instance['rotation']).T + instance['translation']


def extent(v):
    return [v.min(axis=0).tolist(), v.max(axis=0).tolist()]


models = []
raw_shapes = {}
for row in data['staticPhyModels']:
    name = row['model']; path = TinyPath(name)
    mdl_raw = cm.find_file(path).read(); mdl = MdlV49.from_buffer(MemoryBuffer(mdl_raw))
    phy_raw = cm.find_file(path.with_suffix('.phy')).read(); phy = Phy.from_buffer(MemoryBuffer(phy_raw))
    assert phy.header.checksum == (mdl.header.checksum & 0xffffffff) == row['checksum']
    assert hashlib.sha256(phy_raw).hexdigest() == row['sha256']
    assert mdl.header.flags & StudioHDRFlags.STATIC_PROP
    bones = []
    for b in mdl.bones:
        # pose_to_bone is stored by this parser transposed. Retain both the raw
        # original local transform and the original 3x4 inverse bind matrix.
        inverse = np.eye(4); inverse[:3,:] = b.pose_to_bone.T
        local = np.eye(4); local[:3,:3] = quat_matrix(b.quat); local[:3,3] = b.position
        parent = np.eye(4) if b.parent_id < 0 else np.asarray(bones[b.parent_id]['worldBind'])
        world_bind = parent @ local
        bones.append(dict(id=b.bone_id, name=b.name, parent=b.parent_id, position=list(b.position), quaternion=list(b.quat),
                          worldBind=world_bind.tolist(), originalPoseToBone=inverse.tolist(), physicsBone=b.physics_bone_index,
                          inverseProductMaxError=float(np.abs(world_bind @ inverse - np.eye(4)).max())))
    leaf_bones = Counter()
    for solid_id, solid in enumerate(phy.solids):
        for leaf_id, (leaf, ivp, source) in enumerate(original_leaves(solid, phy_raw)):
            leaf_bones[leaf.bone_id] += 1
            raw_shapes[(name, solid_id, leaf_id)] = source
    models.append(dict(model=name, mdlSha256=hashlib.sha256(mdl_raw).hexdigest(), phySha256=row['sha256'],
                       checksum=row['checksum'], staticProp=True, bones=bones, phyLeafBoneIds=dict(leaf_bones),
                       physicsKeyvalues=phy.kv))
print('ORIGINAL_MODELS', len(models), 'bones', dict(Counter(len(m['bones']) for m in models)), flush=True)

instances = []; max_error = 0; reflected_max = 0; samples = []
# Pick actual asymmetric tilted instances from multiple models; always include
# the exact failed ladder and original CT stairs. No synthetic replacement.
chosen = {2647,1216}
chosen_models = {props[i]['model'] for i in chosen}
for instance in data['colliders']:
    if instance['source']['layer'] != 'propPhy': continue
    index = instance['source']['prop']; p = props[index]
    if len(chosen) < 12 and (abs(p['rotation'][0]) > .01 or abs(p['rotation'][2]) > .01) and p['model'] not in chosen_models:
        chosen.add(index); chosen_models.add(p['model'])

for instance, previous in zip(data['colliders'], old['colliders']):
    assert instance['source'] == previous['source'] and instance['roles'] == previous['roles']
    source = instance['source']
    if source['layer'] != 'propPhy': continue
    index = source['prop']; p = props[index]; g = data['geometries'][instance['geometry']]['source']
    original = raw_shapes[(g['model'], g['solid'], g['leaf'])]
    matrix = sdk_angle_matrix(p['rotation']); scale = p.get('uniform_scale') or 1
    expected = ((original * scale) @ matrix.T + p['origin']) @ C.T * u
    actual = world_vertices(instance, data); old_actual = world_vertices(previous, old)
    error = float(np.abs(actual-expected).max()); old_error = float(np.abs(old_actual-expected).max())
    max_error = max(max_error,error); reflected_max = max(reflected_max,old_error)
    assert error < .0005, (index,g,error)  # Numerical float32 export/quaternion roundoff only.
    instances.append(dict(prop=index,geometry=instance['geometry'],points=len(original),maxErrorMetres=error))
    if index in chosen:
        samples.append(dict(prop=index,model=p['model'],originSource=p['origin'],anglesSource=p['rotation'],scale=scale,
                            geometry=instance['geometry'],convexPoints=len(original),sdkSourceRotation=matrix.tolist(),
                            correctedMaxErrorMetres=error,oldReflectedMaxErrorMetres=old_error,
                            nativeInverseLocalSourceBounds=extent(original),correctedWorldBounds=extent(actual),oldWorldBounds=extent(old_actual)))

render_checks = []
for index in sorted(chosen):
    p = props[index]; raw = cm.find_file(TinyPath(p['model']).with_suffix('.vvd')).read()
    header = VVDHeader.from_buffer(MemoryBuffer(raw))
    expected_checksum = next(m['checksum'] for m in models if m['model']==p['model'])
    assert header.checksum == expected_checksum
    positions = np.array([struct.unpack_from('<3f',raw,header.vertex_data_offset+i*48+16) for i in range(header.lod_vertex_count[0])])
    source = np.concatenate([points for key,points in raw_shapes.items() if key[0]==p['model']])
    m = sdk_angle_matrix(p['rotation']); scale=p.get('uniform_scale') or 1
    render_checks.append(dict(prop=index,model=p['model'],vvdSha256=hashlib.sha256(raw).hexdigest(),vertexCount=len(positions),
                              rawVvdSourceBounds=extent(positions),originalPhySourceBounds=extent(source),
                              originalVvdWorldBounds=extent((positions*scale @ m.T + p['origin']) @ C.T * u),
                              originalPhyWorldBounds=extent((source*scale @ m.T + p['origin']) @ C.T * u),
                              purpose='Diagnostic extent comparison only: simplified PHY is not required to match render bounds.'))

# Original world VPHY uses the same byte format and inverse; validate it too.
world_raw=(ROOT/'output/source1/de_dust2/lumps/29-physics_collide.bin').read_bytes(); offset=0; world_shapes={}
while offset<len(world_raw):
    model,size,script_size,count=struct.unpack_from('<4i',world_raw,offset);offset+=16
    if model==-1: break
    end=offset+size
    for solid_id in range(count):
        length=struct.unpack_from('<I',world_raw,offset)[0]+4; raw=world_raw[offset:offset+length];offset+=length
        solid=SolidHeader.from_buffer(MemoryBuffer(raw))
        for leaf_id,(_,_,points) in enumerate(original_leaves(solid,raw)):world_shapes[(model,solid_id,leaf_id)]=points
    assert offset==end; offset=end+script_size
world_errors=[]
entities=json.loads((ROOT/'output/source1/de_dust2/entities.json').read_bytes())
entity_models={int(e['model'][1:]):e for e in entities if str(e.get('model','')).startswith('*')}
for instance in data['colliders']:
    s=instance['source']
    if s['layer']!='worldVphy':continue
    entity=entity_models.get(s['model'],{})
    angles=list(map(float,entity.get('angles','0 0 0').split()))
    origin=list(map(float,entity.get('origin','0 0 0').split()))
    expected=(world_shapes[(s['model'],s['solid'],s['leaf'])] @ sdk_angle_matrix(angles).T+origin) @ C.T*u
    error=float(np.abs(world_vertices(instance,data)-expected).max())
    assert error<.0005,error
    world_errors.append(error)

# The repair must preserve original brush/displacement vertices, triggers,
# instance identities, masks and missing-PHY boundaries byte-for-byte as data.
for a,b in zip(data['geometries'],old['geometries']):
    if a['source']['layer'] in ('brush','displacement'):assert a==b
assert data['sensors']==old['sensors'] and data['missingPHY']==old['missingPHY'] and data['stats']==old['stats']
report=dict(status='PASS',collisionSha256=hashlib.sha256(corrected_bytes).hexdigest(),nativeAxisBinarySha256=axis['binarySha256'],
    sdkAngleMatrixSource='https://raw.githubusercontent.com/ValveSoftware/source-sdk-2013/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/mathlib/mathlib_base.cpp',
    models=models,modelCount=len(models),boneCountHistogram=dict(Counter(len(m['bones']) for m in models)),
    nonIdentityBindModels=[m['model'] for m in models if any(np.abs(np.asarray(b['worldBind'])-np.eye(4)).max()>1e-5 for b in m['bones'])],
    allPropInstances=len(instances),allPropPointComparisons=sum(i['points'] for i in instances),maxPropPointErrorMetres=max_error,
    originalWrongBasisMaxErrorMetres=reflected_max,worldVphyColliders=len(world_errors),maxWorldVphyPointErrorMetres=max(world_errors),
    selectedPropIds=sorted(chosen),asymmetricInstances=samples,rawRenderCrosschecks=render_checks,
    unchanged=['original brush halfspaces/geometries','original displacement grids/geometries','sensor transforms','roles','missing PHY'],
    limits=['Original native conversion block plus original PHY coordinates and fixed SDK AngleMatrix are tested; the complete original physics engine is not executed.',
            'Render extents are diagnostic and are never used as collision replacements or proof of convex completeness.'])
out=ROOT/'output/tests/source-physics-models.json';out.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k not in ('models','asymmetricInstances','rawRenderCrosschecks')},indent=2))
