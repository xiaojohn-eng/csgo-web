"""Bounded original material constant proof; no production material changes.

This does NOT claim a complete live Dust2 shader selection or CSM state.
"""
from pathlib import Path
import importlib.util, json, struct, sys
from unicorn.x86_const import UC_X86_REG_R12, UC_X86_REG_R13, UC_X86_REG_RBX, UC_X86_REG_RIP

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.reference-assets/source-exports/dust2-foliage-audit/olive-power'

def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / file)
    value = importlib.util.module_from_spec(spec); sys.modules[name] = value
    spec.loader.exec_module(value); return value

def main():
    OUT.mkdir(exist_ok=True)
    e = module('olive_encoding', 'inspect-source-vhv-encoding.py')
    t = module('olive_native', 'inspect-source-prop-tint.py')
    shader = e.ELF(ROOT / '.reference-assets/csgo-legacy/bin/linux64/stdshader_dx9_client.so')
    api = e.ELF(ROOT / '.reference-assets/csgo-legacy/bin/linux64/shaderapidx9_client.so')
    assert shader.identity()['sha256'] == '0383c51766a4681b5de26aa79b67ade5d3a867a8622185abe8a090877bac7c2e'
    assert shader.cstring(shader.rip(0x4a258, '48 8d 05')) == '$VERTEXCOLORPOWER'
    shader.check(0x4a281, '89 05 01 97 32 00')
    shader.check(0xc4301, '8b 05 81 f6 2a 00 89 45 c0')
    shader.check(0xc7b50, '49 63 84 24 00 02 00 00')
    shader.check(0xc7b61, 'f3 0f 10 40 14')
    shader.check(0xc7b94, 'c7 42 04 0d 00 00 00')
    # Same original draw-info builder as the established VHV path. The index
    # comes from original field stores, not a guessed SDK struct layout.
    base = t.BASE; uc = t.emulator(shader)
    uc.mem_write(base + 0xe000 - 0x250, b'\xff' * 0x21c)
    uc.mem_write(0x373988, struct.pack('<i', 723))
    uc.emu_start(0xc28f4, 0xc2df1, count=500)
    assert uc.reg_read(UC_X86_REG_RIP) == 0xc2df1
    assert struct.unpack('<i', uc.mem_read(base + 0xe000 - 0x250 + 0x200, 4))[0] == 723
    uc = t.emulator(shader)
    uc.reg_write(UC_X86_REG_R12, base); uc.reg_write(UC_X86_REG_R13, base + 0x1000); uc.reg_write(UC_X86_REG_RBX, base + 0x2000)
    uc.mem_write(base + 0x188, struct.pack('<i', 0)); uc.mem_write(base + 0x200, struct.pack('<i', 1))
    uc.mem_write(base + 0x1000, struct.pack('<2Q', base + 0x4000, base + 0x4040))
    cases = []
    for other in [0, .5, 2]:
        for power in [-1, 0, .125, .7, 1, 2, 4]:
            uc.mem_write(base + 0x401c, struct.pack('<f', other)); uc.mem_write(base + 0x4054, struct.pack('<f', power))
            uc.mem_write(base + 0x2330, struct.pack('<Q', base + 0x5000))
            uc.emu_start(0xc7b35, 0xc7bd6, count=100)
            assert uc.reg_read(UC_X86_REG_RIP) == 0xc7bd6
            command = struct.unpack('<3I4f', uc.mem_read(base + 0x5000, 28))
            assert command[:3] == (3, 13, 1)
            assert command[3:] == (t.f32(max(0, power)), 0, 0, t.f32(other))
            cases.append(dict(power=power, otherParameter=other, command=list(command)))
    # Preserve the installed command3/4 interpreter targets for follow-up; do
    # not confuse this ordinary table with the per-instance color interpreter.
    command_targets = {str(op): hex(0xdefbc + struct.unpack('<i', api.code(0xdefbc + op * 4, 4))[0]) for op in [3, 4]}
    raw = (ROOT / '.reference-assets/source-exports/dust2-vhv/encoding/non-bump/vertexlit_and_unlit_generic_ps30.vcs').read_bytes()
    programs = []
    for static, dynamic in [(0, 0), (0, 16), (1107482, 0)]:
        code, report = e.vcs_combo(raw, static, dynamic)
        name = f'ps-static{static}-dynamic{dynamic}'
        (OUT / (name + '.dx9')).write_bytes(code)
        text = e.shader_text(code); (OUT / (name + '.tokens.txt')).write_text(text)
        reads = [line for line in text.splitlines() if 'c13.' in line]
        if static == 0: assert not reads and b'g_bCSMEnabled\0' not in code
        else:
            assert b'g_bCSMEnabled\0' in code
            words = e.instructions(code)
            assert words[510] == (0x03000005, 0x80070003, 0x80e40003, 0xa000000d)
            assert words[523] == (0x04000058, 0x80070001, 0xa100000d, 0x80e40002, 0x80e40004)
        programs.append(dict(**report, c13Reads=reads, csmBooleanPresent=b'g_bCSMEnabled\0' in code))
    result = dict(status='native_constant_upload_and_bounded_program_reads_verified', binaries=[shader.identity(), api.identity()],
        parameter=dict(name='$VERTEXCOLORPOWER', string='0x122666', globalIndex='0x373988', infoField='0x200', originalUpload='0xc7b35..0xc7bd6'),
        cases=cases, ordinaryInterpreterTargets=command_targets, vcsSha256=e.sha(raw), programs=programs,
        boundary='PS0 no-CSM programs do not consume this parameter. A separate CSM program has conditional log2/multiply/exp2, with other static features. This is not proof of live olive static/dynamic selection, actual CSM boolean, final pixels or original alpha coverage. No production files changed.')
    (OUT / 'evidence.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(dict(status=result['status'], cases=len(cases), ordinaryInterpreterTargets=command_targets), indent=2))

if __name__ == '__main__': main()
