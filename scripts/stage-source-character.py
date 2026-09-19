"""Stage verified original T+AK assets and continuous pose data for local serving.
Run Blender --background --factory-startup. No global addon/user preference edits.
"""
from pathlib import Path
from dataclasses import asdict
import hashlib
import json
import shutil
import struct
import subprocess
import sys
import numpy as np
import bpy

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / '.reference-assets/source-exports'
OUT = ROOT / 'public/source/csgo-12426148/character-ak'
sha = lambda v: hashlib.sha256(v).hexdigest()

def main():
    assert bpy.app.background and '--factory-startup' in sys.argv
    sourceio = ROOT / '.tools/SourceIO'
    assert subprocess.check_output(['git', '-C', str(sourceio), 'rev-parse', 'HEAD'], text=True).strip() == 'cfc2591d096628a35f570aa830ab75cc8665108b'
    sys.path.insert(0, str(sourceio.parent))
    from SourceIO.library.shared.app_id import SteamAppId
    from SourceIO.library.shared.content_manager.providers.vpk_provider import VPKContentProvider
    from SourceIO.library.utils import TinyPath, MemoryBuffer
    from SourceIO.library.models.mdl.structs.header import MdlHeaderV49
    from SourceIO.library.models.mdl.structs.bone import Bone
    from SourceIO.library.models.mdl.structs.attachment import Attachment
    from SourceIO.library.models.mdl.structs.sequence import StudioSequence
    from SourceIO.library.models.mdl.structs.local_animation import StudioAnimDesc, AnimBoneFlags
    source = PRIVATE / 'character-ak'; audit = json.loads((source / 'audit.json').read_text())
    continuous = PRIVATE / 'character-t/continuous'; pose_raw = (continuous / 'pose-data.json').read_bytes(); pose = json.loads(pose_raw)
    proof = json.loads((continuous / 'verification.json').read_text())
    assert proof['status'] == 'passed-source-pose-conformance' and proof['dataSha256'] == sha(pose_raw)
    assert proof['frameSha256'] == sha((continuous / pose['frames']['file']).read_bytes())
    glb_path = source / audit['glb']['file']; glb = glb_path.read_bytes(); assert sha(glb) == audit['glb']['sha256']
    size = struct.unpack_from('<I', glb, 12)[0]; doc = json.loads(glb[20:20 + size]); bin_start = 28 + size
    assert len(doc['skins']) == 2
    provider = VPKContentProvider(TinyPath(ROOT / '.reference-assets/csgo-legacy/csgo/pak01_dir.vpk'), SteamAppId.COUNTER_STRIKE_GO)
    path = 'models/weapons/w_rif_ak47.mdl'; buffer = provider.find_file(TinyPath(path)); assert buffer is not None
    raw = buffer.read(); assert sha(raw) == audit['dependencies'][path]['sha256']; buffer = MemoryBuffer(raw)
    header = MdlHeaderV49.from_buffer(buffer); assert header.version == 49 and header.bone_count == 94
    buffer.seek(header.bone_offset); bones = [Bone.from_buffer(buffer, header.version) for _ in range(header.bone_count)]
    for i, bone in enumerate(bones): bone.bone_id = i
    buffer.seek(header.local_animation_offset); descriptors = [StudioAnimDesc.from_buffer(buffer) for _ in range(header.local_animation_count)]
    buffer.seek(header.local_sequence_offset); sequences = [StudioSequence.from_buffer(buffer, header.version) for _ in range(header.local_sequence_count)]
    buffer.seek(header.local_attachment_offset); attachments = [Attachment.from_buffer(buffer, header.version) for _ in range(header.local_attachment_count)]
    C = np.array([[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]], dtype=np.float64)
    metadata = []
    for bone in bones:
        inverse = np.eye(4); inverse[:3] = bone.pose_to_bone.T
        metadata.append(dict(name=bone.name, parent=bone.parent_id, flags=int(bone.flags), position=list(bone.position), quaternion=list(bone.quat),
            inverseBindSource=inverse.T.reshape(-1).tolist(), inverseBindGltf=(inverse @ C.T).T.reshape(-1).tolist()))
    mappings = {}; inverse_count = 0
    for role, definitions, expected_count in [('character', pose['mainBones'], 71), ('weapon', metadata, 94)]:
        skin_index = next(i for i, skin in enumerate(doc['skins']) if len(skin['joints']) == expected_count); skin = doc['skins'][skin_index]
        names = {b['name']: i for i, b in enumerate(definitions)}; mapping = []
        accessor = doc['accessors'][skin['inverseBindMatrices']]; view = doc['bufferViews'][accessor['bufferView']]
        for slot, node in enumerate(skin['joints']):
            name = doc['nodes'][node]['name']; i = names[name]
            at = bin_start + view.get('byteOffset', 0) + accessor.get('byteOffset', 0) + slot * view.get('byteStride', 64)
            inverse = struct.unpack_from('<16f', glb, at); assert list(inverse) == definitions[i]['inverseBindGltf']; inverse_count += 1
            mapping.append(dict(bone=i, sourceName=name, gltfNode=node, skinJoint=slot))
        mappings[role] = dict(skinIndex=skin_index, skinName=skin['name'], joints=mapping)
    source_names = {b['name']: i for i, b in enumerate(pose['mainBones'])}
    common = [dict(weaponBone=i, characterBone=source_names[b.name], name=b.name) for i, b in enumerate(bones) if b.name in source_names]
    assert {v['name'] for v in common} == {'weapon_hand_L', 'weapon_hand_R', 'ValveBiped.weapon_bone'}
    # Restore true delta defaults only in this process, matching the independently
    # audited world-model importer, not modifying the pinned SourceIO checkout.
    old_rot = StudioAnimDesc._read_anim_rot_value; old_pos = StudioAnimDesc._read_anim_pos_value
    def read_rot(desc, data, flags, count, base_quat, base_rot, scale):
        if flags & AnimBoneFlags.ANIM_DELTA: base_quat = (0, 0, 0, 1); base_rot = (0, 0, 0)
        return old_rot(desc, data, flags, count, base_quat, base_rot, scale)
    def read_pos(desc, data, flags, count, base_pos, scale):
        return old_pos(desc, data, flags, count, (0, 0, 0) if flags & AnimBoneFlags.ANIM_DELTA else base_pos, scale)
    StudioAnimDesc._read_anim_rot_value = read_rot; StudioAnimDesc._read_anim_pos_value = read_pos
    chunks = []; cursor = 0; animations = []
    try:
        for name in ['default', 'rifle_fire', 'rifle_fire_crouch']:
            sequence = next(s for s in sequences if s.name == name); assert sequence.blend_count == 1 and not sequence.auto_layers
            desc = descriptors[sequence.anim_desc_indices[0]]; assert desc.animblock_id == 0
            decoded = desc.read_animations(buffer, bones); assert decoded is not None
            p = np.zeros((desc.frame_count, len(bones), 3)); q = np.zeros((desc.frame_count, len(bones), 4)); q[:, :, 3] = 1
            if not int(desc.flags) & 4: p[:] = [b.position for b in bones]; q[:] = [b.quat for b in bones]
            for i, bone in enumerate(bones):
                if bone.name in decoded: p[:, i] = decoded[bone.name]['pos']; q[:, i] = decoded[bone.name]['rot']
            assert np.isfinite(p).all() and np.isfinite(q).all(); q /= np.linalg.norm(q, axis=-1, keepdims=True)
            record = dict(name=name, frames=desc.frame_count, fps=desc.fps, flags=int(desc.flags), sequenceFlags=sequence.flags,
                boneWeights=sequence.get_bone_weights(buffer, len(bones)))
            for field, values in [('positions', p), ('quaternions', q)]:
                b = np.asarray(values, dtype='<f8').tobytes(); record[field + 'Offset'] = cursor // 8; record[field + 'Count'] = values.size
                record[field + 'Sha256'] = sha(b); chunks.append(b); cursor += len(b)
            animations.append(record)
    finally:
        StudioAnimDesc._read_anim_rot_value = old_rot; StudioAnimDesc._read_anim_pos_value = old_pos
    binary = b''.join(chunks)
    weapon = dict(format='source-world-weapon-v1', sourceModel=path, sourceMdlSha256=sha(raw), bones=metadata, animations=animations,
        frames=dict(file='weapon-frames.f64.bin', encoding='float64-little-endian', byteLength=len(binary), sha256=sha(binary)),
        boneMerge=common, rigMappings=mappings, attachments=[asdict(a) for a in attachments],
        rules='Original default/delta local frames, then copy the three exact named character Source-world bones; other weapon locals unchanged. Original hand IK remains absent.')
    OUT.mkdir(parents=True, exist_ok=True); files = {}
    def write(name, value, expected=None):
        digest = sha(value); assert expected is None or digest == expected
        target = OUT / name; target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists() or sha(target.read_bytes()) != digest: target.write_bytes(value)
        assert target.read_bytes() == value; files[name] = dict(bytes=len(value), sha256=digest)
    write(glb_path.name, glb, audit['glb']['sha256'])
    write('pose-data.json', pose_raw, proof['dataSha256'])
    write('frames.f64.bin', (continuous / 'frames.f64.bin').read_bytes(), proof['frameSha256'])
    write('frames.f64.bin.gz', (continuous / 'frames.f64.bin.gz').read_bytes())
    write('weapon-data.json', (json.dumps(weapon, separators=(',', ':'), default=lambda v: v.tolist() if hasattr(v, 'tolist') else v) + '\n').encode())
    write('weapon-frames.f64.bin', binary)
    for material in audit['materials']:
        for texture in material['textures']: write(texture['file'], (source / texture['file']).read_bytes(), texture['pngSha256'])
    assert len([f for f in files if f.endswith('.png')]) == 11
    result = dict(format='source-character-stage-v1', build=12426148, characterProfile='tm_leet_varianta', bodyBoneCount=71, animationBoneCount=71,
        poseVersion='csgo-t-ak-12426148:' + sha(pose_raw)[:16], metersPerSourceUnit=.0254,
        actorYawOffsetRadians=np.pi / 2, model=glb_path.name, poseData='pose-data.json', poseFrames='frames.f64.bin', weaponData='weapon-data.json', weaponFrames='weapon-frames.f64.bin',
        files=files, originalInverseBindsVerified=inverse_count, characterBones=71, weaponBones=94,
        limitations=['Public SDK composition is not the closed CSGO client activity graph.', 'Original hand IK, root motion extraction and hitbox extension interpretation remain incomplete.',
                      'Original shader ambient cube/rim and world cubemap remain incomplete. No C02 fallback.'])
    (OUT / 'manifest.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(dict(status='staged-exact-original-files', files=len(files), bytes=sum(v['bytes'] for v in files.values()),
        inverseBinds=inverse_count, poseVersion=result['poseVersion'], weaponFramesBytes=len(binary), manifest=str(OUT / 'manifest.json'))), flush=True)

if __name__ == '__main__': main()
