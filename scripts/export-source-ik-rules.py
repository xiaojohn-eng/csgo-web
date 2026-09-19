"""Export the original IK chains and per-animation IK rules of the CS:GO player
animation models (and of the world weapon models that carry any).

Why this exists
---------------
The player animations are not hand-authored straight to the weapon: the model
declares four IK chains (`rhand`, `lhand`, `rfoot`, `lfoot`) and every animation
carries IK rules that decide, per cycle window, when a chain is planted on the
ground, released, or moved by its own baked error pose. Those rules live in the
`.ani` animblock, not in the `.mdl`, and are not part of the pose frames we had
already exported, so nothing in the renderer could see them.

What is exported
----------------
* `chains[]`: name, link type and the exact bone chain of every `mstudioikchain_t`.
* `rules` per animation descriptor *name*: type, chain, slot, window
  (start/peak/tail/end), the original `height`/`radius`/`floor`/`contact` numbers,
  the local `pos`/`q` and the world attachment name when there is one.
* Receipts: byte length and SHA256 of the `.mdl` and the `.ani` this came from,
  plus the byte offset the rules were read at, so the numbers can be re-derived.

The record layout is `mstudioikrule_t` from the public Source SDK 2013
`studio.h` (152 bytes). It is not assumed: every rule must carry its own
sequential `index`, and a descriptor's `compressedikerrorindex` must point past
its own rule block (rules * 152) whenever it is non-zero, which is a
self-referential check the file itself supplies.

Run: Blender --background --factory-startup --python-exit-code 1 \
       --python scripts/export-source-ik-rules.py
"""
from __future__ import annotations
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools'))
from SourceIO.library.shared.app_id import SteamAppId  # noqa: E402
from SourceIO.library.shared.content_manager import ContentManager  # noqa: E402
from SourceIO.library.shared.content_manager.providers.loose_files import LooseFilesContentProvider  # noqa: E402
from SourceIO.library.shared.content_manager.providers.vpk_provider import VPKContentProvider  # noqa: E402
from SourceIO.library.utils import TinyPath  # noqa: E402
from SourceIO.library.models.mdl.v49 import MdlV49  # noqa: E402
from SourceIO.library.models.mdl.load_animations import _resolve_ani_file, _get_block_table  # noqa: E402

GAME = ROOT / '.reference-assets/csgo-legacy/csgo'
OUT = ROOT / 'research/source-ik-rules.json'
RECORD_BYTES = 152
RULE_TYPES = {1: 'SELF', 2: 'WORLD', 3: 'GROUND', 4: 'RELEASE', 5: 'ATTACHMENT', 6: 'UNLATCH'}
MODELS = ('models/player/t_animations.mdl', 'models/player/ct_animations.mdl',
          'models/weapons/w_rif_ak47.mdl', 'models/weapons/w_rif_m4a1.mdl')
sha = lambda b: hashlib.sha256(b).hexdigest()

cm = ContentManager(); cm.clean()
providers = [LooseFilesContentProvider(TinyPath(str(GAME)), SteamAppId.COUNTER_STRIKE_GO),
             VPKContentProvider(TinyPath(str(GAME / 'pak01_dir.vpk')), SteamAppId.COUNTER_STRIKE_GO)]
for provider in providers:
    cm.add_child(provider)
cm.priority_list = providers[:]

receipts: dict[str, dict] = {}


def find(path: str):
    buffer = cm.find_file(TinyPath(path))
    if buffer is None:
        return None
    if path not in receipts:
        position = buffer.tell(); buffer.seek(0); raw = buffer.read(); buffer.seek(position)
        receipts[path] = {'bytes': len(raw), 'sha256': sha(raw)}
    return buffer


def cstring(buffer, offset: int) -> str:
    with buffer.read_from_offset(offset):
        return buffer.read_ascii_string()


def read_chain(mdl, buffer, index: int) -> dict:
    base = mdl.header.ik_chain_offset + index * 16
    with buffer.read_from_offset(base):
        name_index, link_type, num_links, link_index = buffer.read_fmt('4i')
    name = cstring(buffer, base + name_index) if name_index else ''
    links = []
    with buffer.read_from_offset(base + link_index):
        for _ in range(num_links):
            bone, kx, ky, kz, ux, uy, uz = buffer.read_fmt('i6f')
            assert 0 <= bone < len(mdl.bones), 'IK chain link outside the bone table'
            links.append({'bone': bone, 'name': mdl.bones[bone].name, 'kneeDir': [kx, ky, kz]})
    return {'index': index, 'name': name, 'linkType': link_type, 'links': links}


def read_rule(mdl, buffer, base: int, i: int, count: int) -> dict:
    with buffer.read_from_offset(base + i * RECORD_BYTES):
        index, type_, chain, bone, slot = buffer.read_fmt('5i')
        height, radius, floor = buffer.read_fmt('3f')
        pos = buffer.read_fmt('3f'); q = buffer.read_fmt('4f')
        compressed, _unused2, _i_start, _ik_error = buffer.read_fmt('4i')
        start, peak, tail, end = buffer.read_fmt('4f')
        _unused3, contact, drop, top = buffer.read_fmt('4f')
        buffer.read_fmt('3i')
        attachment_index = buffer.read_uint32()
        buffer.read_fmt('7i')
        after = buffer.tell()
    attachment = cstring(buffer, after + attachment_index) if attachment_index else ''
    assert index in (0, i), f'IK rule index field {index} is neither its position {i} nor the unset 0'
    assert type_ in RULE_TYPES, f'Unknown IK rule type {type_}'
    assert chain >= 0, 'IK rule without a chain'
    assert 0 <= bone < len(mdl.bones), 'IK rule bone outside the bone table'
    assert start <= peak <= tail <= end, f'IK rule window is not monotonic: {start},{peak},{tail},{end}'
    assert compressed == 0 or 0 < compressed < 1 << 24, f'Implausible compressed IK error offset {compressed}'
    rule = {'index': i, 'type': RULE_TYPES[type_], 'chain': chain, 'slot': slot, 'bone': bone,
            'window': {'start': start, 'peak': peak, 'tail': tail, 'end': end},
            'pos': list(pos), 'q': list(q), 'compressedIkError': compressed,
            'height': height, 'radius': radius, 'floor': floor,
            'contact': contact, 'drop': drop, 'top': top}
    if attachment:
        rule['attachment'] = attachment
    return rule


def export(path: str) -> dict:
    buffer = find(path)
    assert buffer is not None, f'Missing original {path}'
    mdl = MdlV49.from_buffer(buffer)
    ani = _resolve_ani_file(mdl, cm, TinyPath(path))
    blocks = _get_block_table(mdl, buffer)
    chains = [read_chain(mdl, buffer, i) for i in range(mdl.header.ik_chain_count)]
    rules: dict[str, list] = {}
    kinds: dict[str, int] = {}
    strides: set[int] = set()
    for desc in mdl.anim_descs:
        if not desc.ikrule_count:
            continue
        if desc.ikrule_offset:
            source, base = buffer, desc._entry_offset + desc.ikrule_offset
        else:
            assert ani is not None and 0 <= desc.animblock_id < len(blocks), 'IK rules have no readable home'
            source, base = ani.buffer, blocks[desc.animblock_id].data_offset + desc.animblock_ikrule_offset
        assert desc.name not in rules, f'Duplicate animation descriptor name {desc.name}'
        rules[desc.name] = [read_rule(mdl, source, base, i, desc.ikrule_count) for i in range(desc.ikrule_count)]
        for rule in rules[desc.name]:
            kinds[rule['type']] = kinds.get(rule['type'], 0) + 1
        strides.add(desc.ikrule_count * RECORD_BYTES)
    return {'version': mdl.header.version, 'bones': len(mdl.bones), 'animations': len(mdl.anim_descs),
            'ikChains': chains, 'ruleCounts': kinds, 'rules': rules, 'blockStrides': sorted(strides)}


result = {'format': 'source-ik-rules-v1', 'sourceApp': 740, 'build': 12426148, 'recordBytes': RECORD_BYTES,
          'ruleTypes': RULE_TYPES, 'models': {}}
for model in MODELS:
    result['models'][model] = export(model)
result['receipts'] = receipts

for model, data in result['models'].items():
    assert len(data['ikChains']) == 4, f'{model} must declare the four original IK chains'
    assert [c['name'] for c in data['ikChains']] == ['rhand', 'lhand', 'rfoot', 'lfoot'], model
    print(model, 'chains', [(c['name'], [l['name'].split('.')[-1] for l in c['links']]) for c in data['ikChains']])
    print('   animations', data['animations'], 'with rules', len(data['rules']),
          'rules', sum(len(v) for v in data['rules'].values()), 'kinds', data['ruleCounts'])
    attached = [r for v in data['rules'].values() for r in v if r.get('attachment')]
    print('   attachment rules', len(attached), sorted({r['attachment'] for r in attached})[:6])

OUT.parent.mkdir(parents=True, exist_ok=True)
payload = json.dumps(result, separators=(',', ':')) + '\n'
OUT.write_text(payload)
print(f'wrote {OUT} ({len(payload)} bytes) sha256 {sha(payload.encode())}')
