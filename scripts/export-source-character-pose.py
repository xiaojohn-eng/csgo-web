"""Private continuous pose data, preserving the audited decoded float64 frames.
Run in bundled Blender --background --factory-startup; no addon registration.
"""
from pathlib import Path
import gzip
import hashlib
import importlib.util
import json
import struct
import subprocess
import sys
from types import SimpleNamespace

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / '.reference-assets/source-exports/character-t'
OUT = BASE / 'continuous'
SOURCEIO = ROOT / '.tools/SourceIO'
COMMIT = 'cfc2591d096628a35f570aa830ab75cc8665108b'
sha = lambda data: hashlib.sha256(data).hexdigest()

def main():
    assert bpy.app.background and '--factory-startup' in sys.argv
    assert subprocess.check_output(['git', '-C', str(SOURCEIO), 'rev-parse', 'HEAD'], text=True).strip() == COMMIT
    sys.path.insert(0, str(SOURCEIO.parent))
    from SourceIO.library.shared.app_id import SteamAppId
    from SourceIO.library.shared.content_manager.providers.vpk_provider import VPKContentProvider
    from SourceIO.library.utils import TinyPath, MemoryBuffer
    from SourceIO.library.models.mdl.structs.header import MdlHeaderV49
    from SourceIO.library.models.mdl.structs.bone import Bone
    provider = VPKContentProvider(TinyPath(ROOT / '.reference-assets/csgo-legacy/csgo/pak01_dir.vpk'), SteamAppId.COUNTER_STRIKE_GO)
    dependencies = {}; models = {}
    C = np.array([[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]], dtype=np.float64)
    def cstring(raw, at):
        assert 0 <= at < len(raw); return raw[at:raw.index(0, at)].decode('utf8')
    for path in ('models/player/tm_leet_varianta.mdl', 'models/player/t_animations.mdl'):
        found = provider.find_file(TinyPath(path)); assert found is not None
        raw = found.read(); dependencies[path] = dict(bytes=len(raw), sha256=sha(raw))
        buffer = MemoryBuffer(raw); header = MdlHeaderV49.from_buffer(buffer); assert header.version == 49
        buffer.seek(header.bone_offset); bones = []
        for i in range(header.bone_count):
            start = buffer.tell(); b = Bone.from_buffer(buffer, header.version)
            inverse = np.eye(4); inverse[:3] = b.pose_to_bone.T
            bones.append(dict(name=b.name, parent=b.parent_id, position=list(b.position), quaternion=list(b.quat), flags=int(b.flags),
                alignment=list(b.q_alignment), inverseBindSource=inverse.T.reshape(-1).tolist(),
                inverseBindGltf=(inverse @ C.T).T.reshape(-1).tolist(), sourceByteOffset=start))
        sets = []
        for i in range(header.hitbox_set_count):
            base = header.hitbox_set_offset + i * 12; name, count, offset = struct.unpack_from('<3i', raw, base)
            assert 0 <= count < 1000 and 0 <= base + offset <= len(raw) - count * 68
            boxes = []
            for j in range(count):
                at = base + offset + j * 68
                bone, group, *values = struct.unpack_from('<2i6fi', raw, at)
                low, high, name_offset = values[:3], values[3:6], values[6]
                assert 0 <= bone < len(bones) and all(np.isfinite(low + high))
                boxes.append(dict(index=j, bone=bone, boneName=bones[bone]['name'], group=group, min=low, max=high,
                    name=cstring(raw, at + name_offset) if name_offset else '', sourceByteOffset=at, sourceBytesHex=raw[at:at + 68].hex(),
                    extensionBytesHex=raw[at + 36:at + 68].hex(), extensionUint32=list(struct.unpack_from('<8I', raw, at + 36)),
                    extensionFloat32=list(struct.unpack_from('<8f', raw, at + 36)),
                    extensionMeaning='SDK2013 names unused[8]; CSGO radius/orientation semantics not independently verified'))
            sets.append(dict(index=i, name=cstring(raw, base + name), hitboxes=boxes, sourceByteOffset=base))
        models[path] = dict(bones=bones, hitboxSets=sets, eyePositionOriginal=list(header.eye_position))

    metadata_path = BASE / 'combat/source-animation-metadata.json'; frames_path = BASE / 'combat/decoded-frames.npz'
    metadata = json.loads(metadata_path.read_text()); main = models['models/player/tm_leet_varianta.mdl']; anim = models[metadata['sourceModel']]
    assert metadata['boneNames'] == [b['name'] for b in anim['bones']]
    anim_names = {b['name']: i for i, b in enumerate(anim['bones'])}; mapping = []
    for b in main['bones']:
        index = anim_names.get(b['name'], -1); mapping.append(index)
        if index >= 0:
            a = anim['bones'][index]
            assert (main['bones'][b['parent']]['name'] if b['parent'] >= 0 else None) == (anim['bones'][a['parent']]['name'] if a['parent'] >= 0 else None)
    assert sum(i >= 0 for i in mapping) == 69

    payload = []; byte_offset = 0; descriptors = []; array_checks = []; root_ranges = []
    with np.load(frames_path) as frames:
        for d in metadata['descriptors']:
            record = dict(d)
            for key, width in [('positions', 3), ('quaternions', 4)]:
                values = np.asarray(frames[f'anim_{d["index"]}_{key}'], dtype='<f8')
                assert values.shape == (d['frames'], len(anim['bones']), width) and np.isfinite(values).all()
                raw = values.tobytes(order='C'); payload.append(raw)
                record[key + 'Offset'] = byte_offset // 8; record[key + 'Count'] = values.size; byte_offset += len(raw)
                reread = np.frombuffer(raw, dtype='<f8').reshape(values.shape)
                assert np.array_equal(values, reread)
                array_checks.append(dict(animation=d['index'], field=key, values=values.size, sha256=sha(raw)))
                if key == 'positions':
                    for i, bone in enumerate(anim['bones']):
                        if bone['parent'] < 0: root_ranges.append(dict(animation=d['index'], name=d['name'], bone=bone['name'],
                            min=values[:, i].min(axis=0).tolist(), max=values[:, i].max(axis=0).tolist()))
            descriptors.append(record)
    binary = b''.join(payload); assert len(binary) == byte_offset
    glb_path = BASE / 'tm_leet_varianta-source-unit.glb'; glb = glb_path.read_bytes(); json_size = struct.unpack_from('<I', glb, 12)[0]
    doc = json.loads(glb[20:20 + json_size]); bin_offset = 28 + json_size; assert len(doc['skins']) == 1
    skin = doc['skins'][0]; assert len(skin['joints']) == len(main['bones']) == 71
    main_names = {b['name']: i for i, b in enumerate(main['bones'])}; render = []
    accessor = doc['accessors'][skin['inverseBindMatrices']]; view = doc['bufferViews'][accessor['bufferView']]
    for slot, node in enumerate(skin['joints']):
        name = doc['nodes'][node]['name']; i = main_names[name]; b = main['bones'][i]
        at = bin_offset + view.get('byteOffset', 0) + accessor.get('byteOffset', 0) + slot * view.get('byteStride', 64)
        actual = list(struct.unpack_from('<16f', glb, at)); assert actual == b['inverseBindGltf']
        render.append(dict(mainBone=i, sourceName=name, gltfNode=node, gltfName=name, skinJoint=slot))
    names = {s['name']: s['index'] for s in metadata['sequences']}
    states = {state: dict(lower=names[lower], upper=names[state + '_Upper_AK'], shoot=names[state + '_Shoot_AK']) for state, lower in
        [('Idle', 'Idle_lower'), ('Walk', 'walk_lower'), ('Run', 'Run_lower'), ('Crouch_Idle', 'Crouch_Idle_Lower'), ('Crouch_Walk', 'Crouch_walk_lower')]}
    result = dict(format='source-character-pose-v1', sourceioCommit=COMMIT, dependencies=dependencies,
        mainModel='models/player/tm_leet_varianta.mdl', animationModel=metadata['sourceModel'], mainBones=main['bones'], animationBones=anim['bones'],
        mainToAnimation=mapping, renderJoints=render, renderGlb=dict(file=glb_path.name, sha256=sha(glb)),
        poseParameters=metadata['poseParameters'], sequences=metadata['sequences'], descriptors=descriptors, states=states,
        frames=dict(file='frames.f64.bin', encoding='float64-little-endian', byteLength=len(binary), sha256=sha(binary)),
        hitboxSets=main['hitboxSets'], eyePositionOriginal=main['eyePositionOriginal'],
        rootMotionPolicy='Preserve encoded root local transforms; movement records/IK/client motion extraction are not applied. Entity movement remains external.',
        viewAndHullPolicy='MDL eyePosition is not the player camera contract. App740 standing/crouching view64/46 and hull72/54 remain a separate verified movement contract.',
        inverseBindPolicy='Source-world matrices retained; glTF IBM = source inverse bind * inverse(C). Rendering root locals must premultiply C; descendants retain Source joint basis.',
        defaultBlendMode='sdk-3way', defaultEvidence='../combat/anim-3wayblend-default.json')
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'frames.f64.bin').write_bytes(binary)
    (OUT / 'frames.f64.bin.gz').write_bytes(gzip.compress(binary, mtime=0))
    raw = (json.dumps(result, separators=(',', ':'), allow_nan=False) + '\n').encode(); (OUT / 'pose-data.json').write_bytes(raw)
    report = dict(status='exported-exact-decoded-values', mainBones=71, animationBones=71, sharedBones=69, descriptors=len(descriptors),
        frames=sum(d['frames'] for d in descriptors), binaryBytes=len(binary), binarySha256=sha(binary), jsonBytes=len(raw), jsonSha256=sha(raw),
        gzipBytes=(OUT / 'frames.f64.bin.gz').stat().st_size, sourceNpzSha256=sha(frames_path.read_bytes()),
        sourceMetadataSha256=sha(metadata_path.read_bytes()), hitboxSets=len(main['hitboxSets']), hitboxes=sum(len(s['hitboxes']) for s in main['hitboxSets']),
        exactGltfInverseBindMatrices=len(render), arrays=array_checks, sourceRootPositionRanges=root_ranges,
        boundary='Data export only; no motion extraction/IK or CSGO client-state equivalence; hitbox extension semantics unresolved; no user preference/addon/game files modified')
    (OUT / 'manifest.json').write_text(json.dumps(report, indent=2) + '\n')
    # Independently reuse the already audited Python implementation, without
    # changing it. These interior grid probes supplement its 40 stored worlds.
    sampler_path = ROOT / 'scripts/source-character-animation.py'
    spec = importlib.util.spec_from_file_location('source_pose_reference', sampler_path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    sampler_mdl = SimpleNamespace(bones=[SimpleNamespace(position=b['position'], quat=b['quaternion'],
        flags=b['flags'], q_alignment=b['alignment']) for b in anim['bones']])
    with np.load(frames_path) as values:
        decoded = {d['index']: (values[f'anim_{d["index"]}_positions'], values[f'anim_{d["index"]}_quaternions']) for d in descriptors}
        sampler = module.PoseSampler(sampler_mdl, metadata, decoded); samples = []
        for state, sequences in states.items():
            for n, (x, y) in enumerate([(.23, .61), (-.27, .72), (.34, -.47), (-.53, -.19)]):
                params = dict(move_x=x, move_y=y, body_yaw=17 + n * -13, body_pitch=-21 + n * 17)
                cycle = [-.17, .137, .633, 1.137][n]; upper = cycle + .013; fire = .12 + n * .193; weight = n * .29
                for mode in ('sdk-3way', 'sdk-bilinear'):
                    value = sampler.accumulate(sampler.rest, sampler.indexed[sequences['lower']], cycle, 1, params, mode)
                    value = sampler.accumulate(value, sampler.indexed[sequences['upper']], upper, 1, params, mode)
                    value = sampler.accumulate(value, sampler.indexed[sequences['shoot']], fire, weight, params, mode)
                    samples.append(dict(input=dict(state=state, parameters=params, cycle=cycle, upperCycle=upper,
                        fireCycle=fire, fireWeight=weight, blendMode=mode), positions=value[0].reshape(-1).tolist(), quaternions=value[1].reshape(-1).tolist()))
    fixtures = dict(referenceScript=sampler_path.name, referenceScriptSha256=sha(sampler_path.read_bytes()), sourceNpzSha256=report['sourceNpzSha256'],
        description='Independent Python interior-quadrant and separate layer-clock conformance; not actual CSGO client captures.', samples=samples)
    (OUT / 'interior-pose-fixtures.json').write_text(json.dumps(fixtures, separators=(',', ':')) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k not in ('arrays', 'sourceRootPositionRanges')}), flush=True)

if __name__ == '__main__': main()
