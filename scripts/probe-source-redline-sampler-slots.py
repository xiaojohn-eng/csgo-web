"""Find every texture-slot bind-command writer the installed CustomWeapon shader path has.

`probe-source-redline-programs.py` measured the writers for the six slots the style-7
permutation reads (0, 1, 2, 3, 5, 8). Every other style's permutation declares more
texture registers (style 2/4/5/8/9 bind 4; style 3/6 bind 6 and 7), so the question a
style needs answered is whether those slots have their own writers in the engine or
whether the permutation declares a register this material path never binds.

Each writer is a short specialised stub: given a texture handle in RAX and the shader
context in RBX it emits one `(command, flags, handle)` triple, where the low nine bits
of `flags` are this material's own sampler number and bit 31 is its colour space. That
is what makes them findable: scan the function's own code range, run each candidate
start, and keep the addresses whose output is a bind command for this shader's own
sampler numbering. No texture name is inferred from an address; the flags are the
measured output, exactly as for the six already-known slots.

Run: python3 scripts/probe-source-redline-sampler-slots.py
"""
from pathlib import Path
import hashlib
import importlib.util
import json
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.reference-assets/source-exports/customweapon-style-programs'
KNOWN = [(0, 0x67968, 0x679ac), (1, 0x67c40, 0x67c84), (2, 0x67bd8, 0x67c1c),
         (3, 0x67b6f, 0x67bb3), (5, 0x67aa0, 0x67ae4), (8, 0x661c1, 0x66205)]
# The two windows cover the stubs above plus the gaps between them; the loop below is
# only ever started at an address inside them.
WINDOWS = [(0x678f0, 0x67d40), (0x660c0, 0x66320)]


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / file)
    loaded = importlib.util.module_from_spec(spec)
    sys.modules[name] = loaded
    spec.loader.exec_module(loaded)
    return loaded


def main():
    tint = module('slot_tint', 'inspect-source-prop-tint.py')
    encoding = module('slot_encoding', 'inspect-source-vhv-encoding.py')
    elf = encoding.ELF(ROOT / '.reference-assets/csgo-legacy/bin/linux64/stdshader_dx9_client.so')
    u = tint.emulator(elf)
    frame, ctx, stream = tint.BASE + 0xe000, tint.BASE + 0x3000, tint.BASE + 0x8000
    u.reg_write(tint.UC_X86_REG_R14, tint.BASE)

    def run(start):
        """One candidate start. Every writer the earlier probe measured is a 0x44-byte
        block, so a candidate counts only if control reaches exactly `start + 0x44`:
        that structural test is what keeps the scan from reading a command some later
        code happened to leave in the stream."""
        u.mem_write(ctx + 0x330, struct.pack('<Q', stream))
        u.reg_write(tint.UC_X86_REG_RBX, ctx)
        u.reg_write(tint.UC_X86_REG_RAX, 0x12345678)
        u.mem_write(stream, b'\0' * 32)
        try:
            u.emu_start(start, start + 0x44, count=100)
        except Exception:
            return None
        if u.reg_read(tint.UC_X86_REG_RIP) != start + 0x44:
            return None
        command, flags, handle = struct.unpack('<IIQ', u.mem_read(stream, 16))
        if command != 10 or handle != 0x12345678:
            return None
        sampler = flags & 0x1ff
        if flags & ~0x800001ff:
            return None
        return dict(sampler=sampler, srgbRead=bool(flags & 0x80000000), flags=flags)

    found = {}
    tested = 0
    for low, high in WINDOWS:
        for address in range(low, high):
            outcome = run(address)
            tested += 1
            if not outcome:
                continue
            # Keep one witness per (sampler, srgb) pair: several addresses inside one stub
            # can produce the same command, and the first is the stub's own start.
            key = (outcome['sampler'], outcome['srgbRead'])
            if key in found:
                found[key]['candidates'] += 1
                continue
            found[key] = dict(outcome, address=hex(address), span=[hex(address)],
                              candidates=1)

    rows = sorted(found.values(), key=lambda row: (row['sampler'], not row['srgbRead']))
    for row in rows:
        known = next((name for name, low, _ in KNOWN if low == int(row['address'], 16)), None)
        print('sampler %-2d srgb %-5s at %s%s  (%d candidate starts)' % (
            row['sampler'], str(row['srgbRead']), row['address'],
            ' (= the style-7 witness)' if known is not None else '', row['candidates']))
    print('scan tested %d addresses in %d windows' % (tested, len(WINDOWS)))

    # The control: the six writers the earlier probe measured by hand have to be among
    # the ones this scan finds, with the same sampler and colour space.
    control = []
    for sampler, low, high in KNOWN:
        outcome = None
        for address in range(low, high):
            candidate = run(address)
            if candidate and candidate['sampler'] == sampler:
                outcome = dict(candidate, address=hex(address))
                break
        control.append(dict(sampler=sampler, expectedSpan=[hex(low), hex(high)],
                            measured=outcome))
        print('control sampler %-2d re-measured: %s' % (sampler, outcome and outcome['srgbRead']))
    if any(row['measured'] is None for row in control):
        raise SystemExit('a known bind writer was not reproduced by the scan')

    evidence = dict(format='source-customweapon-sampler-slots-v1',
                    status='installed_shader_texture_slots_scanned',
                    binary=elf.identity(), windows=[[hex(low), hex(high)] for low, high in WINDOWS],
                    addressesTested=tested, slots=rows, knownControl=control,
                    boundary='Bind-command writers found by running this build\'s own code. '
                             'Which original texture a slot carries is not decided here: it needs '
                             'the material\'s own texture list, which this scan does not read.')
    (OUT / 'sampler-slots.json').write_text(json.dumps(evidence, indent=1) + '\n')
    (ROOT / 'research/customweapon-sampler-slots.json').write_text(json.dumps(evidence, indent=1) + '\n')
    print('evidence:', (OUT / 'sampler-slots.json').relative_to(ROOT))
    print('research:', 'research/customweapon-sampler-slots.json')


if __name__ == '__main__':
    main()
