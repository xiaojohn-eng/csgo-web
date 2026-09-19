"""Structural probe for the original GREN (grenade) sequences: fps/frames/flags/
IK rules/movement/sections/autoLayers/boneWeights — verifies they survive the
FRAMEANIM decode chain used for jump/death before committing to a merge."""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools'))

from SourceIO.library.models.mdl.v49 import MdlV49
from SourceIO.library.shared.app_id import SteamAppId
from SourceIO.library.shared.content_manager import ContentManager
from SourceIO.library.shared.content_manager.providers.vpk_provider import VPKContentProvider
from SourceIO.library.utils import TinyPath, MemoryBuffer

TEAMS = {'t': 'models/player/t_animations.mdl', 'ct': 'models/player/ct_animations.mdl'}
PICK = [816, 831, 834, 933, 824, 819, 821, 826]  # Idle_Aim_GREN, Idle_Shoot_GREN1/2, Idle_Shoot_GREN3, Idle_Upper_GREN, Idle_HandPos_GREN

for team, rel in TEAMS.items():
    cm = ContentManager(); cm.clean()
    provider = VPKContentProvider(TinyPath(str(ROOT / '.reference-assets/csgo-legacy/csgo/pak01_dir.vpk')), SteamAppId.COUNTER_STRIKE_GO)
    cm.add_child(provider); cm.priority_list = [provider]
    raw = cm.find_file(TinyPath(rel)); assert raw is not None
    buffer = MemoryBuffer(raw.read())
    mdl = MdlV49.from_buffer(buffer)
    print(f'=== {team} ===')
    for idx in PICK:
        seq = mdl.sequences[idx]
        anims = [int(a) for a in seq.anim_desc_indices]
        group = None
        try:
            with buffer.read_from_offset(seq._entry_offset + 68):
                group = list(buffer.read_fmt('2I'))
        except Exception as e:
            group = f'ERR {e}'
        print(f'{idx} {seq.name}: animDescs={anims} groupSize={group} '
              f'activity={int(seq.activity)} fade={seq.fade_in_time}/{seq.fade_out_time} '
              f'poseKeys={list(seq.pose_keys)[:6]}')
        for a in anims[:3]:
            desc = mdl.anim_descs[a]
            print(f'   desc{a}: {desc.name} fps={desc.fps} frames={desc.frame_count} '
                  f'flags={int(desc.flags)} ikrules={desc.ikrule_count} mov={desc.movement_count} '
                  f'hier={desc.local_hierarchy_count} sections={len(desc.get_sections(buffer))}')
