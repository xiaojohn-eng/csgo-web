"""Execute the installed App740 Source->IVP vertex conversion block only.

No engine process, OS calls, heap callbacks, or physics approximation. RTTI /
vtable and the caller identify this block; original SSE instructions do the
three writes. Use .tools/source-binary-venv/bin/python.
"""
from pathlib import Path
import hashlib
import json
import struct
from elftools.elf.elffile import ELFFile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EBX, UC_X86_REG_EBP

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / '.reference-assets/csgo-legacy/bin/vphysics.so'
raw = PATH.read_bytes()
assert hashlib.sha256(raw).hexdigest() == '7364e056a403b885441cfc1cd3e9c127a807143cad9a41c97a145c37894aba02'
with PATH.open('rb') as stream:
    elf = ELFFile(stream)
    segments = [dict(s.header) for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD']


def offset(address):
    return next(s['p_offset'] + address - s['p_vaddr'] for s in segments if s['p_vaddr'] <= address < s['p_vaddr'] + s['p_filesz'])


def bytes_at(address, length):
    at = offset(address)
    return raw[at:at + length]


assert bytes_at(0x159fd4, len(b'17CPhysicsCollision')) == b'17CPhysicsCollision'
assert struct.unpack('<I', bytes_at(0x159fec, 4))[0] == 0x159fd4
assert struct.unpack('<I', bytes_at(0x15a0dc, 4))[0] == 0x159fe8
assert struct.unpack('<I', bytes_at(0x15a0e0 + 8, 4))[0] == 0x3f8a0
assert bytes_at(0x3f8b3, 5) == bytes.fromhex('e8 58 fd ff ff')  # Call 0x3f610.
assert bytes_at(0x3f66c, 8) == bytes.fromhex('f3 0f 10 05 48 e0 1b 00')
assert bytes_at(0x3f692, 7) == bytes.fromhex('0f 57 0d 10 97 15 00')
factor = struct.unpack('<f', bytes_at(0x1be048, 4))[0]
assert factor == struct.unpack('<f', struct.pack('<f', .0254))[0]
assert struct.unpack('<I', bytes_at(0x159710, 4))[0] == 0x80000000

uc = Uc(UC_ARCH_X86, UC_MODE_32)
pages = set()
for segment in segments:
    for page in range(segment['p_vaddr'] & ~4095, (segment['p_vaddr'] + segment['p_memsz'] + 4095) & ~4095, 4096):
        if page not in pages:
            uc.mem_map(page, 4096)
            pages.add(page)
    uc.mem_write(segment['p_vaddr'], raw[segment['p_offset']:segment['p_offset'] + segment['p_filesz']])
BASE = 0x60000000
uc.mem_map(BASE, 4096)
f32 = lambda n: struct.unpack('<f', struct.pack('<f', n))[0]
vectors = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [12, -34, 56], [-13.9, -5.91, 137.13], [498, 2331, -106]]
results = []
for value in vectors:
    value = list(map(f32, value))
    uc.mem_write(BASE, struct.pack('<3f', *value))
    uc.reg_write(UC_X86_REG_EAX, BASE)
    uc.reg_write(UC_X86_REG_EBX, BASE + 64)
    uc.reg_write(UC_X86_REG_EBP, BASE + 256)
    uc.emu_start(0x3f66c, 0x3f6a7)
    actual = list(struct.unpack('<3f', uc.mem_read(BASE + 64, 12)))
    expected = [f32(value[0] * factor), -f32(value[2] * factor), f32(value[1] * factor)]
    assert actual == expected, (value, actual, expected)
    results.append(dict(source=value, originalNativeIVP=actual))
report = dict(status='original_App740_SSE_conversion_block_passed', binary=str(PATH.relative_to(ROOT)),
    binarySha256=hashlib.sha256(raw).hexdigest(), nativeFactor=factor,
    callChain=dict(rtti=hex(0x159fd4), vtable=hex(0x15a0e0), convexFromVerts=hex(0x3f8a0), vertexBuilder=hex(0x3f610), block=[hex(0x3f66c), hex(0x3f6a7)]),
    blockHex=bytes_at(0x3f66c, 0x3f6a7-0x3f66c).hex(),
    sourceToIVP='(x,-z,y)*float32(.0254)', ivpToSource='(x,z,-y)/.0254',
    SourceIOCorrection='get_vertex_data already swaps Y/Z; negate returned column 2 before treating as Source coordinates',
    samples=results, limits=['Only the original vertex conversion instruction block is executed; not a complete native collision or physics world.'])
out = ROOT / 'output/tests/source-physics-axis.json'
out.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
