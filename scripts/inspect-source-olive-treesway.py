"""Original App740 OLIVE TREESWAY selector, constants and real-prop token fixtures.

Run with .tools/source-binary-venv/bin/python. Native execution is limited to
asserted arithmetic/command-writing blocks, never engine/OS calls. The shader
oracle is a separate generic float32 token interpreter, not a GPU emulator.
"""
from pathlib import Path
import hashlib
import importlib.util
import json
import math
import struct
import sys
import zipfile
from unicorn.x86_const import (UC_X86_REG_R12, UC_X86_REG_R13, UC_X86_REG_R14,
    UC_X86_REG_RBX, UC_X86_REG_RAX, UC_X86_REG_RDX, UC_X86_REG_RIP,
    UC_X86_REG_XMM0, UC_X86_REG_XMM1, UC_X86_REG_XMM2)

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.reference-assets/source-exports/dust2-foliage-audit/olive-power/treesway'
VHV = ROOT / '.reference-assets/source-exports/dust2-vhv'
NAMES = ['olive_branch_01']
PREFIX = 'models/props/de_dust/hr_dust/foliage/'


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def sha(raw): return hashlib.sha256(raw).hexdigest()


def main():
    OUT.mkdir(exist_ok=True)
    e = module('tree_original_encoding', 'inspect-source-vhv-encoding.py')
    t = module('tree_native_tools', 'inspect-source-prop-tint.py')
    oracle = module('tree_float_oracle', 'source-treesway-token-oracle.py')
    index = module('tree_original_index', 'inventory-source-map.py')
    shader = e.ELF(ROOT / '.reference-assets/csgo-legacy/bin/linux64/stdshader_dx9_client.so')
    assert shader.cstring(shader.rip(0x49920, '48 8d 05')) == '$TREESWAY'
    shader.check(0x49949, '89 05 b9 a6 32 00')
    shader.check(0xc41f9, '8b 05 09 fe 2a 00 89 85 58 ff ff ff')
    shader.check(0xc4dca, '49 63 84 24 98 01 00 00')
    shader.check(0xce58e, '8b 85 f4 fa ff ff 8d 04 40 c1 e0 0b')
    assert shader.cstring(shader.rip(0xc9f38, '48 8d 35')) == 'vertexlit_and_unlit_generic_vs30'
    shader.check(0xc6db3, 'c7 40 04 0c 00 00 00')
    shader.check(0xc8deb, 'be 03 00 00 00')
    base, frame = t.BASE, t.BASE+0xe000
    uc = t.emulator(shader)
    for i in range(16):
        uc.mem_write(base+0x198+i*4, struct.pack('<i', i))
        uc.mem_write(base+0x1000+i*8, struct.pack('<Q', base+0x4000+i*64))
    uc.reg_write(UC_X86_REG_R12, base)
    uc.reg_write(UC_X86_REG_R13, base+0x1000)
    uc.reg_write(UC_X86_REG_RBX, base+0x2000)
    uc.reg_write(UC_X86_REG_R14, base+0x7000)
    selections = []
    for mode in (-2, 0, 1, 2, 3):
        uc.mem_write(frame-0x600, bytes(0x600))
        uc.mem_write(base+0x4010, struct.pack('<i', mode))
        uc.reg_write(UC_X86_REG_RDX, 0)
        uc.emu_start(0xc4dca, 0xc4e1d, count=50)
        assert uc.reg_read(UC_X86_REG_RIP) == 0xc4e1d
        uc.emu_start(0xce580, 0xc9ead, count=60)
        assert uc.reg_read(UC_X86_REG_RIP) == 0xc9ead
        uc.mem_write(frame-0x4a8, struct.pack('<Q', base+0x2000))
        uc.emu_start(0xc9ead, 0xc9f4c, count=100)
        assert uc.reg_read(UC_X86_REG_RIP) == 0xc9f4c
        combined = uc.reg_read(UC_X86_REG_RDX)
        assert combined == min(2, max(0, mode))*6144
        selections.append({'treesway': mode, 'combinedStaticIndex': combined, 'staticRecord': combined//48})

    # Sentinel values demonstrate that the native commands select each source
    # parameter rather than merely mirroring a hard-coded expected array.
    def static_constants(values):
        for i, value in enumerate(values):
            uc.mem_write(base+0x4014+i*64, struct.pack('<f', value))
        uc.mem_write(frame-0x4d4, struct.pack('<i', 1))
        constants = {}
        for start, end in [(0xc5d81, 0xc5e90), (0xc63f8, 0xc64d5), (0xc8017, 0xc824a)]:
            uc.mem_write(base+0x2330, struct.pack('<Q', base+0x5000))
            uc.reg_write(UC_X86_REG_RAX, base+0x5000)
            uc.emu_start(start, end, count=400)
            assert uc.reg_read(UC_X86_REG_RIP) == end
            stop = struct.unpack('<Q', uc.mem_read(base+0x2330, 8))[0]
            payload = bytes(uc.mem_read(base+0x5000, stop-base-0x5000))
            assert len(payload) % 28 == 0
            for at in range(0, len(payload), 28):
                command, register, count, *value = struct.unpack_from('<3I4f', payload, at)
                assert command == 4 and count == 1
                constants[register] = value
        return constants
    sentinel = static_constants(list(range(100, 116)))
    assert sentinel == {51: [106., 112., 111., 108.], 52: [113., 114., 0., 0.],
                        14: [101., 102., 103., 104.], 15: [105., 107., 110., 109.]}
    parameters = [1, 10, .5, 100, 0, .2, 0, .15, 1.2, .15, 2, 2, 3, 200, 800, 0]
    constants = static_constants(parameters)
    dynamic = []
    for time, wind in [(0, [0, 0]), (.125, [2, 0]), (1.75, [-3, 4]), (1234.5, [6, -6])]:
        uc.mem_write(frame-0x48, struct.pack('<Q', base+0x5000))
        uc.mem_write(frame-0x4f4, struct.pack('<f', 0))
        for register, fmt, value in [(UC_X86_REG_XMM0, '<f', wind[1]), (UC_X86_REG_XMM1, '<f', wind[0]), (UC_X86_REG_XMM2, '<d', time)]:
            uc.reg_write(register, int.from_bytes(struct.pack(fmt, value), 'little'))
        uc.emu_start(0xc6d8d, 0xc6e1d, count=100)
        command = struct.unpack('<3I4f', uc.mem_read(base+0x5000, 28))
        assert command[:3] == (4, 12, 1) and command[3:] == (0., oracle.f(time), float(wind[0]), float(wind[1]))
        dynamic.append({'time': time, 'windSourceXY': wind, 'c12': list(command[3:])})

    raw_vs = (VHV / 'encoding/non-bump/vertexlit_and_unlit_generic_vs30.vcs').read_bytes()
    code, program = e.vcs_combo(raw_vs, 128, 0)
    assert sha(code) == 'fd2c99952aeab40ff76657d19bba4140e9bb575061dafc3040b0b688670611e0'
    (OUT/'vs30-static128-dynamic0.dx9').write_bytes(code)
    (OUT/'vs30-static128-dynamic0.tokens.txt').write_text(e.shader_text(code))
    words = e.instructions(code)
    assert words[276] == (0x03000002, 0x80070000, 0x90e40002, 0x90e40002)
    assert words[302] == (0x03000005, 0xe0070007, 0x80ff0000, 0x80e40001)
    assert words[700] == (0x03000002, 0x80070000, 0x80e40000, 0x80e40003)
    # Real raw VVD positions/normals and VHV bytes, independently of GLTF geometry.
    inventory = json.loads((VHV / 'inventory.json').read_text())
    remap = json.loads((VHV / 'remap/manifest.json').read_text())
    source_ids = (VHV / 'source-vertex-map.u32').read_bytes()
    assert sha(source_ids) == inventory['binary']['mapping']['sha256']
    light = (VHV / 'instance-lighting.bin').read_bytes()
    assert sha(light) == inventory['binary']['lighting']['sha256']
    props = json.loads((ROOT / '.reference-assets/source-exports/dust2/prop-instances.json').read_text())
    chosen_records = [r for r in remap['records'] if r['materialSource'] in [PREFIX+n for n in NAMES]]
    assert all(r['verified'] for r in chosen_records)
    raw_remap = (VHV / 'remap/original-prop-to-vhv.u32').read_bytes()
    assert sha(raw_remap) == remap['sha256']
    leaf_ids = {}
    for record in chosen_records:
        span = raw_remap[record['mapOffset']:record['mapOffset']+record['mapBytes']]
        leaf_ids.setdefault(record['model'], set()).update(x[0] for x in struct.iter_unpack('<I', span) if x[0] != 0xffffffff)
    leaf_ids = {name: sorted(ids) for name, ids in leaf_ids.items()}
    models = {r['model']: inventory['models'][r['sourceModelIndex']] for r in chosen_records}
    game = ROOT / '.reference-assets/csgo-legacy/csgo'
    vpk = index.VPKIndex(game/'pak01_dir.vpk')
    source_vertices = {}
    with zipfile.ZipFile(ROOT / 'output/source1/de_dust2/lumps/40-pakfile.bin') as pak:
        entries = {name.lower(): name for name in pak.namelist()}
        for name, model in models.items():
            path = name[:-4]+'.vvd'
            raw = pak.read(entries[path]) if path in entries else (game/path).read_bytes() if (game/path).is_file() else vpk.read(path)
            assert sha(raw) == inventory['dependencies'][path]['sha256']
            assert struct.unpack_from('<I', raw, 48)[0] == 0
            offset = struct.unpack_from('<I', raw, 56)[0]
            ids = []
            for group in model['groups']:
                ids.extend(x[1] for x in struct.iter_unpack('<2I', source_ids[group['mappingOffset']:group['mappingOffset']+group['mappingBytes']]))
            source_vertices[name] = [struct.unpack_from('<6f', raw, offset+48*i+16) for i in ids]
    cases = []
    max_zero_wind = max_color_error = max_displacement = 0.
    count = 0
    configurations = [(0., [0., 0.]), (0., [2., 0.]), (.125, [2., 0.]), (1.75, [-3., 4.]), (6.25, [4., -2.])]
    for instance in inventory['instances']:
        prop = props[instance['index']]
        if instance['model'] not in models:
            continue
        source = next((m['source'] for part in prop['meshMaterials'] for m in part if m['source'] in [PREFIX+n for n in NAMES]), None)
        if source is None:
            continue
        count += 1
        p, y, r = map(math.radians, prop['angles'])
        sp, cp, sy, cy, sr, cr = math.sin(p), math.cos(p), math.sin(y), math.cos(y), math.sin(r), math.cos(r)
        matrix = [[cp*cy, sp*sr*cy-cr*sy, sp*cr*cy+sr*sy], [cp*sy, sp*sr*sy+cr*cy, sp*cr*sy-sr*cy], [-sp, sr*cp, cr*cp]]
        rows = [list(map(oracle.f, [x*prop['uniformScale'] for x in row]+[prop['origin'][i]])) for i, row in enumerate(matrix)]
        vertices = source_vertices[instance['model']]
        eligible = leaf_ids[instance['model']]
        for source_id in sorted(set(eligible[i] for i in [0, len(eligible)//3, 2*len(eligible)//3, len(eligible)-1])):
            vertex = vertices[source_id]
            encoded = list(light[instance['groups'][0]['lightingOffset']+source_id*12:][:4])
            rgba = [encoded[2]/255, encoded[1]/255, encoded[0]/255, encoded[3]/255]
            for time, wind in configurations:
                c = {0: [0, 1, 2, .5], 12: [0, time, *wind], 13: [0]*4, 50: [1, 0, 0, 0], **constants,
                     48: [1, 0, 0, 0], 49: [0, 1, 0, 0], 53: [0]*4, 58: rows[0], 59: rows[1], 60: rows[2]}
                inputs = {0: [*vertex[:3], 1], 1: [*vertex[3:], 0], 2: rgba, 3: [0, 0, 0, 1], 4: [0]*4, 5: [0]*4, 6: [0]*4}
                result = oracle.evaluate(words, c, inputs)
                assert all(math.isfinite(v) for values in result.values() for v in values)
                displacement = math.dist(result['sourcePosition'], vertex[:3])
                if wind == [0, 0]: max_zero_wind = max(max_zero_wind, displacement)
                expected_color = [oracle.f((2*oracle.f(x))**oracle.f(2.2)) for x in rgba[:3]]
                max_color_error = max(max_color_error, max(abs(x-y) for x, y in zip(result['bakedDiffuse'], expected_color)))
                max_displacement = max(max_displacement, displacement)
                cases.append({'propId': prop['index'], 'material': source, 'model': instance['model'], 'sourceId': source_id,
                    'sourcePosition': list(vertex[:3]), 'sourceNormal': list(vertex[3:]), 'sourceModelRows': rows,
                    'time': time, 'windSourceXY': wind, 'inputColorRGBA': rgba, **{'expected'+k[0].upper()+k[1:]: v for k, v in result.items()}})
    assert count == 64 and max_zero_wind == 0 and max_color_error < 2e-6
    evidence = {'format': 'source-treesway-oracle-v1', 'binary': shader.identity(), 'selectorCases': selections,
        'parameterIndices': {'treesway': 'info+0x198', 'following15Fields': 'consecutive float/int parameter indices through info+0x1d4'},
        'nativeConstantSentinels': sentinel, 'originalOliveParameterValues': parameters, 'nativeConstants': constants,
        'dynamicCommandCases': dynamic, 'program': program, 'vcsSha256': sha(raw_vs),
        'sampledInstances': count, 'sampledCases': len(cases), 'zeroWindMaxSourceDisplacement': max_zero_wind,
        'bakedColorMaxAbsoluteError': max_color_error, 'sampledMaxSourceDisplacement': max_displacement,
        'cases': cases, 'boundary': 'Exact original x64 selector/constant-writer blocks plus independent decoded-token float32 sampling. Not a native GPU, original env_wind RNG/time state, fused MAD or full shader lighting. Source units and original instance matrix retained.'}
    (OUT/'oracle.json').write_text(json.dumps(evidence, indent=2)+'\n')
    print(json.dumps({k: v for k, v in evidence.items() if k != 'cases'}, indent=2))


if __name__ == '__main__': main()
