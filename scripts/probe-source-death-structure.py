"""Read-only structural inspection of death sequences (T + CT): indices, layers, weights, frames."""
import json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools'))
from SourceIO.library.models.mdl.v49 import MdlV49
from SourceIO.library.shared.app_id import SteamAppId
from SourceIO.library.shared.content_manager import ContentManager
from SourceIO.library.shared.content_manager.providers.vpk_provider import VPKContentProvider
from SourceIO.library.utils import TinyPath, MemoryBuffer

cm = ContentManager(); cm.clean()
provider = VPKContentProvider(TinyPath(str(ROOT / '.reference-assets/csgo-legacy/csgo/pak01_dir.vpk')), SteamAppId.COUNTER_STRIKE_GO)
cm.add_child(provider); cm.priority_list = [provider]

DEATH_INDICES = list(range(922, 931))  # Death1 + deathpose_* (8)
out = {}
for label, path in (('t', 'models/player/t_animations.mdl'), ('ct', 'models/player/ct_animations.mdl')):
    raw = cm.find_file(TinyPath(path)).read()
    buffer = MemoryBuffer(raw)
    mdl = MdlV49.from_buffer(buffer)
    names = []
    for i in range(mdl.header.local_pose_paramater_count):
        start = mdl.header.local_pose_parameter_offset + i * 20
        with buffer.read_from_offset(start):
            name_offset, flags, low, high, loop = buffer.read_fmt('iifff')
        with buffer.read_from_offset(start + name_offset):
            names.append(buffer.read_ascii_string())
    records = []
    for idx in DEATH_INDICES:
        seq = mdl.sequences[idx]
        with buffer.read_from_offset(seq._entry_offset + 68):
            group_size = list(buffer.read_fmt('2I'))
        weights = seq.get_bone_weights(buffer, len(mdl.bones)) if seq.weight_offset else []
        layers = []
        with buffer.read_from_offset(seq._entry_offset + 148):
            count, offset = buffer.read_fmt('2I')
        if count:
            with buffer.read_from_offset(seq._entry_offset + offset):
                for _ in range(count):
                    sid, pid, flags = buffer.read_fmt('hhI')
                    start, peak, tail, end = buffer.read_fmt('4f')
                    layers.append(dict(sequence=sid,
                        sequenceName=mdl.sequences[sid].name if 0 <= sid < len(mdl.sequences) else None,
                        pose=pid, flags=flags, start=start, peak=peak, tail=tail, end=end))
        anims = [int(a) for a in seq.anim_desc_indices]
        desc_info = []
        for a in anims:
            d = mdl.anim_descs[a]
            desc_info.append(dict(index=a, name=d.name, fps=d.fps, frames=d.frame_count,
                flags=int(d.flags), delta=bool(int(d.flags) & 4), frameAnim=bool(int(d.flags) & 64),
                ikRules=d.ikrule_count, movements=d.movement_count, localHierarchy=d.local_hierarchy_count))
        records.append(dict(
            index=idx, name=seq.name, flags=int(seq.flags),
            groupSize=group_size, blendCount=int(seq.blend_count),
            parameterIndices=[int(p) for p in seq.param_offset],
            parameterNames=[names[p] if 0 <= p < len(names) else None for p in seq.param_offset],
            poseKeys=list(seq.pose_keys), activityName=seq.activity_name,
            fadeIn=float(seq.fade_in_time), fadeOut=float(seq.fade_out_time),
            animationIndices=anims, descriptors=desc_info, autoLayers=layers,
            hasBoneWeights=bool(seq.weight_offset),
            boneWeightNonUnityCount=sum(1 for w in weights if abs(w - 1) > 1e-6),
            paramStart=[float(v) for v in seq.param_start], paramEnd=[float(v) for v in seq.param_end],
        ))
    out[label] = records
    print(f'== {label} ==')
    for r in records:
        print(f"[{r['index']}] {r['name']} flags={r['flags']} group={r['groupSize']} params={r['parameterNames']} "
              f"animIdx={r['animationIndices']} fps={[d['fps'] for d in r['descriptors']]} frames={[d['frames'] for d in r['descriptors']]} "
              f"delta={[d['delta'] for d in r['descriptors']]} frameAnim={[d['frameAnim'] for d in r['descriptors']]} "
              f"ik={[d['ikRules'] for d in r['descriptors']]} mov={[d['movements'] for d in r['descriptors']]} hier={[d['localHierarchy'] for d in r['descriptors']]} "
              f"layers={[(l['sequenceName'], l['pose'], l['flags']) for l in r['autoLayers']]} weightsNonUnity={r['boneWeightNonUnityCount']}")
Path('/tmp/source-death-structure.json').write_text(json.dumps(out, indent=1))
print('written /tmp/source-death-structure.json')
