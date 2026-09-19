"""Where a finish's three texture transforms come from - the reading that unblocks the ranges.

The port carried a wrong reading of a paint kit's `pattern_offset_*_start/_end` and
`pattern_rotate_start/_end`: it took the two ends for an animation over the wear, and refused a kit
whose ends differ. They are not an animation. The client fills the `CustomWeapon` object's own
transform slots by **drawing each one from its kit's range with the composition's own random
stream**, and the two constants beside the wear and grunge transforms are the same shape - the
ranges `1.6..1.8`, `0..1`, `0..1`, `0..360` the port already draws from. So:

  * the pattern transform's four numbers are `pattern_scale` (a single float, copied, never drawn)
    and three draws: `RandomFloat(pattern_offset_x_start, pattern_offset_x_end)`,
    `RandomFloat(pattern_offset_y_start, pattern_offset_y_end)` and
    `RandomFloat(pattern_rotate_start, pattern_rotate_end)`;
  * the draw order is the pattern's three, then the wear transform's four (scale, x, y, rotate),
    then the grunge transform's four - eleven draws, which is what the port already performs;
  * every draw is `CUniformRandomStream::RandomFloat`, the class the port implements, whose body
    (read here out of `libvstdlib_client.so`, where it is defined) is `min + value * (max - min)`
    with no swap and no clamp on the interval - so a kit whose range runs backwards, which nine of
    them do, is still a range and not an error.

The scale also carries a factor: the three transform scales are multiplied by the object's own
weapon-size-scale field, unless the kit sets `ignore_weapon_size_scale`, in which case the factor is
1.0. That is why every pattern finish the port lists today ignores it, and why a kit that does not
cannot be offered until the weapon's own size scale is read.

Run: PYTHONPATH=.tools/source-binary-venv/lib/python3.9/site-packages python3\
 scripts/probe-source-paintkit-transform.py
"""
from __future__ import annotations
import hashlib
import importlib.util
import json
import re
import struct
import sys
from pathlib import Path

from elftools.elf.elffile import ELFFile

ROOT = Path(__file__).resolve().parents[1]
INSTALL = ROOT / '.reference-assets/csgo-legacy'
CLIENT64 = INSTALL / 'csgo/bin/linux64/client_client.so'
VSTDLIB64 = INSTALL / 'bin/linux64/libvstdlib_client.so'
OUT = ROOT / 'research/source-paintkit-transform.json'
RANDOM_FLOAT_SYMBOL = '_ZN20CUniformRandomStream11RandomFloatEff'
sha = lambda data: hashlib.sha256(data).hexdigest()  # noqa: E731

# The filler (this + 0x9c4 gets the palette) and the material-block generator (which formats the
# three transforms).
FILLER = 0xF52B90
GENERATOR = 0xF52040
# The stub the filler calls once per drawn number, and the GOT slot its `jmp` reads.
RANDOM_FLOAT_STUB = 0x6A0D00
# The object's transform slots, in the order the generator formats them.
TRANSFORMS = {
    'pattern': {'scale': 0xA08, 'x': 0xA0C, 'y': 0xA10, 'rotate': 0xA14},
    'wear': {'scale': 0xA18, 'x': 0xA1C, 'y': 0xA20, 'rotate': 0xA24},
    'grunge': {'scale': 0xA28, 'x': 0xA2C, 'y': 0xA30, 'rotate': 0xA34},
}


def load(name, path):
    """Import a sibling script by path, so the shared binary reader has one home."""
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def load_segment(path: Path, address: int):
    """The bytes of the loadable segment holding `address`, and the address it starts at."""
    with path.open('rb') as handle:
        elf = ELFFile(handle)
        for segment in elf.iter_segments():
            if segment['p_type'] != 'PT_LOAD':
                continue
            start, size = segment['p_vaddr'], segment['p_filesz']
            if start <= address < start + size:
                handle.seek(segment['p_offset'])
                return handle.read(size), start
    raise SystemExit('probe-source-paintkit-transform: no segment holds ' + hex(address))


def symbol_address(path: Path, name: str) -> int:
    with path.open('rb') as handle:
        for symbol in ELFFile(handle).get_section_by_name('.dynsym').iter_symbols():
            if symbol.name == name and symbol['st_shndx'] != 'SHN_UNDEF':
                return int(symbol['st_value'])
    raise SystemExit('probe-source-paintkit-transform: ' + name + ' is not defined in ' + str(path))


def main():
    from capstone import Cs, CS_ARCH_X86, CS_MODE_64

    binary_index = load('source_binary_index', 'scripts/source-binary-index.py')
    client = binary_index.open_binary(CLIENT64)
    md = Cs(CS_ARCH_X86, CS_MODE_64)

    # --- the filler's transform slots: which record field, or which draw, fills each one.
    assert client.function_of(FILLER) == (FILLER, 0x73F), client.function_of(FILLER)
    binary_index.assert_bytes(client, {
        0xF52DAD: ('f3410f108424ec000000', 'movss xmm0, [r12 + 0xec]  (the pattern scale, copied not drawn)'),
        0xF52DB7: ('f30f1183080a0000', 'movss [rbx + 0xa08], xmm0'),
        0xF52DD9: ('e8', 'the first draw: pattern translate x'),
        0xF52DFD: ('f30f11830c0a0000', 'movss [rbx + 0xa0c], xmm0'),
        0xF52E19: ('e8', 'the second draw: pattern translate y'),
        0xF52E21: ('f30f1183100a0000', 'movss [rbx + 0xa10], xmm0'),
        0xF52E3D: ('e8', 'the third draw: pattern rotate'),
        0xF52E4D: ('f30f1183140a0000', 'movss [rbx + 0xa14], xmm0'),
        0xF52E5D: ('e8', 'the fourth draw: the wear transform\'s scale'),
        0xF52E6D: ('f30f1183180a0000', 'movss [rbx + 0xa18], xmm0'),
        0xF52E89: ('f30f11831c0a0000', 'movss [rbx + 0xa1c], xmm0'),
        0xF52EA5: ('f30f1183200a0000', 'movss [rbx + 0xa20], xmm0'),
        0xF52EC1: ('f30f1183240a0000', 'movss [rbx + 0xa24], xmm0'),
        0xF52EE1: ('f30f1183280a0000', 'movss [rbx + 0xa28], xmm0'),
        0xF52EFD: ('f30f11832c0a0000', 'movss [rbx + 0xa2c], xmm0'),
        0xF52F19: ('f30f1183300a0000', 'movss [rbx + 0xa30], xmm0'),
        0xF52F30: ('f30f1183340a0000', 'movss [rbx + 0xa34], xmm0'),
    })
    # Every call in that region is the random stub, and the arguments are the three pattern ranges
    # followed by the two constant ranges, in the order the generator formats them.
    def constant(address):
        return struct.unpack('<f', client.bytes_at(address, 4))[0]

    drawn = []          # (role, low, high) for each draw, in the order the filler makes them
    literal = []        # the constants, for the record
    pending = {}
    for ins in client.instructions(0xF52DD0, 0x170):
        if ins.mnemonic == 'movss' and '[r12 + 0x' in ins.op_str:
            pending[ins.op_str.split(',')[0]] = ('record', int(ins.op_str.rsplit('0x', 1)[1].rstrip(']'), 16))
        elif ins.mnemonic == 'movss' and 'rip' in ins.op_str:
            address = client.rip_target(ins.address)
            value = constant(address)
            literal.append({'at': hex(ins.address), 'address': hex(address), 'value': value})
            pending[ins.op_str.split(',')[0]] = ('constant', value)
        elif ins.mnemonic == 'pxor' and ins.op_str.startswith('xmm0'):
            pending['xmm0'] = ('constant', 0.0)
        elif ins.mnemonic == 'call':
            # A direct call's target is what the decoder resolved; an indirect one has none.
            if not ins.op_str.startswith('0x'):
                pending = {}
                continue
            if int(ins.op_str, 16) == RANDOM_FLOAT_STUB:
                drawn.append({'at': hex(ins.address), 'low': pending.get('xmm0'),
                              'high': pending.get('xmm1')})
            pending = {}
    assert len(drawn) == 11, len(drawn)
    roles = ['pattern.x', 'pattern.y', 'pattern.rotate',
             'wear.scale', 'wear.x', 'wear.y', 'wear.rotate',
             'grunge.scale', 'grunge.x', 'grunge.y', 'grunge.rotate']
    # The three pattern draws take the kit record's own pairs: +0xf0/+0xf4, +0xf8/+0xfc, +0x100/+0x104.
    assert [entry['low'] for entry in drawn[:3]] == [('record', 0xF0), ('record', 0xF8), ('record', 0x100)], drawn[:3]
    assert [entry['high'] for entry in drawn[:3]] == [('record', 0xF4), ('record', 0xFC), ('record', 0x104)], drawn[:3]
    # The other eight take fixed constants, and they are the ranges the port already draws from:
    # 1.6..1.8 for each transform's scale, 0..1 for its offsets, 0..360 for its rotation. The
    # constants are float32, so they are compared as float32.
    def f32(value):
        return struct.unpack('<f', struct.pack('<f', value))[0]

    assert [(f32(entry['low'][1]), f32(entry['high'][1])) for entry in drawn[3:]] == [
        (f32(1.6), f32(1.8)), (0.0, f32(1.0)), (0.0, f32(1.0)), (0.0, f32(360.0)),
        (f32(1.6), f32(1.8)), (0.0, f32(1.0)), (0.0, f32(1.0)), (0.0, f32(360.0))], drawn[3:]
    # The pattern's scale is the record's own single float, copied rather than drawn: no draw lands
    # in 0xa08, which is the field the generator formats as both scale components.
    assert [entry['at'] for entry in drawn][0] == hex(0xF52DF5), drawn[0]
    for entry, role in zip(drawn, roles):
        entry['role'] = role
        entry['low'] = entry['low'][1]
        entry['high'] = entry['high'][1]

    # --- the scale factor: the three transform scales are multiplied by this + 0x84, unless the
    # kit's own ignore_weapon_size_scale byte (record + 0x118 -> this + 0xc4c) is set.
    binary_index.assert_bytes(client, {
        0xF522CE: ('80bb4c0c000000', 'cmp byte [rbx + 0xc4c], 0'),
        0xF522D5: ('0f8535030000', 'jne 0xf52610  (ignore_weapon_size_scale set)'),
        0xF52610: ('f30f1005d89a9d00', 'movss xmm0, [rip + 0x9d9ad8]  (1.0)'),
        0xF522DB: ('f30f108384000000', 'movss xmm0, [rbx + 0x84]  (the weapon size scale)'),
        0xF52331: ('f30f59', 'mulss xmm0, [rbx + 0xa08]  (the pattern scale)'),
    })
    binary_index.assert_bytes(client, {
        0xF52DBF: ('410fb68424180100', 'movzx eax, byte [r12 + 0x118]'),
        0xF52DC8: ('88834c0c0000', 'mov byte [rbx + 0xc4c], al'),
        0xF533A8: ('f30f118380000000', 'movss [rbx + 0x80], xmm0'),
        0xF533B7: ('f30f118384000000', 'movss [rbx + 0x84], xmm0'),
    })

    # --- the stub is CUniformRandomStream::RandomFloat, and the class's own body is the formula.
    slot = client.rip_target(RANDOM_FLOAT_STUB)
    with CLIENT64.open('rb') as handle:
        elf = ELFFile(handle)
        rela = elf.get_section_by_name('.rela.plt')
        dynsym = elf.get_section_by_name('.dynsym')
        imported = {relocation['r_offset']:
                    dynsym.get_symbol(relocation['r_info_sym']).name
                    for relocation in rela.iter_relocations()}
    assert imported.get(slot) == RANDOM_FLOAT_SYMBOL, (hex(slot), imported.get(slot))
    definition = symbol_address(VSTDLIB64, RANDOM_FLOAT_SYMBOL)
    segment, base = load_segment(VSTDLIB64, definition)
    code = segment[definition - base: definition - base + 0x70]
    body = [(ins.mnemonic, ins.op_str) for ins in md.disasm(code, definition)]
    ops = [mnemonic for mnemonic, _ in body]
    # The formula, in the client's own order: subtract, multiply, add - with no compare and swap of
    # the interval, and one `call` for the draw itself.
    assert ops[:6] == ['push', 'mov', 'sub', 'movss', 'movss', 'call'], body[:6]
    tail = [ins for ins in body if ins[0] in ('subss', 'mulss', 'addss')]
    assert [mnemonic for mnemonic, _ in tail] == ['subss', 'mulss', 'addss'], tail
    assert tail[0][1] == 'xmm1, xmm0' and tail[1][1] == 'xmm2, xmm1' and tail[2][1] == 'xmm0, xmm2', tail
    # The one range guard the class does have is on the *value*, not on the interval: a value above
    # 0.99999988 is clamped, which the port does too.
    assert 'comisd' in ops and 'minss' not in ops and 'maxss' not in ops, ops

    report = {
        'format': 'source-paintkit-transform-v1',
        'sources': {'client64Sha256': sha(CLIENT64.read_bytes()),
                    'vstdlib64Sha256': sha(VSTDLIB64.read_bytes()),
                    'randomFloatSymbol': RANDOM_FLOAT_SYMBOL,
                    'randomFloatDefinition': hex(definition),
                    'randomFloatStub': hex(RANDOM_FLOAT_STUB),
                    'randomFloatGotSlot': hex(slot)},
        'filler': {'at': hex(FILLER), 'callers': [hex(c) for c in client.callers(FILLER)],
                   'generator': hex(GENERATOR)},
        'slots': {name: {key: hex(value) for key, value in slots.items()}
                  for name, slots in TRANSFORMS.items()},
        'draws': {'count': len(drawn), 'order': [entry['role'] for entry in drawn],
                  'pattern': {'pairs': {'x': ['record +0xf0', 'record +0xf4'],
                                        'y': ['record +0xf8', 'record +0xfc'],
                                        'rotate': ['record +0x100', 'record +0x104']},
                              'scaleFromRecord': 'record +0xec (copied, never drawn)',
                              'reading': 'Three draws in the order x, y, rotate, each from the kit '
                                         'record\'s own start/end pair; the scale is a single float.'},
                  'wearGrunge': {'ranges': [[entry['low'], entry['high']] for entry in drawn[3:]],
                                 'reading': 'The same two-argument draw over fixed constants: '
                                            '1.6..1.8 for each scale, 0..1 for each offset, '
                                            '0..360 for each rotation, which is what the port '
                                            'already draws.'},
                  'literals': literal},
        'scaleFactor': {'field': 'this + 0x84', 'flag': 'this + 0xc4c (kit record + 0x118)',
                        'whenSet': 1.0,
                        'reading': 'The three transform scales are multiplied by the weapon\'s own '
                                   'size scale, or by 1.0 when the kit sets '
                                   'ignore_weapon_size_scale. A kit that does not set it needs the '
                                   'weapon size scale, which the port has not read.'},
        'randomFloat': {'body': [f'{mnemonic} {op}' for mnemonic, op in body],
                        'reading': 'min + value * (max - min) in float32, one draw, no swap and no '
                                   'clamp on the interval - so a reversed range is still a range.'},
        'boundary': 'What is read is which kit fields the three transforms are drawn from, the '
                    'order, the class that draws them and its formula, and the scale factor\'s '
                    'condition. What is not read is the weapon\'s own size scale, so a pattern '
                    'finish whose kit does not ignore it is not composed.',
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n')
    print('PAINTKIT_TRANSFORM ' + json.dumps({
        'draws': report['draws']['count'],
        'order': report['draws']['order'],
        'patternPairs': report['draws']['pattern']['pairs'],
        'wearGrungeRanges': report['draws']['wearGrunge']['ranges'],
        'randomFloat': RANDOM_FLOAT_SYMBOL,
        'output': str(OUT.relative_to(ROOT)),
    }, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
