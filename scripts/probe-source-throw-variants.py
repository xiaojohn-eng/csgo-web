"""Probe the original player models for the complete grenade throw action graph.

Dumps every animation sequence of the T model (tm_leet_varianta.mdl), the CT
model (ctm_idf.mdl) and the two shared animation MDLs (t_animations.mdl /
ct_animations.mdl) that back the merged production pose datasets: name, MDL
index, activity, flags (loop/delta), blend group size, pose axes, per-animDesc
frame count/fps, fade times and auto-layer count.

The goal is to find the full original throw graph beyond the already merged
Shoot_GREN1 release variants: pin-pull preparation (throwprep / GREN2-style
hold), underhand light throws (GREN underhand / ThrowLow) and any cut/pin
related sequences. Read-only: writes one audit JSON per model under
.reference-assets/source-exports/character-gren/probe/.
"""
from __future__ import annotations
import hashlib, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools'))
OUT = ROOT / '.reference-assets/source-exports/character-gren/probe'
OUT.mkdir(parents=True, exist_ok=True)
sha = lambda b: hashlib.sha256(b).hexdigest()

from SourceIO.library.models.mdl.v49 import MdlV49
from SourceIO.library.shared.app_id import SteamAppId
from SourceIO.library.shared.content_manager import ContentManager
from SourceIO.library.shared.content_manager.providers.vpk_provider import VPKContentProvider
from SourceIO.library.utils import TinyPath, MemoryBuffer

MODELS = {
    't-character': 'models/player/tm_leet_varianta.mdl',
    'ct-character': 'models/player/ctm_idf.mdl',
    't-animations': 'models/player/t_animations.mdl',
    'ct-animations': 'models/player/ct_animations.mdl',
}
# Sequence name fragments that make up the original grenade throw graph.
KEYWORDS = ('gren', 'throw', 'prep', 'underhand', 'pin', 'pull', 'draw')


def sequence_record(mdl, buffer, seq, index):
    from SourceIO.library.models.mdl.load_animations import _resolve_ani_file, _get_block_table
    anims = [int(a) for a in seq.anim_desc_indices]
    descriptors = []
    for key in anims:
        desc = mdl.anim_descs[key]
        entry = {'index': key, 'name': desc.name, 'fps': desc.fps, 'frames': desc.frame_count,
                 'flags': int(desc.flags), 'delta': bool(int(desc.flags) & 4),
                 'frameAnim': bool(int(desc.flags) & 64)}
        descriptors.append(entry)
    with buffer.read_from_offset(seq._entry_offset + 68):
        group_size = list(buffer.read_fmt('2I'))
    layers = list(seq.auto_layers)
    pose_parameters = []
    for i in range(mdl.header.local_pose_paramater_count):
        start = mdl.header.local_pose_parameter_offset + i * 20
        with buffer.read_from_offset(start):
            name_offset, flags, low, high, loop = buffer.read_fmt('iifff')
        with buffer.read_from_offset(start + name_offset):
            name = buffer.read_ascii_string()
        pose_parameters.append({'index': i, 'name': name, 'flags': int(flags), 'start': low, 'end': high, 'loop': loop})
    return {'index': index, 'name': seq.name, 'activity': int(seq.activity), 'activityName': seq.activity_name,
            'flags': int(seq.flags), 'looping': bool(int(seq.flags) & 1), 'delta': bool(int(seq.flags) & 4),
            'groupSize': group_size, 'blendCount': int(seq.blend_count),
            'parameterIndices': list(seq.param_offset), 'paramStart': [float(v) for v in seq.param_start],
            'paramEnd': [float(v) for v in seq.param_end],
            'fadeIn': float(seq.fade_in_time), 'fadeOut': float(seq.fade_out_time),
            'autoLayerCount': len(layers), 'animCount': len(anims),
            'anims': descriptors,
            'flagsHaveAnimEvents': bool(int(seq.flags) & 0x2000)}


def main():
    cm = ContentManager(); cm.clean()
    provider = VPKContentProvider(TinyPath(str(ROOT / '.reference-assets/csgo-legacy/csgo/pak01_dir.vpk')), SteamAppId.COUNTER_STRIKE_GO)
    cm.add_child(provider); cm.priority_list = [provider]
    from SourceIO.library.models.mdl.load_animations import _resolve_ani_file

    combined = {}
    for key, source in MODELS.items():
        raw = cm.find_file(TinyPath(source)); assert raw is not None, source
        raw_bytes = raw.read()
        buffer = MemoryBuffer(raw_bytes)
        mdl = MdlV49.from_buffer(buffer)
        ani = _resolve_ani_file(mdl, cm, TinyPath(source))
        records = []
        for index, seq in enumerate(mdl.sequences):
            record = sequence_record(mdl, buffer, seq, index)
            records.append(record)
        report = {
            'model': source, 'sha256': sha(raw_bytes), 'bytes': len(raw_bytes),
            'sequenceCount': len(mdl.sequences), 'animDescCount': len(mdl.anim_descs),
            'aniResolved': ani is not None, 'bones': len(mdl.bones),
            'boneNames': [b.name for b in mdl.bones],
            'sequences': records,
        }
        (OUT / f'{key}-sequences.json').write_text(json.dumps(report, indent=1) + '\n')

        # Focused view: every sequence whose name mentions the throw graph
        # keywords, plus a plain name list for grep-style review.
        focused = [r for r in records if any(word in r['name'].lower() for word in KEYWORDS)]
        summary = {
            'model': source, 'sequenceCount': len(mdl.sequences),
            'throwRelated': [{'index': r['index'], 'name': r['name'], 'activityName': r['activityName'],
                              'frames': (r['anims'][0]['frames'] if r['anims'] else 0),
                              'fps': (r['anims'][0]['fps'] if r['anims'] else 0),
                              'looping': r['looping'], 'delta': r['delta'], 'groupSize': r['groupSize'],
                              'animCount': r['animCount'], 'autoLayerCount': r['autoLayerCount'],
                              'fadeIn': r['fadeIn'], 'fadeOut': r['fadeOut']} for r in focused],
            'names': [r['name'] for r in records],
        }
        combined[key] = summary
        print('MODEL', key, source, 'sequences', len(mdl.sequences), 'throwRelated', len(focused))
        for r in focused:
            print(f"  [{r['index']:>4}] {r['name']:<44} act={r['activityName'] or '-'} "
                  f"frames={r['anims'][0]['frames'] if r['anims'] else 0} fps={r['anims'][0]['fps'] if r['anims'] else 0} "
                  f"loop={int(r['looping'])} delta={int(r['delta'])} group={r['groupSize']} anims={r['animCount']} "
                  f"layers={r['autoLayerCount']} fade=({r['fadeIn']:.3f},{r['fadeOut']:.3f})")

    (OUT / 'throw-variant-summary.json').write_text(json.dumps(combined, indent=1) + '\n')
    print('PROBE_DONE')


if __name__ == '__main__':
    main()
