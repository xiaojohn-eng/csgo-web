"""List every sequence in the original T/CT player animation MDLs so throw/grenade
sequences can be picked by name (mount pattern from export-source-death-sequences.py)."""
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

for team, rel in {'t': 'models/player/t_animations.mdl', 'ct': 'models/player/ct_animations.mdl'}.items():
    cm = ContentManager(); cm.clean()
    provider = VPKContentProvider(TinyPath(str(ROOT / '.reference-assets/csgo-legacy/csgo/pak01_dir.vpk')), SteamAppId.COUNTER_STRIKE_GO)
    cm.add_child(provider); cm.priority_list = [provider]
    raw = cm.find_file(TinyPath(rel)); assert raw is not None
    mdl = MdlV49.from_buffer(MemoryBuffer(raw.read()))
    print(f'=== {team} {rel}: {len(mdl.sequences)} sequences ===')
    for i, seq in enumerate(mdl.sequences):
        print(i, seq.name)
