"""Read-only enumeration of player animation sequences (T + CT), filtering death candidates."""
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools'))
from SourceIO.library.models.mdl.v49 import MdlV49
from SourceIO.library.shared.app_id import SteamAppId
from SourceIO.library.shared.content_manager import ContentManager
from SourceIO.library.shared.content_manager.providers.vpk_provider import VPKContentProvider
from SourceIO.library.utils import TinyPath

cm = ContentManager(); cm.clean()
provider = VPKContentProvider(TinyPath(str(ROOT / '.reference-assets/csgo-legacy/csgo/pak01_dir.vpk')), SteamAppId.COUNTER_STRIKE_GO)
cm.add_child(provider); cm.priority_list = [provider]

KEYS = ('die', 'death', 'ragdoll', 'dead', 'flinch', 'headshot')
out = {}
for label, path in (('t', 'models/player/t_animations.mdl'), ('ct', 'models/player/ct_animations.mdl')):
    raw = cm.find_file(TinyPath(path)); assert raw is not None
    mdl = MdlV49.from_buffer(raw)
    hits = []
    for i, s in enumerate(mdl.sequences):
        n = s.name.lower()
        if any(k in n for k in KEYS):
            hits.append(dict(
                index=i, name=s.name, flags=int(s.flags),
                activity=getattr(s, 'activity_name', '') or '',
                fps=getattr(s, 'fps', 0) or 0,
                frames=int(getattr(s, 'frame_count', 0) or 0),
                groupSize=[int(x) for x in (getattr(s, 'group_size', None) or [])] if hasattr(s, 'group_size') else None,
                fadeIn=float(getattr(s, 'fade_in_time', 0) or 0),
                fadeOut=float(getattr(s, 'fade_out_time', 0) or 0),
            ))
    out[label] = dict(path=path, total=len(mdl.sequences), hits=hits)
    print(f'== {label} {path}: {len(mdl.sequences)} sequences')
    for h in hits:
        print(f"  [{h['index']:4d}] {h['name']:28s} flags={h['flags']:3d} fps={h['fps']} frames={h['frames']} act={h['activity']} fadeIn={h['fadeIn']} fadeOut={h['fadeOut']}")
Path('/tmp/source-death-sequences.json').write_text(json.dumps(out, indent=1))
