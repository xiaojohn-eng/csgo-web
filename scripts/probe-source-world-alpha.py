"""Execute original BSP alpha staging, core vertex storage and D3DCOLOR packing.

PYTHONPATH=.tools/source-binary-venv/lib/python3.9/site-packages python3 scripts/probe-source-world-alpha.py
All distinct alpha values in the original map, plus half-step/invalid boundaries.
No full native renderer/GPU claim: only three immutable original x86 spans run.
"""
from pathlib import Path
import hashlib
import json
import math
import runpy
import struct
from unicorn import Uc, UC_ARCH_X86, UC_MODE_64
from unicorn.x86_const import *

ROOT = Path(__file__).resolve().parents[1]
sha = lambda b: hashlib.sha256(b).hexdigest()


def main():
    elf = runpy.run_path(str(ROOT / 'scripts/inspect-source-vhv-encoding.py'))['ELF'](ROOT / '.reference-assets/csgo-legacy/bin/linux64/engine_client.so')
    assert sha(elf.data) == '34a96aefd9357a20e7e81f1525f13363e2561c88001d73d24c2b06b0655671f1'
    bsp = (ROOT / '.reference-assets/csgo-legacy/csgo/maps/de_dust2.bsp').read_bytes()
    assert sha(bsp) == 'b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc'
    begin, size = struct.unpack_from('<2I', bsp, 8 + 33 * 16)
    original = bsp[begin:begin + size]
    records = {}; all_values = []
    for at in range(0, size, 20):
        alpha = struct.unpack_from('<f', original, at + 16)[0]
        records[alpha] = original[at:at + 20]; all_values.append(alpha)
    u = Uc(UC_ARCH_X86, UC_MODE_64)
    # Only the code and read-only constant pages used by these three spans.
    for page in (0x3ef000, 0x3ee000, 0x303000, 0x93b000, 0x934000, 0x936000, 0x945000, 0x947000):
        u.mem_map(page, 4096); u.mem_write(page, elf.code(page, 4096))
    arena = 0x30000000; u.mem_map(arena, 0x10000)
    obj, vertices, source, vector, distance, alpha_buffer, output, stack = [arena + i * 0x1000 for i in range(8)]
    u.mem_write(obj + 0x300, struct.pack('<Q', vertices)); u.mem_write(stack - 0x90, struct.pack('<Q', output))
    def run(raw):
        u.mem_write(source, raw)
        for reg, value in ((UC_X86_REG_RAX, source), (UC_X86_REG_RSI, vector), (UC_X86_REG_R9, distance),
            (UC_X86_REG_RCX, alpha_buffer), (UC_X86_REG_RDI, 0), (UC_X86_REG_R10, source + 20)):
            u.reg_write(reg, value)
        u.emu_start(0x3ef1a0, 0x3ef1e3, count=100)
        assert bytes(u.mem_read(alpha_buffer, 4)) == raw[16:20]
        for reg, value in ((UC_X86_REG_RBX, obj), (UC_X86_REG_R13, alpha_buffer), (UC_X86_REG_RAX, 0), (UC_X86_REG_RDX, 0)):
            u.reg_write(reg, value)
        u.emu_start(0x3eef44, 0x3eef5f, count=100)
        assert bytes(u.mem_read(vertices + 0x8c, 4)) == raw[16:20]
        u.reg_write(UC_X86_REG_RAX, 0); u.reg_write(UC_X86_REG_RBP, stack)
        u.emu_start(0x303268, 0x303319, count=100)
        color = bytes(u.mem_read(output, 4)); assert color[:3] == bytes([255, 255, 255])
        return color[3]
    quantize = runpy.run_path(str(ROOT / 'scripts/source-world-alpha.py'))['source_world_alpha_byte']
    outputs = {}; fixtures = []
    for i, (alpha, raw) in enumerate(sorted(records.items())):
        value = run(raw); assert value == quantize(alpha), (alpha, value, quantize(alpha)); outputs[alpha] = value
        if i % 271 == 0 or alpha in (0, 255): fixtures.append(dict(alpha=alpha, byte=value))
    for alpha in [-1, -0.0, 0, .49, .5, .51, 1.5, 2.5, 63.5, 127.5, 128.5, 254.5, 255, 256, float('inf'), -float('inf'), float('nan')]:
        actual = run(struct.pack('<5f', 0, 0, 1, 12, alpha))
        assert actual == quantize(alpha)
        fixtures.append(dict(alpha=alpha if math.isfinite(alpha) else str(alpha), byte=actual))
    packed = bytes(outputs[a] for a in all_values)
    spans = [(0x3ef1a0, 0x3ef1e3), (0x3eef44, 0x3eef5f), (0x303268, 0x303319)]
    report = dict(format='source-native-world-alpha-v1', engine=elf.identity(), sourceBspSha256=sha(bsp),
        originalDispVertices=len(all_values), uniqueMapValuesExecuted=len(records),
        originalLumpSha256=sha(original), normalizedUNORM8Source='native byte / 255 at vertex shader input',
        packedBytesSha256=sha(packed), minAlpha=min(all_values), maxAlpha=max(all_values),
        nativeSpans=[dict(start=hex(a), stop=hex(b), sha256=sha(elf.code(a, b - a))) for a, b in spans],
        loaderChain=['DispInfo_LoadDisplacements 0x3057a0 reads lump33 into 20-byte records',
            '0x305c30 calls 0x305630; 0x3056bd calls 0x3ef140; 0x3ef1d0 copies raw record+16 alpha',
            '0x3eeaca preserves alpha-array argument in r13; 0x3eef56 stores CoreDispVertex+0x8c',
            '0x305d33 -> 0x304130 -> 0x302fe0; 0x303268 loads the same +0x8c and writes white RGB / quantized alpha'],
        constants=dict(inverse255=struct.unpack('<f', elf.code(0x93b1d8, 4))[0], clampMin=0, clampMax=1, scale=255, roundMagic=8388608),
        scope='Exact original native CPU vertex packing spans and all distinct original BSP alpha values; full engine and GPU interpolation not executed', cases=fixtures)
    (ROOT / 'tests/fixtures/source-world-alpha-native.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k != 'cases'}, indent=2))


if __name__ == '__main__': main()
