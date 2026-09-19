"""Bounded installed Phong evidence for the Redline material follow-up.

Reads App740 build12426148 VPK/ELF bytes. Executes selected original x64
parameter blocks and interprets small, asserted original DX9 token slices.
The chosen Phong combo is a diagnostic specimen, not an asserted final AK
selector. No game material, service, original input, or public asset is changed.
"""
from pathlib import Path
import importlib.util
import json
import math
import re
import struct
import sys

from unicorn import UC_HOOK_CODE
from unicorn.x86_const import (
    UC_X86_REG_RAX, UC_X86_REG_RBX, UC_X86_REG_RCX, UC_X86_REG_RIP,
    UC_X86_REG_RDX, UC_X86_REG_RSI, UC_X86_REG_R12, UC_X86_REG_R13,
    UC_X86_REG_RDI, UC_X86_REG_RBP, UC_X86_REG_RSP,
    UC_X86_REG_XMM0, UC_X86_REG_XMM1, UC_X86_REG_XMM2,
)

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.reference-assets/source-exports/ak47-redline-programs'
ELF_SHA = '0383c51766a4681b5de26aa79b67ade5d3a867a8622185abe8a090877bac7c2e'
VCS_SHA = '3d705e8aaa456803e05014383f940818367d53027b14cbe70d97115e9fa5799a'
DX9_SHA = '1afefbe01b7291f0f08404fe7f6aecfabf419d130ebd7e54f04eca5bb1bf9b95'
VMT_SHA = 'dc01f61f77b650bf36a4115a9b5e2f2ebf1e4fcf7fb2c953c2fc5c28c04d0a30'


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    result = importlib.util.module_from_spec(spec)
    sys.modules[name] = result
    spec.loader.exec_module(result)
    return result


def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def kind(word):
    return ((word >> 28) & 7) | ((word >> 8) & 24)


def execute_slice(program, offsets, inputs):
    """Portable f32 slice interpreter; not a claim of native GPU precision."""
    registers = {key: list(map(f32, value)) for key, value in inputs.items()}
    for row in program.values():
        if row[0] & 65535 == 81:
            registers[(2, row[1] & 2047)] = list(struct.unpack('<4f', struct.pack('<4I', *row[2:])))

    def read(word):
        value = registers[(kind(word), word & 2047)]
        modifier = (word >> 24) & 15
        assert modifier in (0, 1)
        return [(-1 if modifier else 1) * value[(word >> (16 + 2 * i)) & 3] for i in range(4)]

    for offset in offsets:
        row = program[offset]
        opcode, destination = row[0] & 65535, row[1]
        if opcode == 66:
            # Explicit sampler fixture, after the real register-reuse sequence.
            assert destination == 0x800f0007 and row[3] == 0xa0e40807
            registers[(0, destination & 2047)] = list(registers[(10, row[3] & 2047)])
            continue
        a = read(row[2])
        b = read(row[3]) if len(row) > 3 else None
        c = read(row[4]) if len(row) > 4 else None
        if opcode == 1:
            result = a
        elif opcode == 2:
            result = [f32(x + y) for x, y in zip(a, b)]
        elif opcode == 4:
            result = [f32(f32(x * y) + z) for x, y, z in zip(a, b, c)]
        elif opcode == 5:
            result = [f32(x * y) for x, y in zip(a, b)]
        elif opcode == 6:
            result = [math.inf if a[0] == 0 else f32(1 / a[0])] * 4
        elif opcode == 7:
            result = [math.inf if a[0] == 0 else f32(1 / math.sqrt(abs(a[0])))] * 4
        elif opcode == 8:
            result = [f32(f32(f32(a[0] * b[0]) + f32(a[1] * b[1])) + f32(a[2] * b[2]))] * 4
        elif opcode == 18:
            result = [f32(f32(x * y) + f32(f32(1 - x) * z)) for x, y, z in zip(a, b, c)]
        elif opcode == 32:
            result = [f32(math.pow(abs(a[0]), b[0]))] * 4
        elif opcode == 35:
            result = list(map(abs, a))
        elif opcode == 36:
            length = math.sqrt(sum(x * x for x in a[:3]))
            assert length > 0
            result = [f32(x / length) for x in a[:3]] + [0]
        elif opcode == 88:
            result = [y if x >= 0 else z for x, y, z in zip(a, b, c)]
        else:
            raise ValueError(('Unreviewed slice opcode', offset, opcode))
        if destination & (1 << 20):
            result = [min(1, max(0, x)) for x in result]
        target = registers.setdefault((kind(destination), destination & 2047), [0] * 4)
        for channel in range(4):
            if destination & (1 << (16 + channel)):
                target[channel] = f32(result[channel])
    return registers


def customweapon_albedo_upload(elf, x):
    """Original parameter slot, piecewise reciprocal, and complete c3 writer."""
    assert elf.cstring(elf.rip(0x2dfa0, '48 8d 05')) == '$PHONGALBEDOFACTOR'
    elf.check(0x2dfd0, '89 05')
    factor_global = 0x2dfd6 + struct.unpack('<i', elf.code(0x2dfd2, 4))[0]
    assert factor_global == 0x361588
    elf.check(0x64edd, '8b 05')
    assert 0x64ee3 + struct.unpack('<i', elf.code(0x64edf, 4))[0] == factor_global
    assert struct.unpack('<f', elf.code(0x65e65 + 0xad19f, 4))[0] == 1
    assert struct.unpack('<d', elf.code(0x666c7 + 0xaf941, 8))[0] == 1
    u = x.emulator(elf)
    frame, info, params, variables, context, stream = [x.BASE + offset for offset in (0xe000, 0x1000, 0x2000, 0x3000, 0x4000, 0x8000)]
    u.mem_write(factor_global, struct.pack('<i', 3))
    u.emu_start(0x64e00, 0x64f37, count=200)
    assert u.reg_read(UC_X86_REG_RIP) == 0x64f37
    assert struct.unpack('<i', u.mem_read(frame - 0x90 + 0x64, 4))[0] == 3
    for offset, index in ((0x3c, 0), (0x40, 1), (0x44, 2), (0x64, 3)):
        u.mem_write(info + offset, struct.pack('<i', index))
        u.mem_write(params + 8 * index, struct.pack('<Q', variables + 64 * index))
    cases = []
    for factor in (-1., 0., .25, 1., 2., 35.):
        values = [.588235, .019608, .2, factor]
        for index, value in enumerate(values):
            u.mem_write(variables + 64 * index + 0x14, struct.pack('<f', value))
        u.reg_write(UC_X86_REG_R12, info)
        u.reg_write(UC_X86_REG_R13, params)
        u.emu_start(0x65abf, 0x65ae4, count=20)
        assert u.reg_read(UC_X86_REG_RIP) == 0x65ae4
        assert struct.unpack('<f', u.mem_read(frame - 0x238, 4))[0] == factor
        u.mem_write(frame - 0x20c, struct.pack('<f', 1))
        u.mem_write(frame - 0x208, struct.pack('<i', 7))
        u.mem_write(context + 0x330, struct.pack('<Q', stream))
        u.reg_write(UC_X86_REG_RBX, context)
        # Includes c2 emission, original reciprocal branch, and c3 emission.
        u.emu_start(0x66633, 0x667d6, count=150)
        assert u.reg_read(UC_X86_REG_RIP) == 0x667d6
        command = struct.unpack('<3I4f', u.mem_read(stream + 28, 28))
        expected = f32(1 / factor) if factor > 1 else factor
        assert command == (3, 3, 1, expected, *map(f32, values[:3]))
        cases.append({'materialPhongAlbedoFactor': factor, 'nativeC3': list(command[3:])})
    return {'nameXref': '0x2dfa0', 'indexGlobal': hex(factor_global), 'infoBuilderSpan': ['0x64e00', '0x64f37'], 'infoOffset': '0x64', 'materialReadSpan': ['0x65abf', '0x65ae4'], 'commandSpan': ['0x66633', '0x667d6'], 'reciprocalInstructions': ['0x666b9: jbe 0x67c90', '0x666bf: movsd xmm0, [double 1.0]', '0x666cb: cvtss2sd xmm1, xmm6', '0x666cf: divsd xmm0, xmm1', '0x666d3: cvtsd2ss xmm0, xmm0', '0x67c90: movss xmm0, [rbp-0x238]'], 'formula': 'factor > 1 ? float32(1.0 / float32(factor)) : float32(factor)', 'cases': cases}


def client_clone_evidence(m, x, vmt):
    """Execute original successful-load clone branches; KV I/O is explicit ABI."""
    elf = m.ELF(ROOT / '.reference-assets/csgo-legacy/csgo/bin/linux64/client_client.so')
    assert m.sha(elf.data) == 'c47c64c38a066e02bdc006ac4db4fe6e9a318fdd896153accb7af9bd065b7fb5'
    source_path = ROOT / '.reference-assets/source-exports/ak47-redline-inputs/inputs.json'
    source = json.loads(source_path.read_text())
    kit_values, defaults = source['paintKit'], source['paintKitDefaults']
    assert source['paintKitId'] == 282 and kit_values['style'] == '7'
    original_material = {key.lower(): value for key, value in re.findall(r'"([^"\r\n]+)"\s+"([^"\r\n]+)"', vmt.decode())}
    assert original_material['$phongboost'] == '2' and original_material['$phongalbedoboost'] == '35'
    for address, name in ((0xd140c0, 'phongexponent'), (0xd140dd, 'phongalbedoboost'), (0xd140fd, 'phongintensity'),
                          (0xf52782, '$phongalbedoboost'), (0xf527f3, '$phongboost'), (0xf52961, '$phongalbedotint'),
                          (0xf52976, '$phongalbedoboost')):
        assert elf.cstring(elf.rip(address, '48 8d 35')) == name
    for address, target in ((0xd140d8, 0x134f910), (0xd140f8, 0x134f910), (0xd14118, 0x134f910),
                            (0xf527b2, 0x134faf0), (0xf52807, 0x134faf0), (0xf529bb, 0x134faf0),
                            (0xf52968, 0x1350800), (0xf5297d, 0x1350d20), (0xf5299b, 0x1350d20),
                            (0xf528e4, 0x134fd20), (0xf52917, 0x134fd20)):
        assert elf.jump(address, 'e8') == target
    u = x.emulator(elf)
    obj, kit, default_kit, material_ptr, frame = [x.BASE + offset for offset in (0x1000, 0x3000, 0x3400, 0x5000, 0xe000)]
    current = {'material': {}, 'events': [], 'schema': {}}

    def float_register(register):
        return struct.unpack('<f', struct.pack('<I', u.reg_read(register) & 0xffffffff))[0]

    def hook(uc, address, size, data):
        schema_calls = (0xd140d8, 0xd140f8, 0xd14118)
        getters = (0xf527b2, 0xf52807, 0xf529bb)
        int_setters, float_setters, string_setters = (0xf52968,), (0xf5297d, 0xf5299b), (0xf528e4, 0xf52917)
        if address not in (*schema_calls, *getters, *int_setters, *float_setters, *string_setters):
            return
        name = elf.cstring(uc.reg_read(UC_X86_REG_RSI))
        if address in schema_calls:
            default = struct.unpack('<i', struct.pack('<I', uc.reg_read(UC_X86_REG_RDX) & 0xffffffff))[0]
            value = int(current['schema'].get(name, default))
            uc.reg_write(UC_X86_REG_RAX, value & 0xffffffff)
            event = {'operation': 'getSchemaInt', 'name': name, 'default': default, 'value': value}
        elif address in getters:
            default = float_register(UC_X86_REG_XMM0)
            value = f32(float(current['material'].get(name, default)))
            uc.reg_write(UC_X86_REG_XMM0, struct.unpack('<I', struct.pack('<f', value))[0])
            event = {'operation': 'getMaterialFloat', 'name': name, 'default': default, 'value': value}
        else:
            if address in int_setters:
                value = uc.reg_read(UC_X86_REG_RDX) & 0xffffffff
            elif address in float_setters:
                value = float_register(UC_X86_REG_XMM0)
            else:
                value = elf.cstring(uc.reg_read(UC_X86_REG_RDX))
            current['material'][name] = value
            event = {'operation': 'setMaterialValue', 'name': name, 'value': value}
        current['events'].append({'at': hex(address), **event})
        uc.reg_write(UC_X86_REG_RIP, address + 5)

    u.hook_add(UC_HOOK_CODE, hook, begin=0xd140d8, end=0xd14118)
    u.hook_add(UC_HOOK_CODE, hook, begin=0xf527b2, end=0xf529bb)
    cases = []
    diagnostics = [(7, -1, 35, 2), (7, -1, -1, 2), (7, 8, 35, 2), (7, -1, 35, 1), (7, -1, 35, 0),
                   *[(style, -1, 35, 2) for style in (1, 4, 5, 6, 8, 9)]]
    for style, kit_albedo, original_albedo, original_boost in diagnostics:
        current['events'] = []
        current['schema'] = dict(kit_values)
        if kit_albedo != -1:
            current['schema']['phongalbedoboost'] = kit_albedo
        current['material'] = {**original_material, '$phongalbedoboost': original_albedo, '$phongboost': original_boost}
        u.mem_write(obj, bytes(0x1000))
        u.mem_write(kit, bytes(0x200))
        u.mem_write(default_kit, bytes(0x200))
        for offset, value in ((0xe9, int(defaults['phongexponent'])), (0xea, int(defaults['phongalbedoboost']) + 1), (0xeb, int(defaults['phongintensity']))):
            u.mem_write(default_kit + offset, bytes([value]))
        u.reg_write(UC_X86_REG_RBX, default_kit)
        u.reg_write(UC_X86_REG_R12, material_ptr)
        u.reg_write(UC_X86_REG_R13, kit)
        u.emu_start(0xd140c0, 0xd1412e, count=100)
        assert u.reg_read(UC_X86_REG_RIP) == 0xd1412e
        encoded = list(u.mem_read(kit + 0xe9, 3))
        assert encoded == [150, kit_albedo + 1, 10]
        u.reg_write(UC_X86_REG_RBX, obj)
        u.reg_write(UC_X86_REG_R12, kit)
        u.emu_start(0xf52c18, 0xf52c22, count=10)
        u.emu_start(0xf52d75, 0xf52dad, count=100)
        assert u.reg_read(UC_X86_REG_RIP) == 0xf52dad
        assert struct.unpack('<3i', u.mem_read(obj + 0x9f4, 12)) == (kit_albedo, 150, 10)
        u.mem_write(obj + 0x9bc, struct.pack('<i', style))
        u.mem_write(frame - 0x38, struct.pack('<Q', material_ptr))
        u.reg_write(UC_X86_REG_R13, 0)  # optional normal-map append disabled.
        u.emu_start(0xf5277c, 0xf5291c, count=1000)
        assert u.reg_read(UC_X86_REG_RIP) == 0xf5291c
        factor, intensity = struct.unpack('<fi', u.mem_read(obj + 0xc44, 8))
        expected_intensity = int(f32(10 / original_boost)) if original_boost > 0 and style not in (4, 5, 6, 8) else 10
        assert intensity == expected_intensity
        writes = [event for event in current['events'] if event['operation'] == 'setMaterialValue']
        assert any(event['name'] == '$phongalbedoboost' for event in writes) == (style in (4, 5, 6, 8, 9))
        assert current['material']['$envmaptint'] == '[0 0 0]'
        # Continue with the original later scalar builder using the adjusted
        # object, preserving the earlier clone result rather than reseeding it.
        u.mem_write(frame - 0x7c, elf.code(0x1936e9c, 4))
        scalar_arguments = {}
        for name, start, end in (('phongIntensity', 0xf52458, 0xf5248a), ('phongExponent', 0xf524a1, 0xf524d2), ('phongAlbedoFactor', 0xf52421, 0xf52441)):
            u.emu_start(start, end, count=100)
            assert u.reg_read(UC_X86_REG_RIP) == end
            value = struct.unpack('<d', struct.pack('<Q', u.reg_read(UC_X86_REG_XMM0) & 0xffffffffffffffff))[0]
            text = format(value, '.6f')
            scalar_arguments[name] = {'nativeDoubleArgument': value, 'originalFormat': '%f', 'hostFormattedText': text, 'hostParsedFloat32': f32(float(text))}
        case = {'style': style, 'kitAlbedoBoost': kit_albedo, 'originalAlbedoBoost': original_albedo, 'originalPhongBoost': original_boost,
                'nativeSchemaBytesE9EAEB': encoded, 'nativeCompositeAlbedoFactor': factor, 'nativeCompositeIntensityInteger': intensity,
                'keyValuesABIEvents': current['events'], 'materialAfterBranch': dict(current['material']), 'laterCompositeScalarArguments': scalar_arguments}
        if not cases:
            assert factor == 35 and intensity == 5
            assert scalar_arguments['phongIntensity']['hostFormattedText'] == '0.019608'
            assert not any(event['name'] in ('$phongalbedotint', '$phongalbedoboost', '$phongboost') for event in writes)
        cases.append(case)
    # Original caller sequence: real virtual clone dispatch executes the whole
    # original clone function, then records the material-manager submission.
    # Material loading, vector allocation and manager submission are the only
    # additional external interfaces supplied by this bounded caller harness.
    vtable = elf.rip(0xf53335, '48 8d 05')
    assert vtable == 0x20d1108
    assert struct.unpack('<2Q', elf.code(vtable + 0x18, 16)) == (0xf52710, 0xf52040)
    elf.check(0xcd672b, 'ff 50 18')
    elf.check(0xcd6854, '41 ff 50 08')
    current['events'] = []
    current['material'] = dict(original_material)
    u.mem_write(obj, bytes(0x1000))
    u.mem_write(obj, struct.pack('<Q', vtable))
    u.mem_write(obj + 0x9bc, struct.pack('<i', 7))
    u.mem_write(obj + 0x9f4, struct.pack('<3if', -1, 150, 10, 1))
    u.mem_write(kit + 0x11c, struct.pack('<i', int(defaults['view_model_exponent_override_size'])))
    api, api_vtable, load_manager, load_vtable, submit_manager, submit_vtable, descriptors = [x.BASE + offset for offset in (0x6000, 0x6100, 0x6400, 0x6500, 0x6800, 0x6900, 0x9000)]
    for pointer, table in ((api, api_vtable), (load_manager, load_vtable), (submit_manager, submit_vtable)):
        u.mem_write(pointer, struct.pack('<Q', table))
    for address in (elf.rip(0xf5272e, '48 8d 05'), elf.rip(0xcd6811, '48 8d 05')):
        u.mem_write(address, struct.pack('<Q', api))
    u.mem_write(frame - 0x218, struct.pack('<Q', frame - 0x1e0))
    u.mem_write(frame - 0x260, struct.pack('<Q', kit))
    u.mem_write(frame - 0x200, struct.pack('<i', 10))
    u.mem_write(frame - 0x251, b'\0')
    caller_events, allocations = [], []

    def caller_hook(uc, address, size, data):
        if address == 0xcd672b:
            assert uc.reg_read(UC_X86_REG_RDI) == obj
            assert struct.unpack('<Q', uc.mem_read(uc.reg_read(UC_X86_REG_RAX) + 0x18, 8))[0] == 0xf52710
            caller_events.append({'at': hex(address), 'operation': 'nativeVirtualCloneCall', 'target': '0xf52710'})
            return  # execute the original call and whole original function.
        if address == 0xf52743:
            uc.reg_write(UC_X86_REG_RAX, load_manager)
        elif address == 0xf52771:
            uc.mem_write(uc.reg_read(UC_X86_REG_RDX), struct.pack('<Q', material_ptr))
            uc.reg_write(UC_X86_REG_RAX, 1)
            caller_events.append({'at': hex(address), 'operation': 'suppliedOriginalAKMaterialLoad'})
        elif address in (0xcd6772, 0xcd67b3):
            index = len(allocations)
            allocations.append(index)
            uc.mem_write(frame - 0x1e0, struct.pack('<Q', descriptors))
            uc.mem_write(frame - 0x1d0, struct.pack('<i', index + 1))
            uc.reg_write(UC_X86_REG_RAX, index)
        elif address == 0xcd6833:
            uc.reg_write(UC_X86_REG_RAX, submit_manager)
        elif address == 0xcd6854:
            assert uc.reg_read(UC_X86_REG_RSI) == material_ptr
            assert uc.reg_read(UC_X86_REG_RDX) == frame - 0x1e0
            descriptor_rows = []
            for index in range(2):
                pointer, size_log2, texture_format, composite_mode, srgb = struct.unpack('<QiiiB', uc.mem_read(descriptors + index * 24, 21))
                assert pointer == obj
                descriptor_rows.append({'samePaintableObject': True, 'sizeLog2': size_log2, 'formatEnum': texture_format, 'compositeMode': composite_mode, 'flag': srgb})
            adjusted_intensity = struct.unpack('<i', uc.mem_read(obj + 0xc48, 4))[0]
            assert adjusted_intensity == 5
            caller_events.append({'at': hex(address), 'operation': 'materialManagerSubmissionABI', 'cloneMaterialPassed': True,
                                  'intensityAlreadyAdjusted': adjusted_intensity, 'descriptors': descriptor_rows})
            uc.reg_write(UC_X86_REG_RAX, 0)
        else:
            return
        uc.reg_write(UC_X86_REG_RIP, address + size)

    for address in (0xcd672b, 0xf52743, 0xf52771, 0xcd6772, 0xcd67b3, 0xcd6833, 0xcd6854):
        u.hook_add(UC_HOOK_CODE, caller_hook, begin=address, end=address)
    u.reg_write(UC_X86_REG_RBP, frame)
    u.reg_write(UC_X86_REG_RSP, x.BASE + 0xd000)
    u.reg_write(UC_X86_REG_R13, obj)
    u.emu_start(0xcd6717, 0xcd6858, count=2000)
    assert u.reg_read(UC_X86_REG_RIP) == 0xcd6858
    assert len(caller_events) == 3 and allocations == [0, 1]
    return {'status': 'original_successful_material_load_parameter_branch_executed', 'binary': elf.identity(),
            'inputReceipt': {'file': str(source_path.relative_to(ROOT)), 'sha256': m.sha(source_path.read_bytes())},
            'schemaSpan': ['0xd140c0', '0xd1412e'], 'schemaToObjectSpan': ['0xf52d75', '0xf52dad'],
            'successfulCloneParameterSpan': ['0xf5277c', '0xf5291c'], 'redlineAKCaseIndex': 0, 'cases': cases,
            'originalCallerOrder': {'span': ['0xcd6717', '0xcd6858'], 'paintableVtable': hex(vtable), 'cloneSlot': '0x18', 'compositorBuilderSlot': '0x20',
                                    'events': caller_events, 'cloneKeyValuesABIEvents': current['events'],
                                    'boundary': 'Real client clone virtual call and full clone function execute before the recorded manager request. Material filesystem loading, dynamic vector allocation, and manager submission are explicit ABI boundaries; the full material-manager implementation and GPU scheduling are not executed.'},
            'boundary': 'Schema and material KeyValues getters/setters are explicit host ABI fixtures backed by pinned original records. The original successful material-load arithmetic and every branch execute; filesystem loading, material-manager virtual calls, full KeyValues allocation/cloning and final original GPU output do not execute.'}


def main():
    m = module('redline_phong_encoding', 'inspect-source-vhv-encoding.py')
    v = module('redline_phong_vpk', 'inventory-source-map.py')
    x = module('redline_phong_x64', 'inspect-source-prop-tint.py')
    p = module('redline_phong_ctab', 'probe-source-redline-programs.py')
    elf = m.ELF(ROOT / '.reference-assets/csgo-legacy/bin/linux64/stdshader_dx9_client.so')
    assert m.sha(elf.data) == ELF_SHA
    assert elf.cstring(elf.rip(0xaf85b, '48 8d 35')) == 'phong_ps30'
    assert elf.cstring(elf.rip(0x48128, '48 8d 05')) == '$PHONGALBEDOBOOST'
    assert elf.cstring(elf.rip(0x48298, '48 8d 05')) == '$BASEMAPALPHAPHONGMASK'
    assert elf.cstring(elf.rip(0x47f55, '48 8d 05')) == '$PHONGALBEDOTINT'
    elf.check(0x48158, '89 05 ea ce 32 00')
    elf.check(0x482c8, '89 05 7a cc 32 00')
    elf.check(0x47f85, '89 05 fd d1 32 00')

    vmt_path = ROOT / '.reference-assets/source-exports/ak47-redline-inputs/raw/materials/models/weapons/v_models/rif_ak47/ak47.vmt'
    vmt = vmt_path.read_bytes()
    assert m.sha(vmt) == VMT_SHA
    idx = v.VPKIndex(ROOT / '.reference-assets/csgo-legacy/platform/platform_pak01_dir.vpk')
    vcs_path = 'shaders/fxc/phong_ps30.vcs'
    vcs = idx.read(vcs_path)
    assert m.sha(vcs) == VCS_SHA
    code, report = m.vcs_combo(vcs, 2, 16)
    assert m.sha(code) == DX9_SHA
    program = m.instructions(code)
    asserted = {
        382: (0x04000012, 0x80080002, 0xa000001b, 0x80ff0001, 0x80ff0005),
        445: (0x03000042, 0x800f0007, 0x90e40000, 0xa0e40807),
        449: (0x03000002, 0x80020004, 0x81000007, 0xa0ff0003),
        453: (0x04000004, 0x80020004, 0x80000007, 0xa000000e, 0x80550004),
        458: (0x04000058, 0x80010004, 0x81000004, 0x80550004, 0xa0aa000a),
        675: (0x04000004, 0x8007000b, 0xa0ff0000, 0x80e40001, 0x81ff0004),
        680: (0x04000004, 0x8007000b, 0x80550007, 0x80e4000b, 0xa0ff0013),
        685: (0x04000058, 0x8007000a, 0xa000001a, 0x80e4000a, 0x80e4000b),
        430: (0x04000004, 0x80070004, 0x80e40006, 0x80aa0003, 0x80e40004),
        435: (0x02000024, 0x80070007, 0x80e40004),
        438: (0x03000008, 0x80180003, 0x80e40005, 0x80e40007),
        463: (0x03000020, 0x80080005, 0x80ff0003, 0x80000004),
    }
    for offset, expected in asserted.items():
        assert program[offset] == expected, offset
    ctab = p.ctab(code)
    constants = {row['name']: row['index'] for row in ctab['constants']}
    assert constants['SpecExponentSampler'] == 7
    assert constants['BaseTextureSampler'] == 0
    assert constants['NormalMapSampler'] == 3
    assert constants['g_SelfIllumTint_and_DetailBlendFactorOrPhongAlbedoBoost'] == 0
    assert constants['g_FresnelSpecParams'] == 19

    u = x.emulator(elf)
    frame, info, params, boost_var, tint_var, context, stream = [x.BASE + offset for offset in (0xe000, 0x1000, 0x2000, 0x3000, 0x3100, 0x4000, 0x5000)]
    # Execute the original VLG info builder with explicit registered indices.
    u.mem_write(frame - 0x250, b'\xff' * 0x21c)
    for address, index in ((0x375048, 0), (0x374f48, 2), (0x375188, 3)):
        u.mem_write(address, struct.pack('<i', index))
    u.emu_start(0xc28f4, 0xc2df1, count=500)
    assert u.reg_read(UC_X86_REG_RIP) == 0xc2df1
    native_info = u.mem_read(frame - 0x250, 0x21c)
    assert [struct.unpack_from('<i', native_info, offset)[0] for offset in (0xa8, 0xc4, 0x94)] == [0, 2, 3]

    u.mem_write(info, bytes(native_info))
    u.mem_write(info + 0x78, struct.pack('<i', 1))
    u.mem_write(params, struct.pack('<4Q', boost_var, tint_var, boost_var + 0x100, boost_var + 0x200))
    tint = list(map(f32, (.125, .25, .5)))
    u.mem_write(tint_var + 0x14, struct.pack('<3f', *tint))
    u.mem_write(frame - 0x498, struct.pack('<Q', info))
    u.mem_write(frame - 0x4a0, struct.pack('<Q', params))
    # Original writer uses the original current-material parameter-array global.
    parameter_global = elf.rip(0xaff2f, '48 8d 15')
    u.mem_write(parameter_global, struct.pack('<Q', params))
    uploads = []
    for boost in (0., 1., 2., 35.):
        u.mem_write(boost_var + 0x14, struct.pack('<f', boost))
        u.reg_write(UC_X86_REG_RAX, info)
        u.emu_start(0xb2580, 0xb25b8, count=100)
        assert u.reg_read(UC_X86_REG_RIP) == 0xb25b8
        assert struct.unpack('<f', u.mem_read(frame - 0x4f0, 4))[0] == boost
        u.reg_write(UC_X86_REG_RBX, context)
        u.reg_write(UC_X86_REG_RCX, stream)
        u.mem_write(context + 0x330, struct.pack('<Q', stream))
        u.emu_start(0xaff1b, 0xafffa, count=100)
        assert u.reg_read(UC_X86_REG_RIP) == 0xafffa
        words = struct.unpack('<3I4f', u.mem_read(stream, 28))
        assert words == (3, 0, 1, *tint, boost)
        uploads.append({'materialPhongAlbedoBoost': boost, 'nativeCommand': list(words)})

    masks = []
    for enabled in (0, 1):
        u.mem_write(boost_var + 0x110, struct.pack('<i', enabled))
        u.reg_write(UC_X86_REG_XMM1, 0)
        u.emu_start(0xb002c, 0xb005e, count=100)
        assert u.reg_read(UC_X86_REG_RIP) == 0xb005e
        actual = struct.unpack('<f', struct.pack('<I', u.reg_read(UC_X86_REG_XMM2) & 0xffffffff))[0]
        assert actual == enabled
        registers = execute_slice(program, [382], {(2, 27): [actual, 0, 0, 0], (0, 1): [0, 0, 0, .25], (0, 5): [0, 0, 0, .75]})
        expected = .25 if enabled else .75
        assert registers[(0, 2)][3] == expected
        masks.append({'baseMapAlphaPhongMask': enabled, 'nativeControlX': actual, 'baseAlpha': .25, 'normalAlpha': .75, 'interpretedMask': expected})

    exponent_cases, tint_cases, lobe_cases = [], [], []
    for red in (0, .1, .5, 150 / 255, 1):
        for override in (0, 16, 150):
            registers = execute_slice(program, [442, 449, 453, 458], {(0, 7): [red, 0, 0, 0], (2, 10): [0, 0, override, 0]})
            actual = registers[(0, 4)][0]
            expected = override or f32(f32(f32(red) * 150) + f32(1 - f32(red)))
            assert actual == expected
            exponent_cases.append({'red': f32(red), 'override': override, 'interpretedExponent': actual})
    for green in (0, .25, 1):
        for albedo_boost in (1, 35):
            for tint_value in ((-1, -1, -1), (.7, .8, 1)):
                base = list(map(f32, (.01, .2, .8)))
                registers = execute_slice(program, [668, 671, 675, 680, 685], {
                    (0, 1): [*base, 1], (0, 7): [.5, green, 0, 0],
                    (2, 0): [0, 0, 0, albedo_boost], (2, 19): [0, 0, 0, 2], (2, 26): [*tint_value, 0],
                })
                expected = [f32(f32(green * f32(f32(albedo_boost * channel) - 2)) + 2) for channel in base] if tint_value[0] < 0 else [f32(2 * f32(value)) for value in tint_value]
                actual = registers[(0, 10)][:3]
                assert actual == expected
                tint_cases.append({'baseRGB': base, 'green': green, 'phongBoost': 2, 'albedoBoost': albedo_boost, 'tintControl': list(tint_value), 'interpretedDirectTint': actual})
    for light in ((0, 0, 1), (.6, 0, .8), (1, 0, 0)):
        for red in (0, .5, 1):
            registers = execute_slice(program, [404, 408, 416, 419, 423, 427, 430, 435, 438, 442, 445, 449, 453, 458, 463, 467], {
                (0, 4): [*light, 0], (0, 5): [0, 0, 1, 0], (10, 7): [red, 0, 0, 0],
                (1, 4): [0, 0, 0, 0], (2, 11): [0, 0, 2, 0], (2, 10): [0, 0, 0, 0],
            })
            actual = registers[(0, 3)][1]
            h_dot_n = (1 + light[2]) / math.sqrt(light[0] ** 2 + light[1] ** 2 + (1 + light[2]) ** 2)
            expected = math.sqrt(max(0, light[2])) * h_dot_n ** (1 + 149 * red)
            assert abs(actual - expected) < 1e-6
            lobe_cases.append({'normal': [0, 0, 1], 'view': [0, 0, 1], 'light': list(light), 'red': red, 'interpretedLobe': actual, 'formulaDoublePrecision': expected})

    clone = client_clone_evidence(m, x, vmt)
    customweapon_albedo = customweapon_albedo_upload(elf, x)
    result = {
        'format': 'source-redline-phong-parameters-v1',
        'status': 'installed_phong_diagnostic_slices_and_native_material_upload_verified',
        'binary': elf.identity(),
        'originalAKMaterial': {'file': str(vmt_path.relative_to(ROOT)), 'bytes': len(vmt), 'sha256': VMT_SHA, 'text': vmt.decode(), 'fullFinalRedlineCloneCompared': False},
        'clientMaterialCloneParameterBranch': clone,
        'nativeCustomWeaponAlbedoUpload': customweapon_albedo,
        'program': {**report, 'file': 'phong_ps30-static2-dynamic16.dx9', 'vcsPath': vcs_path, 'vcsBytes': len(vcs), 'vcsSha256': VCS_SHA, 'ctab': ctab, 'nativeNameXref': '0xaf85b', 'exactAKSelectorVerified': False},
        'nativeInfoBuilder': {'span': ['0xc28f4', '0xc2df1'], 'registeredIndexGlobals': {'phongAlbedoBoost': '0x375048', 'baseMapAlphaPhongMask': '0x374f48', 'phongAlbedoTint': '0x375188'}, 'infoOffsets': {'phongAlbedoBoost': '0xa8', 'baseMapAlphaPhongMask': '0xc4', 'phongAlbedoTint': '0x94'}},
        'nativeAlbedoBoostUpload': {'parameterReadSpan': ['0xb2580', '0xb25b8'], 'commandSpan': ['0xaff1b', '0xafffa'], 'currentMaterialParameterGlobal': hex(parameter_global), 'cases': uploads},
        'nativeBaseAlphaControl': {'span': ['0xb002c', '0xb005e'], 'destination': 'xmm2, subsequently c27.x', 'cases': masks},
        'assertedTokensByDwordOffset': {str(key): list(value) for key, value in asserted.items()},
        'portableSliceCases': {'exponent': exponent_cases, 'directTint': tint_cases, 'directLobe': lobe_cases},
        'formulasInDiagnosticProgram': {
            'exponent': 'c10.z == 0 ? (1-R)+150*R : c10.z',
            'mask': 'lerp(baseAlpha, normalAlpha, 1-c27.x); later c10.y can select baseRGB luminance instead',
            'directTint': 'c26.x < 0 ? mix(vec3(c19.w), baseRGB*c0.w, exponent.G) : c19.w*c26.rgb',
            'directLobe': 'sqrt(saturate(NdotL)) * pow(saturate(dot(N,normalize(V+L))), exponent)',
        },
        'boundary': [
            'The original installed Phong specimen is static2/dynamic16, not a verified final AK runtime selector.',
            'Original successful-load Redline clone parameter branches execute with explicit KeyValues I/O; full original material loading/cloning and the exact final AK shader selector remain unverified.',
            'Native uploads use explicit material-variable fixtures; no engine, OS, real inventory, or GPU is executed.',
            'Portable token slices consume explicit inputs with separate f32 MAD products; host normalization/pow are not original D3D precision proofs.',
            'This is not complete VertexLitGeneric, original lighting, cubemap, framebuffer, or final-client pixel parity.',
        ],
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / result['program']['file']).write_bytes(code)
    (OUT / 'phong_ps30-static2-dynamic16.tokens.txt').write_text(m.shader_text(code))
    receipt = OUT / 'phong-parameters.json'
    receipt.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'status': result['status'], 'nativeUploadCases': len(uploads), 'nativeCustomWeaponAlbedoCases': len(customweapon_albedo['cases']), 'nativeMaskCases': len(masks), 'nativeClientCloneParameterCases': len(clone['cases']), 'redlineAKCompositeIntensityInteger': clone['cases'][0]['nativeCompositeIntensityInteger'], 'portableSliceCases': sum(map(len, (exponent_cases, tint_cases, lobe_cases))), 'programSha256': DX9_SHA, 'receipt': str(receipt.relative_to(ROOT)), 'receiptSha256': m.sha(receipt.read_bytes()), 'receiptBytes': receipt.stat().st_size}, indent=2))


if __name__ == '__main__':
    main()
