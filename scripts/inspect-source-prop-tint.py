"""Bounded tintmask/instance-color evidence from the installed App740 client.

Run with .tools/source-binary-venv/bin/python. Unicorn executes only the
explicitly bounded original instruction blocks; no engine or OS calls run.
No game/public asset changes or leaked source. Handoffs are individually
asserted from the installed interfaces; this does not execute a full engine.
"""
from pathlib import Path
import importlib.util
import json
import struct
import sys
from unicorn import Uc, UC_ARCH_X86, UC_MODE_64
from unicorn.x86_const import (UC_X86_REG_R12, UC_X86_REG_R13, UC_X86_REG_RBP,
                              UC_X86_REG_RSP, UC_X86_REG_RDI, UC_X86_REG_XMM0,
                              UC_X86_REG_RIP, UC_X86_REG_RAX, UC_X86_REG_RBX,
                              UC_X86_REG_R14)

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.reference-assets/source-exports/dust2-vhv/encoding/tint'
BASE = 0x60000000


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / file)
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def emulator(elf):
    uc = Uc(UC_ARCH_X86, UC_MODE_64)
    ranges = []
    for segment in elf.segments:
        if segment[0] != 1:
            continue
        start, end = segment[3] & ~4095, (segment[3] + segment[6] + 4095) & ~4095
        if ranges and start <= ranges[-1][1]:
            ranges[-1][1] = max(end, ranges[-1][1])
        else:
            ranges.append([start, end])
    for start, end in ranges:
        uc.mem_map(start, end - start)
    for segment in elf.segments:
        if segment[0] != 1:
            continue
        uc.mem_write(segment[3], elf.data[segment[2]:segment[2] + segment[5]])
    uc.mem_map(BASE, 0x10000)
    uc.reg_write(UC_X86_REG_RSP, BASE + 0xf000)
    uc.reg_write(UC_X86_REG_RBP, BASE + 0xe000)
    return uc


def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def main():
    m = module('tint_evidence', 'inspect-source-vhv-encoding.py')
    OUT.mkdir(exist_ok=True)
    shader = m.ELF(ROOT / '.reference-assets/csgo-legacy/bin/linux64/stdshader_dx9_client.so')
    api = m.ELF(ROOT / '.reference-assets/csgo-legacy/bin/linux64/shaderapidx9_client.so')
    engine = m.ELF(ROOT / '.reference-assets/csgo-legacy/bin/linux64/engine_client.so')
    client = m.ELF(ROOT / '.reference-assets/csgo-legacy/csgo/bin/linux64/client_client.so')
    studio = m.ELF(ROOT / '.reference-assets/csgo-legacy/bin/linux64/studiorender_client.so')
    materials = m.ELF(ROOT / '.reference-assets/csgo-legacy/bin/linux64/materialsystem_client.so')

    # Original parameter names -> registered index -> VertexLitGeneric info fields.
    for address, name in [(0x49691, '$BLENDTINTBYBASEALPHA'), (0x496ed, '$NOTINT'),
                          (0x497a9, '$ALLOWDIFFUSEMODULATION')]:
        assert shader.cstring(shader.rip(address, '48 8d 05')) == name
    shader.check(0x496c1, '89 05 01 ab 32 00')  # global3741c8
    shader.check(0x4971d, '89 05 65 aa 32 00')  # global374188
    shader.check(0xc418d, '8b 05 35 00 2b 00 89 85 34 ff ff ff')  # info+174
    shader.check(0xc4199, '8b 05 e9 ff 2a 00 89 85 38 ff ff ff')  # info+178
    shader.check(0xc41b1, '8b 05 51 ff 2a 00 89 85 40 ff ff ff')  # info+180
    shader.check(0xc4baa, '49 63 84 24 f8 01 00 00')
    shader.check(0xc4bc7, '83 e0 0f 3c 03 0f 94 85 4a fb ff ff')  # texture type test
    assert shader.cstring(shader.rip(0x4a1a0, '48 8d 05')) == '$TINTMASKTEXTURE'
    shader.check(0x4a1d0, '89 05 32 98 32 00')
    shader.check(0xc42ef, '8b 05 13 f7 2a 00 89 45 b8')  # info+1f8

    # Actual draw info builder, not an assumed SDK ABI. Fill is the original
    # memset(...,255,0x21c), then execute every original field assignment.
    shader.check(0xc28db, 'ba 1c 02 00 00 be ff 00 00 00')
    assert shader.jump(0xc28ef, 'e8') == 0x27b40
    defaults_uc = emulator(shader)
    defaults_uc.mem_write(BASE + 0xe000 - 0x250, b'\xff' * 0x21c)
    for address, value in [(0x374308, 101), (0x374108, 102), (0x373a08, 103)]:
        defaults_uc.mem_write(address, struct.pack('<i', value))
    defaults_uc.emu_start(0xc28f4, 0xc2df1, count=500)
    assert defaults_uc.reg_read(UC_X86_REG_RIP) == 0xc2df1
    info = defaults_uc.mem_read(BASE + 0xe000 - 0x250, 0x21c)
    assert [struct.unpack_from('<i', info, at)[0] for at in (0xb8, 0x150, 0x180, 0x1f8)] == [-1, 101, 102, 103]
    # Default strings are the registered values, not parameter descriptions.
    assert shader.cstring(shader.rip(0x49156, '4c 8d 35')) == '0'
    assert shader.cstring(shader.rip(0x494b3, '48 8d 05')) == '$LINEARWRITE'
    shader.check(0x494ba, '4c 89 35 37 ae 32 00')
    assert shader.cstring(shader.rip(0x49535, '4c 8d 05')) == '1'
    shader.check(0x4953f, '4c 89 45 b8')
    shader.check(0x49799, '4c 8b 45 b8')
    shader.check(0x497cf, '4c 89 05 22 a9 32 00')
    shader.check(0xc4d81, '49 63 84 24 50 01 00 00')
    shader.check(0xc4d9a, '83 78 10 01')
    shader.check(0xc4d9e, '0f 95 85 18 fb ff ff')
    shader.check(0xc7998, '41 83 bc 24 b8 00 00 00 ff')
    shader.check(0xc8a14, 'be 01 00 00 00')
    assert shader.jump(0xc8a19, 'e8') == 0x10c700
    shader.check(0xc6e5c, '49 63 84 24 74 01 00 00')
    shader.check(0xc6e85, '80 bd 4a fb ff ff 00')
    shader.check(0xc6e96, '49 63 84 24 78 01 00 00')
    shader.check(0xc6eb9, 'f3 0f 10 05 6f e1 04 00')  # NOTINT -> -1
    shader.check(0xc7940, 'f3 0f 10 05 bc b6 04 00 f3 0f 5c c4')  # 1 - tint flag
    shader.check(0xc6f2b, 'c7 06 03 00 00 00')
    shader.check(0xc6f40, 'c7 41 04 0c 00 00 00')  # PS constant12
    shader.check(0xc6f71, '48 89 41 04')  # x/y packed in rax
    assert struct.unpack('<f', shader.code(0x115030, 4))[0] == -1
    bias_uc = emulator(shader)
    bias_uc.reg_write(UC_X86_REG_R12, BASE)
    bias_uc.reg_write(UC_X86_REG_R13, BASE + 0x1000)
    bias_uc.mem_write(BASE + 0x174, struct.pack('<2i', 0, 1))
    bias_uc.mem_write(BASE + 0x1000, struct.pack('<2Q', BASE + 0x2000, BASE + 0x2100))
    bias_rows = []
    for has_tint in (False, True):
        for base_alpha in (False, True):
            for no_tint in (False, True):
                bias_uc.mem_write(BASE + 0xe000 - 0x4b6, bytes([has_tint]))
                bias_uc.mem_write(BASE + 0x2010, struct.pack('<i', base_alpha))
                bias_uc.mem_write(BASE + 0x2110, struct.pack('<i', no_tint))
                bias_uc.emu_start(0xc6e5c, 0xc6ec1, count=100)
                assert bias_uc.reg_read(UC_X86_REG_RIP) == 0xc6ec1
                bits = bias_uc.reg_read(UC_X86_REG_XMM0) & 0xffffffff
                actual = struct.unpack('<f', struct.pack('<I', bits))[0]
                expected = -1 if no_tint else 1 - int(has_tint or base_alpha)
                assert actual == expected
                bias_rows.append(dict(hasTintTexture=has_tint, blendTintByBaseAlpha=base_alpha,
                                      noTint=no_tint, actualC12x=actual))

    # Actual pixel program: sampler13 UV0, GREEN channel with saturating add.
    code_path = OUT.parent / 'decal-tint/bump-ps-static983044-dynamic80.dx9'
    code = code_path.read_bytes()
    assert m.sha(code) == '4a68efdb860eb4f1b083547ef68beea967f85bedb95b260ad1f8fa32f5d51620'
    tokens = m.instructions(code)
    assert tokens[255] == (0x03000042, 0x800f0002, 0x90e40000, 0xa0e4080d)
    assert tokens[259] == (0x03000002, 0x80180000, 0x80550002, 0xa000000c)
    assert tokens[263] == (0x03000002, 0x80070002, 0x80550001, 0xa0e40001)
    assert tokens[267] == (0x04000004, 0x80070002, 0x80ff0000, 0x80e40002, 0xa0aa0004)
    # Actual sampler command uses bit31 SRGB, same installed consumer as R3.
    shader.check(0xcaa2a, 'c7 42 04 0d 00 00 80')

    # Instance command13 is a DISTINCT interpreter from ordinary command buffers.
    shader.check(0x10c750, 'c7 00 0d 00 00 00')
    shader.check(0x10c76d, '89 58 04')
    api.check(0x49dff, '4c 8d 35 6a 51 09 00')
    assert 0xdef70 + struct.unpack('<i', api.code(0xdef70 + 13 * 4, 4))[0] == 0x4a520
    api.check(0x4a539, '41 0f 10 5c 24 68')
    api.check(0x4a53f, '41 0f 10 45 08 0f 59 c3')
    api.check(0x4a55b, '0f c2 c8 02')
    api.check(0x4a5ac, '0f 29 5d c0')
    assert api.jump(0x4a5c3, 'e8') == 0x52890
    coefficients = [struct.unpack('<f', api.code(a, 4))[0] for a in (0xea1f0, 0xea1e0, 0xea1d0, 0xea1c0)]
    assert coefficients == list(map(f32, [.1731, .8717, -.0452, .0012]))
    assert api.code(0xea150, 16) == bytes.fromhex('000000000000000000000000ffffffff')
    def gamma(value):
        value = max(f32(value), 0)
        if value >= 1:
            return value
        a, b, c, d = coefficients
        return f32(f32(f32(f32(f32(f32(a * value) + b) * value) + c) * value) + d)
    color_uc = emulator(api)
    color_uc.reg_write(UC_X86_REG_R12, BASE)
    color_uc.reg_write(UC_X86_REG_R13, BASE + 0x1000)
    color_rows = []
    for value in [i / 255 for i in range(256)] + [-2, -.1, 1.5, 8, .0001, .9999]:
        for factor in (1, .75):
            rgba = list(map(f32, [value, value / 2, value / 4, .6]))
            color_uc.mem_write(BASE + 0x68, struct.pack('<4f', *rgba))
            color_uc.mem_write(BASE + 0x1008, struct.pack('<4f', factor, factor, factor, 1))
            color_uc.emu_start(0x4a532, 0x4a5b0, count=100)
            assert color_uc.reg_read(UC_X86_REG_RIP) == 0x4a5b0
            actual = list(struct.unpack('<4f', color_uc.mem_read(BASE + 0xe000 - 0x40, 16)))
            expected = [gamma(f32(x * factor)) for x in rgba[:3]] + [rgba[3]]
            assert actual == expected, (value, factor, actual, expected)
            color_rows.append(dict(inputRGBA=rgba, materialFactor=factor, originalOutput=actual))

    # Original BSP byte normalization is separately proved, not a claim that all
    # intermediate render-list/StudioRender handoffs have already been traced.
    engine.check(0x502ffa, '41 0f b6 44 24 40')
    engine.check(0x503010, 'f3 0f 11 8f 10 01 00 00')
    engine.check(0x50302a, 'f3 0f 11 8f 14 01 00 00')
    engine.check(0x503044, 'f3 0f 11 8f 18 01 00 00')
    engine.check(0x503068, 'f3 0f 11 87 1c 01 00 00')
    norm = struct.unpack('<f', engine.code(0x93b1d8, 4))[0]
    assert norm == f32(1 / 255)
    init_uc = emulator(engine)
    init_uc.reg_write(UC_X86_REG_R12, BASE)
    init_uc.reg_write(UC_X86_REG_RDI, BASE + 0x1000)
    for value in range(256):
        rgba = [value, 255 - value, value // 2, 255]
        init_uc.mem_write(BASE + 64, bytes(rgba))
        init_uc.emu_start(0x502ffa, 0x503070, count=100)
        assert init_uc.reg_read(UC_X86_REG_RIP) == 0x503070
        actual = list(struct.unpack('<4f', init_uc.mem_read(BASE + 0x1110, 16)))
        assert actual == [f32(x * norm) for x in rgba]
    assert engine.cstring(0x974930) == '11CStaticProp'
    assert struct.unpack('<Q', engine.code(0xd9df38, 8))[0] == 0x974930
    assert struct.unpack('<Q', engine.code(0xd69638, 8))[0] == 0xd9df30
    assert struct.unpack('<Q', engine.code(0xd69640 + 0x148, 8))[0] == 0x501320
    engine.check(0x501320, '48 8b 87 10 01 00 00')
    engine.check(0x50132f, '8b 87 18 01 00 00')

    # Real client virtual call: secondary CStaticProp vtable+58 thunk. Original
    # getter bytes are copied unchanged into a private emulator page because the
    # two ELFs occupy overlapping preferred virtual addresses. The internal
    # relative jump remains valid; no getter result is fabricated by a hook.
    assert struct.unpack('<Q', engine.code(0xd698b0 + 0x58, 8))[0] == 0x501340
    engine.check(0x501340, '48 83 ef 08 eb da')
    client.check(0x980d32, '48 8b 7b 78 48 8d 73 64 48 8b 07 ff 50 58')
    client.check(0x980d40, '0f b6 83 88 00 00 00')
    client.check(0x980d57, 'f3 0f 11 43 70')
    assert struct.unpack('<f', client.code(0x1936e9c, 4))[0] == norm
    render_uc = emulator(client)
    render_uc.mem_write(BASE + 0x8000, engine.code(0x501320, 0x26))
    render_uc.mem_write(BASE + 0x1008, struct.pack('<Q', BASE + 0x6000))
    render_uc.mem_write(BASE + 0x6058, struct.pack('<Q', BASE + 0x8020))
    render_uc.mem_write(BASE + 0x4078, struct.pack('<Q', BASE + 0x1008))
    render_uc.reg_write(UC_X86_REG_RBX, BASE + 0x4000)
    studio_uc = emulator(studio)
    studio_uc.reg_write(UC_X86_REG_RBX, BASE)
    studio_uc.reg_write(UC_X86_REG_RAX, BASE + 0x1000)
    handoff_rows = []
    for value in range(256):
        rgb = [f32(x * norm) for x in [value, 255 - value, value // 2]]
        render_alpha = 255 - value
        render_uc.mem_write(BASE + 0x1110, struct.pack('<3f', *rgb))
        render_uc.mem_write(BASE + 0x4088, bytes([render_alpha]))
        render_uc.emu_start(0x980d32, 0x980d5c, count=100)
        assert render_uc.reg_read(UC_X86_REG_RIP) == 0x980d5c
        client_rgba = bytes(render_uc.mem_read(BASE + 0x4064, 16))
        expected = rgb + [f32(render_alpha * norm)]
        assert list(struct.unpack('<4f', client_rgba)) == expected
        studio_uc.mem_write(BASE + 0x64, client_rgba)
        studio_uc.emu_start(0xb9a5, 0xb9d4, count=100)
        assert studio_uc.reg_read(UC_X86_REG_RIP) == 0xb9d4
        studio_rgba = bytes(studio_uc.mem_read(BASE + 0x1068, 16))
        assert studio_rgba == client_rgba
        color_uc.mem_write(BASE + 0x68, studio_rgba)
        color_uc.mem_write(BASE + 0x1008, struct.pack('<4f', 1, 1, 1, 1))
        color_uc.emu_start(0x4a532, 0x4a5b0, count=100)
        assert color_uc.reg_read(UC_X86_REG_RIP) == 0x4a5b0
        output = list(struct.unpack('<4f', color_uc.mem_read(BASE + 0xe000 - 0x40, 16)))
        assert output == [gamma(x) for x in rgb] + expected[3:]
        handoff_rows.append(dict(sourceRGB=[value, 255-value, value//2], renderAlpha=render_alpha,
                                 normalized=expected, originalShaderConstant=output))

    # Client normal mode0 -> VStudioRender026 table+190; mode1 takes +188 and
    # has a separate white-color pass, explicitly not generalized to tint.
    assert client.cstring(struct.unpack('<Q', client.code(0x20dbb50, 8))[0]) == 'VStudioRender026'
    assert struct.unpack('<Q', client.code(0x20dbb58, 8))[0] == 0x6d9ee98
    assert client.jump(0x983744, 'e8') == 0x980ce0
    assert client.jump(0x98376f, 'e8') == 0x982bd0
    client.check(0x982be9, '45 85 c9')
    client.check(0x982ece, '41 b8 a8 00 00 00')
    client.check(0x982ed7, 'ff 90 90 01 00 00')
    assert studio.cstring(0xca370) == '20CStudioRenderContext'
    assert struct.unpack('<Q', studio.code(0x2eca18 + 0x190, 8))[0] == 0x1d8f0
    assert studio.jump(0x1ddd4, 'e8') == 0x10080
    assert studio.jump(0x101c9, 'e8') == 0xd760
    studio.check(0xd81d, '48 8b 4e f8')  # original instance pointer from array+10
    studio.check(0xd823, '48 89 4d 88')
    studio.check(0xda5f, '48 8b 45 88')
    studio.check(0xda72, '49 89 46 f0')  # output drawrecord+18, after advancing28
    assert studio.jump(0x101f0, 'e8') == 0xb7e0
    studio.check(0xb87b, '49 8b 5e 18')
    studio.check(0xb9a5, 'f3 0f 10 43 64 f3 0f 11 40 68')
    studio.check(0xba88, 'ff 90 08 06 00 00')
    assert struct.unpack('<Q', studio.code(0x2eca18 + 0x188, 8))[0] == 0x1df10
    studio.check(0xcc25, 'c7 40 68 00 00 80 3f c7 40 6c 00 00 80 3f')
    # CMatRenderContext forwards the same pointer; secondary IShaderAPI (this
    # adjustment -3c8) is distinct from primary IShaderDynamicAPI vtable.
    assert struct.unpack('<Q', materials.code(0x377420 + 0x608, 8))[0] == 0x97bc0
    materials.check(0x97bd2, '48 8b 80 f0 07 00 00 ff e0')
    assert struct.unpack('<Q', api.code(0x319030 + 0x7f0, 8))[0] == 0x36d50
    api.check(0x36d50, '48 81 ef c8 03 00 00 eb c7')
    assert api.jump(0x36d2c, 'e8') == 0x29e60
    assert api.rip(0x29e61, '48 8d 05') == 0x320900
    assert api.rip(0x2d631, '48 8d 05') == 0x315300
    assert struct.unpack('<Q', api.code(0x315300 + 0x100, 8))[0] == 0x270d0
    api.check(0x270fe, '48 89 d3')
    api.check(0x271e7, '48 89 d9')
    api.check(0x271fc, 'ff 90 20 09 00 00')
    assert struct.unpack('<Q', api.code(0x319030 + 0x920, 8))[0] == 0x4b7a0
    assert api.jump(0x4b7a7, 'e9') == 0x4b500
    api.check(0x4b52c, '48 89 4d b8')
    api.check(0x4b758, '48 8b 4d b8')
    assert api.jump(0x4b772, 'e8') == 0x4a930
    api.check(0x4a962, '48 89 8f c0 33 00 00')
    api.check(0x49d91, '49 c1 e4 07 4c 03 a7 c0 33 00 00')

    result = dict(status='installed_tintmask_bias_sampler_and_color_blocks_verified',
                  binaries=[shader.identity(), api.identity(), engine.identity(), client.identity(), studio.identity(), materials.identity()],
                  psProgramSha256=m.sha(code),
                  formula='bakedDiffuse * originalBaseRGB * (1 + saturate(sampleSRGB(tintmask, UV0).g + c12.x) * (c1.rgb - 1))',
                  maskChannel='green', maskAlphaUsed=False, sampler=13, samplerSRGB=True,
                  biasOriginalInstructionCases=bias_rows,
                  c1Consumer=dict(interpreterTable='shaderapi:def70', command=13, inputInstanceRGBAOffset=104,
                                  originalBlock=['0x4a532', '0x4a5b0'], polynomialCoefficients=coefficients,
                                  operation='x=max(instanceRGB*materialRGB,0); x>=1 ? x : ((a*x+b)*x+c)*x+d; alpha=instanceAlpha',
                                  exactFloat32Cases=len(color_rows), samples=color_rows),
                  sourceStaticPropRGBA=dict(recordByteOffset=64, normalization=norm, destinationOffset=272,
                                           originalBlock=['0x502ffa', '0x503070'], exactByteCases=256,
                                           rawCopyRGBGetter='0x501320', primaryVtable='0xd69640+0x148'),
                  selectedDefaults=dict(linearWrite=0, allowDiffuseModulation=1, hdrColorScaleInfoIndex=-1,
                                        originalInfoBuilder=['0xc28f4','0xc2df1'], materialColor='default white only'),
                  renderHandoff=dict(exactFloat32Cases=len(handoff_rows), samples=handoff_rows,
                                     clientGetter=['0x980d32','0x980d5c'],
                                     relocatedOriginalGetter=dict(source='engine:0x501320..0x501346',emulatorDestination=hex(BASE+0x8000)),
                                     studioCopy=['0xb9a5','0xb9d4'],
                                     normalPass='client mode0 -> VStudioRender026+190 -> 1d8f0 -> 10080 -> d760 -> b7e0 -> b9a5 -> IMatRenderContext+608',
                                     shaderAPI='CMatRenderContext:97bc0 -> secondary IShaderAPI+7f0 -> 36d50/36d20 -> CMeshMgr+100 -> 270d0 -> IShaderAPI+920 -> 4b500 -> 4a930 -> instance+33c0 -> command13',
                                     separatePass='client mode1 -> VStudioRender026+188 -> 1df10 -> 10bc0 -> ca20 stores white, not generalized',
                                     alphaBoundary='render-list fade alpha byte+88 is normalized separately; not claimed to equal original BSP alpha'),
                  remaining=['Apply selected defaults only to original white material $color/$color2, no overrides',
                             'No tint texture extraction, runtime material branch, or tint GPU acceptance yet'],
                  runtimeChanged=False, originalAssetsChanged=False,
                  boundary='Only bounded original instruction blocks executed in Unicorn; not a running Source engine.')
    (OUT / 'tint-evidence.json').write_text(json.dumps(result, indent=2) + '\n')
    catalog_path = ROOT / 'research/source-prop-material-branches.json'
    plain = {'$basetexture', '$bumpmap', '$surfaceprop', '$model', '$notint', '$nocull', '$nodecal',
             '$alphatest', '$alphatestreference', '$allowalphatocoverage', '$tintmasktexture'}
    candidates = []
    for row in json.loads(catalog_path.read_text())['materials']:
        params = row['parameters']
        if '$tintmasktexture' not in params:
            continue
        other = sorted(set(params) - plain)
        if row['shader'].lower() != 'vertexlitgeneric':
            other.append('shader ' + row['shader'])
        candidates.append(dict(source=row['source'], rawVmtSha256=row['rawVmtSha256'],
                               meshInstances=row['meshInstances'], triangles=row['triangles'], parameters=params,
                               otherUnverifiedFeatures=other, requiresUnbumpedProgram=not bool(params.get('$bumpmap')),
                               requiresOriginalDecalUV2='$decaltexture' in params))
    (OUT / 'material-candidates.json').write_text(json.dumps(dict(
        status='inventory_only_no_runtime_branch_enabled', sourceCatalogSha256=m.sha(catalog_path.read_bytes()),
        materials=candidates, totalMaterials=len(candidates),
        boundary='Mesh counts are catalog counts, not newly validated remap/branch/GPU coverage.',
        plainTintCandidates=sum(not row['otherUnverifiedFeatures'] for row in candidates)), indent=2) + '\n')
    print(json.dumps({k: result[k] for k in ('status', 'maskChannel', 'samplerSRGB', 'remaining')}, indent=2))
    print('Bias cases:', len(bias_rows), 'color cases:', len(color_rows), 'original byte cases:', 256)


if __name__ == '__main__':
    main()
