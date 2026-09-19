"""Native closure of the four original style-5 paint kits with albedo boost zero.

Writes a dedicated receipt; preserves the historical ten-kit style-5 evidence.
"""
from pathlib import Path
import ctypes
import math
import hashlib
import importlib.util
import json
import re
import struct
import sys

from unicorn import UC_HOOK_CODE
from unicorn.x86_const import (UC_X86_REG_RAX, UC_X86_REG_RBX, UC_X86_REG_RDX,
                              UC_X86_REG_RSI, UC_X86_REG_RIP, UC_X86_REG_R12,
                              UC_X86_REG_R13, UC_X86_REG_R14, UC_X86_REG_XMM0)

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.reference-assets/source-exports/fidelity-paint-20260913/zero-albedo'
sha = lambda value: hashlib.sha256(value).hexdigest()
f32 = lambda value: struct.unpack('<f', struct.pack('<f', value))[0]


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    result = importlib.util.module_from_spec(spec)
    sys.modules[name] = result
    spec.loader.exec_module(result)
    return result


def main():
    m = module('style5_encoding', 'inspect-source-vhv-encoding.py')
    x = module('style5_x64', 'inspect-source-prop-tint.py')
    v = module('style5_vpk', 'inventory-source-map.py')
    client = m.ELF(ROOT / '.reference-assets/csgo-legacy/csgo/bin/linux64/client_client.so')
    shader = m.ELF(ROOT / '.reference-assets/csgo-legacy/bin/linux64/stdshader_dx9_client.so')
    assert sha(client.data) == 'c47c64c38a066e02bdc006ac4db4fe6e9a318fdd896153accb7af9bd065b7fb5'
    assert sha(shader.data) == '0383c51766a4681b5de26aa79b67ade5d3a867a8622185abe8a090877bac7c2e'
    for at, name in ((0xd140c0, 'phongexponent'), (0xd140dd, 'phongalbedoboost'),
                     (0xd140fd, 'phongintensity'), (0xf52782, '$phongalbedoboost'),
                     (0xf527f3, '$phongboost'), (0xf52961, '$phongalbedotint'),
                     (0xf52976, '$phongalbedoboost')):
        assert client.cstring(client.rip(at, '48 8d 35')) == name
    catalogue_path = ROOT / 'public/source/csgo-12426148/skins/paint-kits.json'
    catalogue = json.loads(catalogue_path.read_text())
    defaults = catalogue['paintKitDefaults']
    weapons = {'weapon_m4a1': [471], 'weapon_deagle': [468, 469, 470]}
    content = v.VPKIndex(ROOT / '.reference-assets/csgo-legacy/csgo/pak01_dir.vpk')
    u = x.emulator(client)
    obj, kit, default, material, frame = [x.BASE + n for n in (0x1000, 0x3000, 0x3400, 0x5000, 0xe000)]
    current = {}

    def hook(uc, at, size, data):
        schema_calls = (0xd140d8, 0xd140f8, 0xd14118)
        getters = (0xf527b2, 0xf52807, 0xf529bb)
        if at not in (*schema_calls, *getters, 0xf52968, 0xf5297d, 0xf5299b, 0xf528e4):
            return
        name = client.cstring(uc.reg_read(UC_X86_REG_RSI))
        if at in schema_calls:
            value = int(current['schema'][name])
            uc.reg_write(UC_X86_REG_RAX, value & 0xffffffff)
            operation = 'getSchemaInt'
        elif at in getters:
            value = f32(float(current['material'].get(name, -1 if name == '$phongalbedoboost' else 1)))
            uc.reg_write(UC_X86_REG_XMM0, struct.unpack('<I', struct.pack('<f', value))[0])
            operation = 'getMaterialFloat'
        else:
            value = (uc.reg_read(UC_X86_REG_RDX) if at == 0xf52968 else
                     client.cstring(uc.reg_read(UC_X86_REG_RDX)) if at == 0xf528e4 else
                     struct.unpack('<f', struct.pack('<I', uc.reg_read(UC_X86_REG_XMM0) & 0xffffffff))[0])
            current['material'][name] = value
            operation = 'setMaterialValue'
        current['events'].append(dict(at=hex(at), operation=operation, name=name, value=value))
        uc.reg_write(UC_X86_REG_RIP, at + 5)

    u.hook_add(UC_HOOK_CODE, hook, begin=0xd140d8, end=0xd14118)
    u.hook_add(UC_HOOK_CODE, hook, begin=0xf527b2, end=0xf529bb)
    su = x.emulator(shader)
    su.reg_write(UC_X86_REG_R14, x.BASE)
    cases = []
    for weapon, ids in weapons.items():
        receipt = json.loads((ROOT / f'public/source/csgo-12426148/kit-inputs-fidelity-20260913/{weapon}/inputs.json').read_text())
        material_path, source_material = next((key, value) for key, value in receipt['materials'].items()
                                             if '/v_models/' in key)
        raw = content.read(material_path)
        assert sha(raw) == source_material['sha256']
        # Strip comments: a commented material default is not a real parameter.
        text = re.sub(r'//[^\r\n]*', '', raw.decode())
        original = {key.lower(): value for key, value in re.findall(r'"([^"\r\n]+)"\s+"([^"\r\n]+)"', text)}
        finishes = next(row for row in catalogue['weapons'] if row['weapon'] == weapon)['finishes']
        for id_ in ids:
            entry = next(row for row in finishes if int(row['id']) == id_)
            assert entry['style'] == 5 and entry['phongAlbedoBoost'] == 0
            current.update(material=dict(original), events=[], schema={
                'phongexponent': entry['phongExponent'], 'phongintensity': entry['phongIntensity'],
                'phongalbedoboost': entry['phongAlbedoBoost']})
            for address, size in ((obj, 0x1000), (kit, 0x200), (default, 0x200)):
                u.mem_write(address, bytes(size))
            for offset, key, delta in ((0xe9, 'phongexponent', 0), (0xea, 'phongalbedoboost', 1), (0xeb, 'phongintensity', 0)):
                u.mem_write(default + offset, bytes([int(defaults[key]) + delta]))
            u.reg_write(UC_X86_REG_RBX, default)
            u.reg_write(UC_X86_REG_R12, material)
            u.reg_write(UC_X86_REG_R13, kit)
            u.emu_start(0xd140c0, 0xd1412e, count=100)
            assert u.reg_read(UC_X86_REG_RIP) == 0xd1412e
            u.reg_write(UC_X86_REG_RBX, obj)
            u.reg_write(UC_X86_REG_R12, kit)
            u.emu_start(0xf52c18, 0xf52c22, count=10)
            u.emu_start(0xf52d75, 0xf52dad, count=100)
            assert u.reg_read(UC_X86_REG_RIP) == 0xf52dad
            u.mem_write(obj + 0x9bc, struct.pack('<i', entry['style']))
            u.mem_write(frame - 0x38, struct.pack('<Q', material))
            u.reg_write(UC_X86_REG_R13, 0)
            u.emu_start(0xf5277c, 0xf5291c, count=1000)
            assert u.reg_read(UC_X86_REG_RIP) == 0xf5291c
            factor, intensity = struct.unpack('<fi', u.mem_read(obj + 0xc44, 8))
            scalars = {}
            u.mem_write(frame - 0x7c, client.code(0x1936e9c, 4))
            for name, start, end in (('phongIntensity', 0xf52458, 0xf5248a),
                                     ('phongExponent', 0xf524a1, 0xf524d2),
                                     ('phongAlbedoFactor', 0xf52421, 0xf52441)):
                u.emu_start(start, end, count=100)
                assert u.reg_read(UC_X86_REG_RIP) == end
                value = struct.unpack('<d', struct.pack('<Q', u.reg_read(UC_X86_REG_XMM0) & 0xffffffffffffffff))[0]
                formatted = format(value, '.6f')
                scalars[name] = dict(nativeDoubleArgument=value, originalFormat='%f',
                                     hostFormattedText=formatted, hostParsedFloat32=f32(float(formatted)))
            selectors = {}
            for mode, name in ((0, 'color'), (1, 'exponent')):
                su.mem_write(frame - 0x201, b'\0')
                su.mem_write(frame - 0x24c, b'\0')
                su.mem_write(frame - 0x238, struct.pack('<f', scalars['phongAlbedoFactor']['hostParsedFloat32']))
                su.mem_write(frame - 0x208, struct.pack('<I', entry['style']))
                su.mem_write(frame - 0x250, struct.pack('<I', mode))
                su.mem_write(frame - 0x244, struct.pack('<I', 0))
                su.emu_start(0x65c3e, 0x65cb1, count=100)
                assert su.reg_read(UC_X86_REG_RIP) == 0x65cb1
                combined = su.reg_read(UC_X86_REG_RDX)
                selectors[name] = dict(nativeCombined=combined, static=combined // 5, dynamic=0)
            assert factor == math.inf and scalars['phongAlbedoFactor']['hostFormattedText'] == 'inf'
            assert [selectors[key]['static'] for key in ('color', 'exponent')] == [5, 15]
            assert intensity == entry['phongIntensity']
            assert float(current['material']['$phongalbedoboost']) == max(float(original['$phongalbedoboost']), entry['phongAlbedoBoost'])
            assert current['material']['$phongalbedotint'] == 1
            cases.append(dict(weapon=weapon, paintKitId=id_, kit=entry, materialSource=material_path,
                              materialSha256=sha(raw), originalMaterial=original, phong=receipt['phong'],
                              nativeCompositeAlbedoFactor=factor, nativeCompositeIntensityInteger=intensity,
                              materialAfterBranch=dict(current['material']), keyValuesABIEvents=current['events'],
                              laterCompositeScalarArguments=scalars, selectors=selectors))
    parser = material_parser(m, x)
    upload = shader_upload(shader, x, cases)
    result = dict(format='source-paint-zero-albedo-native-v1',
                  status='native-clone-material-parser-selector-and-c3-executed',
                  client=client.identity(), shader=shader.identity(),
                  catalogueSha256=sha(catalogue_path.read_bytes()), cases=cases,
                  materialParser=parser, shaderUpload=upload,
                  boundary='Original installed x86 code executes with explicit schema/KeyValues fixtures. '
                           'Original %f argument is formatted by host; original material-system strtod import '
                           'is supplied by host libc, and native float-type selection and storage execute. '
                           'Infinity is encoded as a string only in this JSON receipt; GPU c3 is finite zero. '
                           'Original-client GPU output and compressed texture bytes are not compared.')
    encoded = json.dumps(json_safe(result), indent=2, allow_nan=False) + '\n'
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'evidence.json').write_text(encoded)
    (ROOT / 'research/source-paint-zero-albedo.json').write_text(encoded)
    print(json.dumps(dict(cases=len(cases), materialParser=parser, shaderUpload=upload), default=str))


def json_safe(value):
    if isinstance(value, float) and not math.isfinite(value):
        assert value == math.inf
        return 'Infinity'
    if isinstance(value, dict): return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, list): return [json_safe(item) for item in value]
    return value


def material_parser(m, x):
    elf = m.ELF(ROOT / '.reference-assets/csgo-legacy/bin/linux64/materialsystem_client.so')
    assert sha(elf.data) == '7dfca3caa8ea59bf7b9188a370683f3f1dec6a382dd5f572277be3a55286767d'
    # Vtable identity and branch/float setter are the original CMaterialVar methods.
    assert struct.unpack('<Q', elf.code(0x3737f0 + 0xc0, 8))[0] == 0x3cb50
    assert struct.unpack('<Q', elf.code(0x3737f0 + 0x20, 8))[0] == 0x3e540
    assert elf.jump(0x3cb99, 'e8') == 0x259c0
    # Resolve the PLT target through the shipped ELF relocation and symbol tables.
    elftools = __import__('elftools.elf.elffile', fromlist=['ELFFile'])
    import io
    parsed = elftools.ELFFile(io.BytesIO(elf.data))
    elf.check(0x259c0, 'ff 25')
    got = 0x259c6 + struct.unpack('<i', elf.code(0x259c2, 4))[0]
    rels = parsed.get_section_by_name('.rela.plt')
    relocation = next(r for r in rels.iter_relocations() if r['r_offset'] == got)
    imported = parsed.get_section(rels['sh_link']).get_symbol(relocation['r_info_sym']).name
    assert imported == 'strtod'
    text = ctypes.create_string_buffer(b'inf')
    end = ctypes.c_void_p()
    libc = ctypes.CDLL(None)
    libc.strtod.argtypes = [ctypes.c_char_p, ctypes.POINTER(ctypes.c_void_p)]
    libc.strtod.restype = ctypes.c_double
    parsed_value = libc.strtod(text, ctypes.byref(end))
    consumed = end.value - ctypes.addressof(text)
    assert parsed_value == math.inf and consumed == 3
    u = x.emulator(elf)
    frame, material, source = [x.BASE + n for n in (0xe000, 0x1000, 0x2000)]
    u.mem_write(material, struct.pack('<Q', 0x3737f0))
    u.mem_write(source, b'inf\0')
    u.mem_write(frame - 0xc0, struct.pack('<Q', source + consumed))
    u.mem_write(frame - 0xc8, struct.pack('<Q', source))
    u.reg_write(UC_X86_REG_RBX, source + 3)
    u.reg_write(UC_X86_REG_R13, material)
    u.reg_write(UC_X86_REG_XMM0, struct.unpack('<Q', struct.pack('<d', parsed_value))[0])
    u.emu_start(0x3cb9e, 0x3d107, count=50)
    assert u.reg_read(UC_X86_REG_RIP) == 0x3d107
    bits = u.reg_read(UC_X86_REG_XMM0) & 0xffffffff
    assert bits == 0x7f800000
    # SetStringValue uses the same imported strtod then stores float32 at +0x14.
    assert elf.jump(0x3ec3e, 'e8') == 0x259c0
    u.reg_write(UC_X86_REG_R14, material)
    u.reg_write(UC_X86_REG_XMM0, struct.unpack('<Q', struct.pack('<d', parsed_value))[0])
    u.emu_start(0x3ec43, 0x3ec62, count=30)
    assert u.reg_read(UC_X86_REG_RIP) == 0x3ec62
    assert struct.unpack('<4I', u.mem_read(material + 0x14, 16)) == (bits,) * 4
    return dict(materialSystem=elf.identity(), importName=imported, importPLT=hex(0x259c0),
                originalText='inf', hostLibcConsumedBytes=consumed,
                nativeFloatTypeSelectionSpan=['0x3cb9e', '0x3d107'],
                nativeStringStorageSpan=['0x3ec43', '0x3ec62'],
                nativeFloat32Bits=hex(bits), nativeFloat32='Infinity')


def shader_upload(elf, x, cases):
    assert elf.cstring(elf.rip(0x2dfa0, '48 8d 05')) == '$PHONGALBEDOFACTOR'
    elf.check(0x2dfd0, '89 05')
    assert 0x2dfd6 + struct.unpack('<i', elf.code(0x2dfd2, 4))[0] == 0x361588
    u = x.emulator(elf)
    frame, info, params, variables, context, stream = [x.BASE + n for n in (0xe000, 0x1000, 0x2000, 0x3000, 0x4000, 0x8000)]
    u.mem_write(0x361588, struct.pack('<i', 3))
    u.emu_start(0x64e00, 0x64f37, count=200)
    assert u.reg_read(UC_X86_REG_RIP) == 0x64f37
    assert struct.unpack('<i', u.mem_read(frame - 0x90 + 0x64, 4))[0] == 3
    for offset, index in ((0x3c, 0), (0x40, 1), (0x44, 2), (0x64, 3)):
        u.mem_write(info + offset, struct.pack('<i', index))
        u.mem_write(params + 8 * index, struct.pack('<Q', variables + 64 * index))
    results = []
    for case in cases:
        scalars = case['laterCompositeScalarArguments']
        values = [scalars['phongExponent']['hostParsedFloat32'], scalars['phongIntensity']['hostParsedFloat32'],
                  f32(case['kit']['wearMinimum']), math.inf]
        for index, value in enumerate(values):
            u.mem_write(variables + 64 * index + 0x14, struct.pack('<f', value))
        u.reg_write(UC_X86_REG_R12, info)
        u.reg_write(UC_X86_REG_R13, params)
        u.emu_start(0x65abf, 0x65ae4, count=20)
        assert u.reg_read(UC_X86_REG_RIP) == 0x65ae4
        assert struct.unpack('<f', u.mem_read(frame - 0x238, 4))[0] == math.inf
        u.mem_write(frame - 0x20c, struct.pack('<f', 1))
        u.mem_write(frame - 0x208, struct.pack('<i', 5))
        u.mem_write(context + 0x330, struct.pack('<Q', stream))
        u.reg_write(UC_X86_REG_RBX, context)
        u.emu_start(0x66633, 0x667d6, count=150)
        assert u.reg_read(UC_X86_REG_RIP) == 0x667d6
        command = struct.unpack('<3I4f', u.mem_read(stream + 28, 28))
        assert command == (3, 3, 1, 0., *values[:3])
        assert struct.unpack('<I', u.mem_read(stream + 40, 4))[0] == 0
        results.append(dict(weapon=case['weapon'], paintKitId=case['paintKitId'],
                            nativeMaterialFactor='Infinity', nativeC3=list(command[3:]), factorBits='0x00000000'))
    return dict(materialReadSpan=['0x65abf', '0x65ae4'], commandSpan=['0x66633', '0x667d6'],
                formula='float32(1.0 / +Infinity) = +0', cases=results)


if __name__ == '__main__': main()
