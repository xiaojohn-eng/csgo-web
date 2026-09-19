"""Read-only probe: dump the text (keyvalues) section of the player model PHY files.

VPhysics stores ragdoll constraints as a text keyvalues block appended after the
binary solids in the .phy file. This probe locates that block for the T (tm_leet_varianta)
and CT (ctm_idf) player models and prints it verbatim so the ragdoll constraint
format can be confirmed from the original bytes.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools'))

from SourceIO.library.shared.app_id import SteamAppId
from SourceIO.library.shared.content_manager import ContentManager
from SourceIO.library.shared.content_manager.providers.vpk_provider import VPKContentProvider
from SourceIO.library.utils import TinyPath

cm = ContentManager(); cm.clean()
provider = VPKContentProvider(TinyPath(str(ROOT / '.reference-assets/csgo-legacy/csgo/pak01_dir.vpk')), SteamAppId.COUNTER_STRIKE_GO)
cm.add_child(provider); cm.priority_list = [provider]

for label, path in (('t', 'models/player/tm_leet_varianta.phy'), ('ct', 'models/player/ctm_idf.phy')):
    found = cm.find_file(TinyPath(path))
    if found is None:
        print(f'== {label} {path}: NOT FOUND'); continue
    raw = found.read()
    print(f'== {label} {path}: {len(raw)} bytes')
    # phyheader_t: int size, int id, int solidCount, int checksum
    import struct
    size, ident, solid_count, checksum = struct.unpack_from('<4i', raw, 0)
    print(f'   header size={size} ident=0x{ident & 0xffffffff:08x} solids={solid_count} checksum={checksum & 0xffffffff:08x}')
    # Each solid: compactsurfaceheader_t { int totalSize; int vphysicsID("VPHY");
    # short version; short modelType; int surfaceSize; float orthogonalEdges[3]; }
    # followed by surfaceSize bytes of ivp compacted surface data plus a 4-byte
    # trailing word, so the stride between consecutive solid headers is total+4.
    at = size
    for i in range(solid_count):
        total, vphys_id, version, model_type, surface_size = struct.unpack_from('<IIHHI', raw, at)
        assert vphys_id == 0x59485056, f'solid {i} at {at}: unexpected vphysics ID 0x{vphys_id:08x}'
        assert total == 28 + surface_size, f'solid {i}: total {total} != 28 + surface {surface_size}'
        print(f'   solid {i}: at={at} total={total} version=0x{version:04x} modelType={model_type} surfaceSize={surface_size}')
        at += total + 4
    assert at - 4 <= len(raw)
    # Text section starts after the last solid's trailing word; skip NUL/whitespace.
    text_start = at
    while text_start < len(raw) and raw[text_start] in (0, 10, 13, 32):
        text_start += 1
    text = raw[text_start:]
    print(f'   text section: {len(text)} bytes at offset {text_start}')
    try:
        print(text.decode('utf-8'))
    except UnicodeDecodeError:
        print(text.decode('latin-1'))
    print()
