"""Measure how this build packs the paint kit's colours into the shader's palette constants.

The `CustomWeapon` colour permutations for styles 1, 2, 5, 8 and 9 declare three float4
uniforms whose names say what they hold (`g_cCamo0_camo3r`, `g_cCamo1_camo3g`,
`g_cCamo2_camo3b`), while the material carries four separate colours. The packing is
therefore done by this build's own material parameter code, and this probe measures it
the way the existing `c3` upload was measured: run that code with a material whose
parameter records hold *sentinel* floats, and read back which sentinel lands in which
component of which constant. A name is never trusted for a value's meaning.

The sentinel for record k, component j is `(16k + j) / 256`, so every sentinel is exact
in binary and its origin is recoverable from the bytes that come out.

Run: .tools/source-binary-venv/bin/python scripts/probe-source-redline-palette-pack.py
"""
from pathlib import Path
import importlib.util
import json
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.reference-assets/source-exports/customweapon-style-programs'
RESEARCH = ROOT / 'research/customweapon-palette-packing.json'
# The measured span of the wear/phong constant write, for the self-check.
WEAR_WRITER = (0x666d7, 0x667d6)
# Handlers for one shader sit together in the shader's own parameter code; this window
# covers the wear writer and its neighbours.
WINDOW = (0x63000, 0x6a000)
RECORDS = 8
# The parameter record stride and the offset of its value, both taken from the existing
# wear-constant probe's own setup rather than guessed here.
RECORD_STRIDE = 64
VALUE_OFFSET = 0x14


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / file)
    loaded = importlib.util.module_from_spec(spec)
    sys.modules[name] = loaded
    spec.loader.exec_module(loaded)
    return loaded


def sentinel(record, component):
    """Every sentinel is exact in binary, distinct, and never zero: a zero would be
    indistinguishable from the untouched stream, which is how a first pass of this scan
    reported every zero byte as a hit."""
    return 2 + (16 * record + component) / 256


def main():
    tint = module('pack_tint', 'inspect-source-prop-tint.py')
    encoding = module('pack_encoding', 'inspect-source-vhv-encoding.py')
    # The tint helper imports only the registers it needs, so the ones this probe uses
    # come from the emulator's own constant table.
    from unicorn.x86_const import UC_X86_REG_RCX
    tint.UC_X86_REG_RCX = UC_X86_REG_RCX
    elf = encoding.ELF(ROOT / '.reference-assets/csgo-legacy/bin/linux64/stdshader_dx9_client.so')
    u = tint.emulator(elf)
    base = tint.BASE
    info, params, ctx, var, stream = base + 0x1000, base + 0x2000, base + 0x3000, base + 0x4000, base + 0x8000
    u.reg_write(tint.UC_X86_REG_R14, base)
    u.reg_write(tint.UC_X86_REG_R12, info)
    u.reg_write(tint.UC_X86_REG_R13, params)
    u.reg_write(tint.UC_X86_REG_RBX, ctx)
    u.reg_write(tint.UC_X86_REG_RCX, stream - 16)
    u.reg_write(tint.UC_X86_REG_XMM0, 0x3f800000)

    def prepare():
        """Each record holds a distinct sentinel in each of its four components."""
        for record in range(RECORDS):
            for component in range(4):
                u.mem_write(var + record * RECORD_STRIDE + VALUE_OFFSET + 4 * component,
                            struct.pack('<f', sentinel(record, component)))
            u.mem_write(params + 8 * record, struct.pack('<Q', var + record * RECORD_STRIDE))
        # The parameter slot list the wear writer reads its three inputs from.
        for slot in range(RECORDS):
            u.mem_write(info + 0x3c + 4 * slot, struct.pack('<i', slot))
        u.mem_write(ctx + 0x330, struct.pack('<Q', stream))
        u.mem_write(stream, b'\0' * 512)

    def emitted(size=512):
        """The stream is three command words followed by float32 constant payload, the
        same layout the existing wear-constant probe decoded as `(3, 3, 1)` plus four
        floats. Only the payload is compared against the sentinels."""
        raw = bytes(u.mem_read(stream, size))
        command = struct.unpack_from('<3I', raw, 0)
        values = []
        for offset in range(12, size - 4, 4):
            values.append((offset, struct.unpack_from('<f', raw, offset)[0]))
        return command, values

    def origin(value):
        """The (record, component) a sentinel came from, or None."""
        for record in range(RECORDS):
            for component in range(4):
                if abs(value - sentinel(record, component)) < 1e-9:
                    return record, component
        return None

    # Self-check first: the wear writer has to reproduce what the existing probe measured
    # when its three inputs are the three sentinels it reads.
    prepare()
    u.emu_start(*WEAR_WRITER, count=100)
    if u.reg_read(tint.UC_X86_REG_RIP) != WEAR_WRITER[1]:
        raise SystemExit('the wear writer did not run to its own end')
    command, values = emitted(32)
    control_constants = [round(value, 6) for _, value in values]
    print('wear writer emitted command words', command)
    print('wear writer constants', control_constants)
    # The control: with record k's first component as input, the wear writer has to emit
    # exactly those three sentinels in the order its own probe measured (1, exponent,
    # intensity, wear) — anything else means this harness is not the one that measured c3.
    expected = [1.0, sentinel(0, 0), sentinel(1, 0), sentinel(2, 0)]
    if any(abs(actual - want) > 1e-6 for actual, want in zip(control_constants, expected)):
        raise SystemExit(f'the wear writer control differs: {control_constants} vs {expected}')

    findings = []
    for start in range(*WINDOW):
        prepare()
        try:
            u.emu_start(start, start + 0x400, count=120)
        except Exception:
            continue
        command_words, values = emitted(256)
        hits = [(offset, value, origin(value)) for offset, value in values]
        hits = [row for row in hits if row[2] is not None]
        if len(hits) >= 3:
            # A handler that reads several palette records and writes them out.
            findings.append(dict(address=hex(start),
                                 commandWords=list(command_words),
                                 sentinels=[dict(offset=offset, value=value,
                                                 record=row[0], component=row[1])
                                            for offset, value, row in hits[:16]],
                                 distinctRecords=sorted({row[0] for _, _, row in hits}),
                                 distinctComponents=sorted({row[1] for _, _, row in hits})))
    # Keep the widest writers: a handler that fills three float4s has more sentinels in
    # its output than one that fills a single scalar.
    findings.sort(key=lambda row: -len(row['sentinels']))
    for row in findings[:6]:
        print('%s  records %s  components %s  %d sentinels' % (
            row['address'], row['distinctRecords'], row['distinctComponents'], len(row['sentinels'])))
        print('    command words', row['commandWords'])
        for hit in row['sentinels'][:12]:
            print('      +%03d  %.6f  <- record %d component %d' % (
                hit['offset'], hit['value'], hit['record'], hit['component']))

    evidence = dict(format='source-customweapon-palette-packing-v1',
                    status='palette_constant_writers_scanned',
                    binary=elf.identity(),
                    window=[hex(WINDOW[0]), hex(WINDOW[1])],
                    sentinelRule='record k component j -> (16k+j)/256',
                    wearWriterControl=dict(span=[hex(WEAR_WRITER[0]), hex(WEAR_WRITER[1])],
                                           commandWords=list(command),
                                           constants=[round(value, 6) for _, value in values]),
                    writers=findings[:12],
                    boundary='Spans whose output contains several palette sentinels are listed, with '
                             'the record and component each value came from. Which writer the engine '
                             'actually calls for a painted weapon, and the constant register each '
                             'output lands in, are not decided by this scan.')
    (OUT / 'palette-packing.json').write_text(json.dumps(evidence, indent=1) + '\n')
    RESEARCH.write_text(json.dumps(evidence, indent=1) + '\n')
    print('candidate writers:', len(findings))
    print('evidence:', (OUT / 'palette-packing.json').relative_to(ROOT))


if __name__ == '__main__':
    main()
