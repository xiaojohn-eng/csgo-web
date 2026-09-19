"""Read-only enumeration of player animation sequences (T + CT), filtering jump/air/land candidates."""
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

KEYS = ('jump', 'air', 'land', 'fall', 'balanc')
out = {}
for label, path in (('t', 'models/player/t_animations.mdl'), ('ct', 'models/player/ct_animations.mdl')):
    raw = cm.find_file(TinyPath(path)); assert raw is not None
    mdl = MdlV49.from_buffer(raw)
    seqs = [(s.name, i, int(s.flags), [a for a in (getattr(s, 'activity_name', '') or '')]) for i, s in enumerate(mdl.sequences)]
    hits = [dict(index=i, name=n, flags=f) for n, i, f, _ in seqs if any(k in n.lower() for k in KEYS)]
    out[label] = dict(path=path, total=len(seqs), hits=hits)
    print(f'== {label} {path}: {len(seqs)} sequences')
    for h in hits:
        print(f"  [{h['index']:4d}] {h['name']}  flags={h['flags']}")
(Path('/tmp/source-jump-sequences.json')).write_text(json.dumps(out, indent=1))
