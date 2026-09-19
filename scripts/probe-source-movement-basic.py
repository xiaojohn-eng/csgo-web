"""Locate the original `Movement Basic` particle operator in the shipped client.

The rifle's smoke systems all move with `Movement Basic` (non-zero gravity and drag),
and this port refuses to approximate an operator whose arithmetic it has not read. This
finds the operator's registration, its factory and its instance vtable, and prints the
disassembly of the registration and the factory so the apply method can be read next.

Run: python3 scripts/probe-source-movement-basic.py
"""
from pathlib import Path
from elftools.elf.elffile import ELFFile
from capstone import Cs, CS_ARCH_X86, CS_MODE_32
import json
import re
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
BINARY = ROOT / '.reference-assets/csgo-legacy/csgo/bin/client_client.so'
OUT = ROOT / 'output/source-movement-basic.json'
NAME = 'Movement Basic'
raw = BINARY.read_bytes()
with BINARY.open('rb') as handle:
    elf = ELFFile(handle)
    segments = [dict(s.header) for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD']
    # A call inside the operator reaches libm through a thunk whose target is an imported
    # symbol; the relocation table is what names it, so nothing is guessed from offsets.
    relocations = {}
    for section in elf.iter_sections():
        if section['sh_type'] not in ('SHT_REL', 'SHT_RELA'):
            continue
        symbols = elf.get_section(section['sh_link'])
        for relocation in section.iter_relocations():
            if relocation['r_info_sym']:
                relocations[relocation['r_offset']] = symbols.get_symbol(relocation['r_info_sym']).name


def offset(va):
    segment = next(s for s in segments if s['p_vaddr'] <= va < s['p_vaddr'] + s['p_filesz'])
    return va - segment['p_vaddr'] + segment['p_offset']


def word(va):
    return struct.unpack_from('<I', raw, offset(va))[0]


def string(va):
    if not va:
        return None
    at = offset(va)
    end = raw.index(0, at)
    return raw[at:end].decode()


def disassemble(va, count=120, size=None):
    end = offset(va) + (size or count * 8)
    return list(Cs(CS_ARCH_X86, CS_MODE_32).disasm(raw[offset(va):end], va))


# Every registration of the name, by the same two-writer pattern the operator
# registrations use: a pair of `mov dword ptr [table], imm` around the factory call.
candidates = []
start = 0
while True:
    at = raw.find(NAME.encode() + b'\0', start)
    if at < 0:
        break
    start = at + 1
    reference = 0
    while True:
        reference = raw.find(struct.pack('<I', at), reference)
        if reference < 0:
            break
        ref = reference
        reference += 1
        if not (0x400000 < ref < 0x410000) or raw[ref-6:ref-4] != b'\xc7\x05' or raw[ref-16:ref-14] != b'\xc7\x05':
            continue
        definition_vtable = struct.unpack_from('<I', raw, ref-10)[0]
        call = next((i for i in disassemble(ref+4, 50) if i.mnemonic == 'call'), None)
        if not call:
            continue
        factory = int(call.op_str, 16)
        # The definition's own table holds the display name and the factory.
        definition = [word(definition_vtable + step) for step in range(0, 0x28, 4)]
        candidates.append(dict(registrationVA=hex(ref-6), definitionVTable=hex(definition_vtable),
            definition=[hex(value) for value in definition], factory=hex(factory),
            nameStringVA=hex(at), factoryInstructions=[dict(address=hex(i.address), text=f'{i.mnemonic} {i.op_str}')
                for i in disassemble(factory, 80)]))
report = dict(binary=str(BINARY.relative_to(ROOT)), bytes=len(raw), name=NAME, candidates=candidates)
code = {segment['p_vaddr'] for segment in segments}
text = [segment for segment in segments if segment['p_flags'] & 1]
def in_text(va):
    return any(segment['p_vaddr'] <= va < segment['p_vaddr'] + segment['p_filesz'] for segment in text)
# The definition table's own entries: the ones that land in executable memory are its
# methods. One of them creates the operator instance, and its constructor writes the
# instance vtable, which is where the apply method lives.
for candidate in candidates:
    handlers = []
    for index, entry in enumerate(candidate['definition']):
        value = int(entry, 16)
        if not value or not in_text(value):
            continue
        rows = [dict(address=hex(i.address), text=f'{i.mnemonic} {i.op_str}') for i in disassemble(value, 60)]
        handlers.append(dict(index=index, address=entry, instructions=rows))
    candidate['handlers'] = handlers
# The instance vtable the factory writes, and its methods. `Movement Basic` applies
# gravity and drag to each particle's velocity, so the arithmetic is in whichever
# entry does that; the float operations are kept and the rest dropped.
INSTANCE_VTABLE = 0x1110ca8
vtable = [word(INSTANCE_VTABLE + step) for step in range(0, 0x40, 4)]
for candidate in candidates:
    methods = []
    for index, value in enumerate(vtable):
        if not value or not in_text(value):
            continue
        rows = [dict(address=hex(i.address), text=f'{i.mnemonic} {i.op_str}') for i in disassemble(value, 200)]
        floating = [row for row in rows if any(op in row['text'] for op in
            ('mulss', 'addss', 'subss', 'mulps', 'addps', 'subps', 'divss', 'rcpss', 'sqrtss', 'movaps', 'shufps', 'cvtsi2ss'))]
        # Each call target is either an internal address or a thunk onto an import; the
        # import's name is what says which libm function the operator reaches.
        calls = []
        for row in rows:
            if not row['text'].startswith('call '):
                continue
            operand = row['text'].split(None, 1)[1]
            literal = re.search(r'\[?(0x[0-9a-f]+)\]?$', operand)
            if operand.startswith('dword ptr [') and literal:
                # An indirect call onto an import pointer; the relocation names it.
                pointer = int(literal.group(1), 16)
                calls.append(dict(address=row['address'], target=hex(pointer), importName=relocations.get(pointer)))
                continue
            if not literal or not operand.startswith('0x'):
                calls.append(dict(address=row['address'], target=operand, importName=None))
                continue
            target = int(literal.group(1), 16)
            name = None
            if in_text(target):
                thunk = list(Cs(CS_ARCH_X86, CS_MODE_32).disasm(raw[offset(target):offset(target) + 16], target))
                for step in thunk:
                    if step.mnemonic in ('jmp', 'call') and '[' in step.op_str:
                        pointer = int(step.op_str.split('[')[1].rstrip(']'), 16)
                        name = relocations.get(pointer)
                        break
            calls.append(dict(address=row['address'], target=hex(target), importName=name))
        if floating:
            methods.append(dict(index=index, address=hex(value), floating=floating, calls=calls, instructions=rows))
    candidate['instanceVTable'] = hex(INSTANCE_VTABLE)
    candidate['instanceMethods'] = methods
# The constants the apply method reads, and the field offsets the unpack schema gives
# the operator, so the drag term is traceable to shipped bytes.
def double_at(va):
    return struct.unpack_from('<d', raw, offset(va))[0]
def float_at(va):
    return struct.unpack_from('<f', raw, offset(va))[0]
CONSTANTS = {hex(va): dict(kind='double', value=double_at(va)) for va in (0xfaa300, 0xfb1298)}
CONSTANTS[hex(0x1116b60)] = dict(kind='float', value=float_at(0x1116b60))
report['constants'] = CONSTANTS
report['reading'] = {
    'registration': 'The operator registers itself at 0x403f2c; its definition table is at 0x11142e8.',
    'instance': 'The factory at 0xd2bbe0 allocates 0x6c bytes and writes the instance vtable 0x1110ca8, '
                'then copies the unpack defaults into the instance; the apply method is vtable entry 9 at 0xd0d800.',
    'fields': 'The instance holds gravity as three floats at +0x58, +0x5c and +0x60 and the drag as a float at +0x64, '
              'which is what the apply method reads before it integrates.',
    'drag': 'The apply method computes 1 - max(drag, 0), calls a libm function on it, multiplies by 30.0 (the tick '
            'rate) and by dt, and then takes __expf_finite of that product, so the drag is an exponential decay over '
            'the tick at 30 Hz rather than a linear per-frame subtraction.',
    'notYetRead': 'How that factor and the per-step gravity array combine into each sub-step position is not read yet: '
                  'the method writes a per-sub-step position history, and the algebra of that loop has not been '
                  'traced to the particle struct layout.',
    'boundary': 'This locates the operator and reads its constants and the shape of the drag term. It does not state the '
                'position update, so no simulation may be written from it yet: a wrong reading here would move the '
                'smoke silently.',
}
OUT.parent.mkdir(exist_ok=True)
OUT.write_text(json.dumps(report, indent=2) + '\n')
(ROOT / 'research/source-movement-basic.json').write_text(json.dumps(report, indent=2) + '\n')
for candidate in candidates:
    print('REGISTRATION', json.dumps({k: v for k, v in candidate.items() if k not in ('factoryInstructions', 'handlers')}))
    for handler in candidate['handlers']:
        print('HANDLER index', handler['index'], handler['address'])
        for row in handler['instructions']:
            print('   ', row['address'], row['text'])
