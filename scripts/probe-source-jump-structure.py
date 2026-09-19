"""Read-only structural inspection of jump_lower (T + CT): blend axes, keys, layers, weights."""
import json, struct, sys
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

out = {}
for label, path in (('t', 'models/player/t_animations.mdl'), ('ct', 'models/player/ct_animations.mdl')):
    raw = cm.find_file(TinyPath(path)).read()
    buffer = MemoryBuffer(raw)
    mdl = MdlV49.from_buffer(buffer)
    seq = mdl.sequences[6]
    assert seq.name == 'jump_lower', seq.name
    with buffer.read_from_offset(seq._entry_offset + 68):
        group_size = list(buffer.read_fmt('2I'))
    weights = seq.get_bone_weights(buffer, len(mdl.bones)) if seq.weight_offset else []
    layers = []
    with buffer.read_from_offset(seq._entry_offset + 148):
        count, offset = buffer.read_fmt('2I')
    assert count == len(seq.auto_layers)
    with buffer.read_from_offset(seq._entry_offset + offset):
        for _ in range(count):
            sid, pid, flags = buffer.read_fmt('<hhI')
            start, peak, tail, end = buffer.read_fmt('<4f')
            layers.append(dict(sequence=sid, sequenceName=mdl.sequences[sid].name if 0 <= sid < len(mdl.sequences) else None,
                               pose=pid, flags=flags, start=start, peak=peak, tail=tail, end=end))
    names = []
    for i in range(mdl.header.local_pose_paramater_count):
        start = mdl.header.local_pose_parameter_offset + i * 20
        with buffer.read_from_offset(start):
            name_offset, flags, low, high, loop = buffer.read_fmt('iifff')
        with buffer.read_from_offset(start + name_offset):
            names.append(buffer.read_ascii_string())
    anims = seq.anim_desc_indices
    info = dict(
        path=path, name=seq.name, index=6, flags=int(seq.flags), frameCount=seq.last_frame if seq.last_frame else None,
        groupSize=group_size, blendCount=int(seq.blend_count),
        parameterIndices=[int(p) for p in seq.param_offset],
        parameterNames=[names[p] if 0 <= p < len(names) else None for p in seq.param_offset],
        poseKeys=list(seq.pose_keys),
        activity=int(seq.activity), activityName=seq.activity_name, activityWeight=int(seq.activity_weight),
        fadeIn=float(seq.fade_in_time), fadeOut=float(seq.fade_out_time),
        animationIndices=[int(a) for a in anims], animationCount=len(anims),
        autoLayers=layers, hasBoneWeights=bool(seq.weight_offset),
        boneWeightNonUnity=[(i, w) for i, w in enumerate(weights) if abs(w - 1) > 1e-6][:24],
        paramStart=[float(v) for v in seq.param_start], paramEnd=[float(v) for v in seq.param_end],
    )
    out[label] = info
    print(f'== {label} jump_lower ==')
    for k, v in info.items():
        print(f'  {k}: {v}')
    # descriptor details for referenced animations
    print(f'  -- referenced descriptors:')
    seen = []
    for a in info['animationIndices']:
        if a in seen: continue
        seen.append(a)
        d = mdl.anim_descs[a]
        print(f'     [{a}] {d.name} fps={d.fps} frames={d.frame_count} flags={int(d.flags)} ikrules={d.ikrule_count} movements={d.movement_count}')

Path('/tmp/source-jump-structure.json').write_text(json.dumps(out, indent=1))
