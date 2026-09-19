#!/usr/bin/env python3
"""Read-only, build-pinned C4 timer receipts from original Linux x64 server code.

Requires the project's existing pyelftools, capstone and unicorn environment.
Executes selected original blocks with synthetic entity/global memory; it does
not start a server or claim end-to-end Source gameplay/animation validation.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import runpy
import struct

from elftools.elf.elffile import ELFFile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_64
from unicorn.x86_const import (
    UC_X86_REG_RAX, UC_X86_REG_RBX, UC_X86_REG_RBP, UC_X86_REG_RSP,
    UC_X86_REG_RDI, UC_X86_REG_RSI, UC_X86_REG_RDX, UC_X86_REG_R8,
    UC_X86_REG_R12, UC_X86_REG_R13, UC_X86_REG_RIP,
)

EXPECTED_SHA = '5dc259006b3251e48c39cf30a86aae149da36c975fda054d0314907b7391845c'
DEFAULT_BINARY = '.reference-assets/csgo-legacy/csgo/bin/linux64/server_client.so'
F32 = lambda value: struct.unpack('<f', struct.pack('<f', value))[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, default=Path(DEFAULT_BINARY))
    parser.add_argument('--cfg-root', type=Path, default=Path('.reference-assets/csgo-legacy/csgo/cfg'))
    parser.add_argument('--output', type=Path, default=Path('output/goal-objective-timers-20260913/receipt.json'))
    args = parser.parse_args()
    helpers = runpy.run_path(str(Path(__file__).with_name('source-binary-index.py')))
    binary = helpers['open_binary'](args.binary)
    digest = hashlib.sha256(binary.data).hexdigest()
    assert digest == EXPECTED_SHA, f'Unsupported binary SHA256: {digest}'

    def expect(address, encoded):
        actual = binary.bytes_at(address, len(bytes.fromhex(encoded))).hex()
        assert actual == encoded, (hex(address), actual, encoded)

    def text_at_instruction(address, expected):
        target = binary.rip_target(address)
        assert binary.string_at(target) == expected, (hex(address), expected)
        return {'instruction': hex(address), 'stringVA': hex(target), 'value': expected}

    fields = [
        (0xf15ecb, 'ba800d0000', 0xf15ed4, 'm_fArmedTime'),
        (0xf1381c, 'ba44060000', 0xf13839, 'm_flC4Blow'),
        (0xf1385f, 'bab4060000', 0xf13876, 'm_flTimerLength'),
        (0xf13895, 'bac8060000', 0xf138b1, 'm_flDefuseLength'),
        (0xf138d4, 'bacc060000', 0xf138eb, 'm_flDefuseCountDown'),
        (0xe0d54b, 'ba001b0000', 0xe0d55f, 'm_bHasDefuser'),
    ]
    metadata = []
    for address, encoded, string_at, name in fields:
        expect(address, encoded)
        metadata.append({'fieldOffset': hex(int.from_bytes(bytes.fromhex(encoded)[1:], 'little')),
                         'offsetInstruction': hex(address), **text_at_instruction(string_at, name)})
    registration = [text_at_instruction(0x5bec71, '40'),
                    text_at_instruction(0x5bec78, 'mp_c4timer'),
                    text_at_instruction(0x5bec61, 'how long from when the C4 is armed until it blows')]
    expect(0x5bec86, 'e81568aa00')
    expect(0xf17022, 'f20f580506c14800')
    assert struct.unpack('<d', binary.bytes_at(binary.rip_target(0xf17022), 8))[0] == 3.0
    expect(0xf1343b, 'b80000a040')
    expect(0xf13613, 'b800002041')
    expect(0xdeaeb1, '0fb687001b0000')
    assert binary.lea_target(0xf194bd) == binary.lea_target(0x5bec7f)
    assert binary.vtable_named('CC4')[1][319] == 0xf16c60
    assert binary.vtable_named('CPlantedC4')[1][102] == 0xf12c30

    entity, player, globals_data, stack = 0x50000000, 0x50004000, 0x50008000, 0x50010000
    globals_pointer = binary.lea_target(0xf1700f)
    assert binary.lea_target(0xf1946e) == globals_pointer

    def machine(curtime=0):
        uc = Uc(UC_ARCH_X86, UC_MODE_64)
        elf = ELFFile(io.BytesIO(binary.data))
        segments = [segment for segment in elf.iter_segments() if segment['p_type'] == 'PT_LOAD']
        low = min(int(s['p_vaddr']) for s in segments) & ~4095
        high = (max(int(s['p_vaddr']) + int(s['p_memsz']) for s in segments) + 4095) & ~4095
        uc.mem_map(low, high - low)
        for segment in segments:
            uc.mem_write(int(segment['p_vaddr']), segment.data())
        uc.mem_map(entity, 0x20000)
        uc.mem_write(globals_pointer, struct.pack('<Q', globals_data))
        uc.mem_write(globals_data + 0x10, struct.pack('<f', curtime))
        for register, value in [(UC_X86_REG_RBX, entity), (UC_X86_REG_R12, player),
                                (UC_X86_REG_R13, globals_pointer), (UC_X86_REG_RSP, stack),
                                (UC_X86_REG_RBP, stack)]:
            uc.reg_write(register, value)
        return uc

    def read_float(uc, offset):
        return struct.unpack('<f', uc.mem_read(entity + offset, 4))[0]

    def cstring(uc, address):
        return bytes(uc.mem_read(address, 200)).split(b'\0')[0].decode('ascii')

    def execute(uc, start, end):
        uc.emu_start(start, end, count=200)
        assert uc.reg_read(UC_X86_REG_RIP) == end, 'Original block exceeded instruction limit'

    # Execute the registration argument setup, stopping at the constructor entry.
    # The constructor/global cvar subsystem itself is deliberately not emulated.
    uc = machine()
    execute(uc, 0x5bec4d, 0x10654a0)
    captured = {key: cstring(uc, uc.reg_read(reg)) for key, reg in
                [('name', UC_X86_REG_RSI), ('default', UC_X86_REG_RDX), ('help', UC_X86_REG_R8)]}
    assert captured['name'] == 'mp_c4timer' and captured['default'] == '40'
    captured['objectVA'] = hex(uc.reg_read(UC_X86_REG_RDI))
    captured['scope'] = 'Original registration setup through constructor entry; constructor not executed.'

    cases = []
    for curtime in [0.0, 100.0, 123.25, 32768.125]:
        uc = machine(curtime)
        execute(uc, 0xf17008, 0xf17072)
        armed = read_float(uc, 0xd80)
        assert armed == F32(F32(curtime) + 3.0)
        cases.append({'kind': 'plant', 'curtime': curtime, 'deadline': armed, 'seconds': 3.0})
        for kit in [False, True]:
            uc = machine(curtime)
            uc.mem_write(player + 0x1b00, bytes([int(kit)]))
            # Executes original kit getter and both original duration/store branches.
            execute(uc, 0xf1342b, 0xf134cc)
            duration, deadline = read_float(uc, 0x6c8), read_float(uc, 0x6cc)
            assert duration == (5.0 if kit else 10.0)
            assert deadline == F32(F32(curtime) + duration)
            cases.append({'kind': 'defuse', 'curtime': curtime, 'hasKit': kit,
                          'seconds': duration, 'deadline': deadline})
        # Original consumer arithmetic after GetInt; the supplied return value is
        # explicit, so this does not pretend to emulate ConVar initialization.
        for cvar_int in [40, 35, 18]:
            uc = machine(curtime)
            uc.reg_write(UC_X86_REG_RAX, cvar_int)
            execute(uc, 0xf19506, 0xf195a7)
            duration, deadline = read_float(uc, 0x6b4), read_float(uc, 0x644)
            assert duration == float(cvar_int) and deadline == F32(F32(curtime) + duration)
            cases.append({'kind': 'fuse-consumer-after-GetInt', 'curtime': curtime,
                          'suppliedConvarInt': cvar_int, 'seconds': duration, 'deadline': deadline})

    blocks = {
        'registration': (0x5bec4d, 0x5bec8b),
        'plant-deadline': (0xf17008, 0xf17072),
        'plant-deadline-comparison': (0xf17440, 0xf1745c),
        'plant-field-metadata': (0xf15ecb, 0xf15ee7),
        'kit-getter': (0xdeaeb0, 0xdeaebd),
        'kit-field-metadata': (0xe0d54b, 0xe0d56d),
        'defuse-kit-and-deadline': (0xf1342b, 0xf134d8),
        'defuse-no-kit': (0xf13613, 0xf13624),
        'planted-fields': (0xf1381c, 0xf138fe),
        'fuse-cvar-and-deadline': (0xf194bd, 0xf195a7),
    }
    evidence = {}
    for name, (start, end) in blocks.items():
        instructions = []
        for instruction in binary.instructions(start, end-start):
            item = {'va': hex(instruction.address), 'bytes': instruction.bytes.hex(),
                    'instruction': instruction.mnemonic + ' ' + instruction.op_str}
            try:
                target = binary.rip_target(instruction.address)
                item['ripTarget'] = hex(target)
                string = binary.string_at(target)
                if string and len(string) < 200:
                    item['string'] = string
            except ValueError:
                pass
            instructions.append(item)
        evidence[name] = instructions

    cfg_overrides = []
    cfg_evidence = []
    for path in [args.cfg_root / 'gamemode_competitive.cfg',
                 args.cfg_root / 'gamemode_survival.cfg', args.cfg_root.parent / 'gamemodes.txt']:
        if path.exists():
            cfg_evidence.append({'file': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                                 'mpC4timerOccurrences': path.read_text(errors='replace').count('mp_c4timer')})
    for path in sorted(args.cfg_root.rglob('*.cfg')):
        for line_number, line in enumerate(path.read_text(errors='replace').splitlines(), 1):
            if 'mp_c4timer' in line and not line.strip().startswith('//'):
                cfg_overrides.append({'file': str(path.relative_to(args.cfg_root)),
                                      'line': line_number, 'text': line.strip()})
    receipt = {
        'schema': 1, 'build': 'CSGO legacy 12426148', 'architecture': 'Linux x86_64',
        'binary': str(args.binary), 'sha256': digest,
        'findings': {'plantDeadlineSeconds': 3.0, 'defuseWithKitSeconds': 5.0,
                     'defuseWithoutKitSeconds': 10.0, 'mpC4timerRegisteredDefaultSeconds': 40},
        'nativeExecution': {'registration': captured, 'cases': cases, 'caseCount': len(cases),
                            'scope': 'Unicorn executes original instruction blocks, synthetic valid globals/entities, null network dirty-state sink. Not a full original server/session.'},
        'registrationReferences': registration, 'networkFieldMetadata': metadata,
        'constantData': {'plant': {'va': hex(binary.rip_target(0xf17022)),
                                  'bytes': binary.bytes_at(binary.rip_target(0xf17022), 8).hex(),
                                  'type': 'float64-le', 'value': 3.0}},
        'classMethods': {'CC4': {'vtable': hex(binary.vtable_named('CC4')[0]), 'slot': 319, 'function': '0xf16c60'},
                         'CPlantedC4': {'vtable': hex(binary.vtable_named('CPlantedC4')[0]), 'slot': 102, 'function': '0xf12c30'}},
        'cfgOverrides': cfg_overrides, 'cfgEvidence': cfg_evidence, 'instructions': evidence,
        'limitations': ['Registered default is not proof every mode/server uses 40; overrides are consumed by the same timer code.',
                        'No proof of complete planting animation duration or input-to-visible latency; deadline is 3.0.',
                        'Only this original Linux x64 binary was executed; 32-bit/client binaries not independently probed.',
                        'No browser, network room, running server, or gameplay code modified.'],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'receipt': str(args.output), 'sha256': digest,
                      'findings': receipt['findings'], 'nativeCases': len(cases)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
