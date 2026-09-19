"""Original shipped PS arithmetic and native material upload receipt (bounded).

PYTHONPATH=.tools/source-binary-venv/lib/python3.9/site-packages python3 scripts/probe-source-world-layers.py
No browser or full renderer claim: TEXLD is supplied exact test texels and the
native x86 span only executes the four-parameter command-buffer upload.
"""
from pathlib import Path
import importlib.util
import json
import math
import runpy
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
H = runpy.run_path(str(ROOT / 'scripts/inspect-source-vhv-encoding.py'))
f32 = lambda n: struct.unpack('<f', struct.pack('<f', n))[0]
sat = lambda n: min(1., max(0., n))


def execute(code, alpha, mod, params, new):
    regs = {(2, 33): [.8, .7, .6, 1], (2, 34): [1, .9, .8, 1],
        (2, 46): [params[0], params[1], -params[2], params[3]], (2, 47): [.36, .25, .16, 1],
        (2, 8): [1, 1, 1, 0], (1, 5): [0, 0, 0, alpha], (1, 7): [1, 1, 1, 1], (1, 9): [1, 1, 1, 1]}
    samples = {0: [.3, .5, .7, .8], 7: [.8, .6, .4, 1], 3: [*mod, 0, 1],
        4: [.7, .4, .95, 1], 5: [.3, .65, .9, 1], 12: [.5, .5, .5, 1], 1: [.1, .2, .3, 1]}
    def kind(t): return ((t >> 28) & 7) | ((t >> 8) & 24), t & 2047
    def src(t):
        v = regs.get(kind(t), [0] * 4)
        v = [v[(t >> (16 + 2 * i)) & 3] for i in range(4)]
        mode = (t >> 24) & 15
        assert mode in (0, 1, 11, 12)
        if mode in (11, 12): v = [abs(n) for n in v]
        if mode in (1, 12): v = [-n for n in v]
        return v
    base = None
    for at, words in H['instructions'](code).items():
        op = words[0] & 65535; d = words[1]
        if op == 31: continue
        if op == 81: value = struct.unpack('<4f', struct.pack('<4I', *words[2:]))
        elif op == 66: value = samples[words[3] & 2047]
        else:
            args = [src(t) for t in words[2:]]; a = args[0]; b = args[1] if len(args) > 1 else None; c = args[2] if len(args) > 2 else None
            if op == 1: value = a
            elif op == 2: value = [x + y for x, y in zip(a, b)]
            elif op == 4: value = [f32(x * y) + z for x, y, z in zip(a, b, c)]
            elif op == 5: value = [x * y for x, y in zip(a, b)]
            elif op == 6: value = [1 / a[0]] * 4
            elif op == 8: value = [sum(f32(a[i] * b[i]) for i in range(3))] * 4
            elif op == 10: value = [min(x, y) for x, y in zip(a, b)]
            elif op == 18: value = [f32(x * y) + f32((1 - x) * z) for x, y, z in zip(a, b, c)]
            elif op == 88: value = [y if x >= 0 else z for x, y, z in zip(a, b, c)]
            elif op == 90: value = [f32(a[0] * b[0]) + f32(a[1] * b[1]) + c[0]] * 4
            else: raise ValueError((at, op))
        dest = regs.setdefault(kind(d), [0] * 4)
        for i in range(4):
            if d & (1 << (16 + i)): dest[i] = f32(sat(value[i]) if d & (1 << 20) else value[i])
        if at == (436 if new else 342): base = list(regs[(0, 0)])
        if at == (509 if new else 402):
            weights = regs[(0, 1 if new else 2)][:3]; total = sum(weights)
            return dict(base=base[:3], blend=base[3], normalWeights=[w / total for w in weights])
    raise ValueError('Selected original shader program changed')


def native_upload(elf, values, fields=(0x12c,0x130,0x134,0x138), start=0x82b55, stop=0x82c67, register=46):
    from unicorn import Uc, UC_ARCH_X86, UC_MODE_64
    from unicorn.x86_const import UC_X86_REG_RBX, UC_X86_REG_R12, UC_X86_REG_R15
    uc = Uc(UC_ARCH_X86, UC_MODE_64)
    # Segment pages can touch; map the bounded ELF virtual span once.
    high = max(s[3] + s[6] for s in elf.segments if s[0] == 1)
    uc.mem_map(0, (high + 4095) & ~4095)
    for s in elf.segments:
        if s[0] == 1: uc.mem_write(s[3], elf.data[s[2]:s[2] + s[5]])
    arena = 0x20000000; uc.mem_map(arena, 0x10000)
    info, params, objects, state, commands = [arena + n * 0x1000 for n in range(5)]
    for i, value in enumerate(values):
        uc.mem_write(info + fields[i], struct.pack('<i', i))
        uc.mem_write(params + i * 8, struct.pack('<Q', objects + i * 64))
        uc.mem_write(objects + i * 64 + 0x14, struct.pack('<f', value))
    uc.mem_write(state + 0x400, struct.pack('<Q', commands))
    uc.reg_write(UC_X86_REG_R12, info); uc.reg_write(UC_X86_REG_R15, params); uc.reg_write(UC_X86_REG_RBX, state)
    uc.emu_start(start, stop, count=200)
    raw = bytes(uc.mem_read(commands, 28)); assert struct.unpack_from('<3I', raw) == (3, register, 1)
    return list(struct.unpack_from('<4f', raw, 12))


def native_blend_mode(elf, new_layer, edge_normal):
    from unicorn import Uc, UC_ARCH_X86, UC_MODE_64
    from unicorn.x86_const import UC_X86_REG_R12, UC_X86_REG_R15, UC_X86_REG_RBP
    uc=Uc(UC_ARCH_X86,UC_MODE_64);uc.mem_map(0x81000,0x1000);uc.mem_write(0x81000,elf.code(0x81000,0x1000))
    uc.mem_map(0x20000000,0x10000);info=0x20000000;params=info+0x1000;objects=info+0x2000;bp=info+0x8000
    for i,(field,value) in enumerate(((0x128,new_layer),(0x150,edge_normal))):
        uc.mem_write(info+field,struct.pack('<i',i));uc.mem_write(params+i*8,struct.pack('<Q',objects+i*64))
        uc.mem_write(objects+i*64+0x10,struct.pack('<i',value))
    uc.mem_write(bp-0x14a8,struct.pack('<i',1)) # Native checked blend-modulation texture is present.
    uc.reg_write(UC_X86_REG_R12,info);uc.reg_write(UC_X86_REG_R15,params);uc.reg_write(UC_X86_REG_RBP,bp)
    uc.emu_start(0x812e2,0x81330,count=80)
    return struct.unpack('<i',uc.mem_read(bp-0x1498,4))[0]


def world_parameter_registration(elf):
    from capstone import Cs,CS_ARCH_X86,CS_MODE_64
    from capstone.x86 import X86_OP_MEM,X86_REG_RIP
    cs=Cs(CS_ARCH_X86,CS_MODE_64);cs.detail=True;out={}
    for name,start,size in (('LightmappedGeneric',0x359f0,0x1bdf),('WorldVertexTransition',0x4e820,0x1b4c),('VertexLitGeneric',0x47280,0x3280)):
        names=set()
        for ins in cs.disasm(elf.code(start,size),start):
            if ins.mnemonic!='lea':continue
            for op in ins.operands:
                if op.type!=X86_OP_MEM or op.mem.base!=X86_REG_RIP:continue
                try:text=elf.cstring(ins.address+ins.size+op.mem.disp)
                except (ValueError,UnicodeDecodeError,StopIteration):continue
                if text.startswith('$') and text.upper()==text:names.add(text)
        out[name]=dict(start=hex(start),size=size,sha256=H['sha'](elf.code(start,size)),names=sorted(names))
    assert '$BLENDTINTBYBASEALPHA' in out['VertexLitGeneric']['names']
    assert all('$BLENDTINTBYBASEALPHA' not in out[n]['names'] for n in ('LightmappedGeneric','WorldVertexTransition'))
    assert '$DROPSHADOWOPACITY' in out['WorldVertexTransition']['names']
    return out


def main():
    spec = importlib.util.spec_from_file_location('world_index', ROOT / 'scripts/inventory-source-map.py')
    index = importlib.util.module_from_spec(spec); sys.modules[spec.name] = index; spec.loader.exec_module(index)
    vpk = index.VPKIndex(ROOT / '.reference-assets/csgo-legacy/platform/platform_pak01_dir.vpk')
    path = 'shaders/fxc/lightmappedgeneric_ps30.vcs'; raw = vpk.read(path)
    count = struct.unpack_from('<I', raw, 20)[0]; at = 28 + count * 8
    aliases = dict(struct.iter_unpack('<2I', raw[at + 4:at + 4 + struct.unpack_from('<I', raw, at)[0] * 8]))
    elf = H['ELF'](ROOT / '.reference-assets/csgo-legacy/bin/linux64/stdshader_dx9_client.so')
    # Parameter registry -> material-info field -> actual upload. Constants are
    # asserted directly, rather than inferred from suggestive shader names.
    for address, expected in {0x371b7:'488d05bf2c0e00',0x7f486:'8b051c7f2e00',
        0x7f48c:'8905fa8f2e00',0x82baa:'f30f104014',0x82baf:'0f57c2',0x82beb:'c740042e000000',
        0x82c1d:'f30f114804',0x82c34:'f30f115804',0x82c4b:'f30f114004',0x82c62:'f30f115004'}.items(): elf.check(address, expected)
    assert elf.cstring(elf.rip(0x371b7, '488d05')) == '$BLENDSOFTNESS'
    assert struct.unpack('<d', elf.code(0x127218, 8))[0] == f32(2.2)
    assert struct.unpack('<f', elf.code(0x113680, 4))[0] == f32(1 / 255)
    assert struct.unpack('<f', elf.code(0x127178, 4))[0] == f32(.95)
    out = ROOT / 'research/world-layer-shaders'; out.mkdir(parents=True, exist_ok=True)
    cases = []; programs = []; params = [.1, .25, .1, .1]
    upload = native_upload(elf, params)
    assert upload == [f32(.1), f32(.25), f32(-.1), f32(.1)]
    drop=native_upload(elf,[1,.0325,.0325,3],(0x100,0x104,0x108,0x10c),0x85081,0x851a5,26)
    assert drop==[f32(-.0325),1.,f32(.0325),3.]
    modes=[native_blend_mode(elf,*args) for args in ((0,0),(1,0),(1,1))]
    assert modes==[1,2,3]
    registration=world_parameter_registration(elf)
    # All dynamic variants of this material configuration retain a c26 upload
    # in the CPU command stream, but the shipped pixel programs never read it.
    # A material key alone therefore does not establish a missing pixel effect.
    dropshadow_variants=[]
    for dynamic in range(16):
        try:code,r=H['vcs_combo'](raw,aliases.get(1161,1161),dynamic)
        except AssertionError:continue
        reads=[at for at,words in H['instructions'](code).items() if (words[0]&65535) not in (31,81)
            and any((((w>>28)&7)|((w>>8)&24))==2 and (w&2047)==26 for w in words[2:])]
        assert not reads
        dropshadow_variants.append(dict(dynamic=dynamic,programSha256=r['programSha256'],readsC26=reads))
    for key in (579, 1161):
        code, receipt = H['vcs_combo'](raw, aliases.get(key, key), 0)
        programs.append(dict(requestedStatic=key, **receipt))
        (out / (str(key) + '.tokens.txt')).write_text(H['shader_text'](code))
        for alpha in (-.0001, 0, .25, .4, .5, .6, .75, 1, 1.0001):
            for mod in ([.1, .5], [.35, .15], [.25, .9]):
                cases.append(dict(static=key, alpha=alpha, mod=mod, parameters=params,
                    output=execute(code, alpha, mod, params, key == 1161)))
    receipt = dict(format='source-world-layer-arithmetic-v1', source=elf.identity(), shader=dict(path=path, sha256=H['sha'](raw), programs=programs),
        nativeUpload=dict(start='0x82b55', end='0x82c67', input=params, output=upload, command=[3, 46, 1],
            semantics=['blendSoftness', 'layerBorderStrength', '-layerBorderOffset', 'layerBorderSoftness']),
        gamma=dict(uploadCalls=['0x885ea','0x87be5'], function='0xfa720', tableBuilder='0xfa490..0xfa523',
            entries=256, exponent=f32(2.2), saturatesAt=f32(.95), quantization='nearest integer of value*255; byte/255 computed float32 before pow'),
        materialGates=dict(registration=registration,nativeFancyBlendModes=dict(inputs=[[0,0],[1,0],[1,1]],outputs=modes,start='0x812e2',end='0x81330'),
            dropshadow=dict(upload=drop,command=[3,26,1],start='0x85081',end='0x851a5',static=1161,variants=dropshadow_variants,
                conclusion='Four Dust2 VMTs set old drop-shadow constants; the selected NEWLAYER ordinary double-normal shader family does not consume them. Do not substitute the separate layer-edge-normal branch.'),
            alphaTint='BLENDTINTBYBASEALPHA is registered only by VertexLitGeneric, not either world shader; four authored rollup-door keys are inactive in this build.'),
        bounds='Unicorn original command-buffer span plus original PS token interpreter; supplied texels, no engine draw/GPU/frame claim',
        cases=cases)
    (ROOT / 'tests/fixtures/source-world-layer-native.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(dict(cases=len(cases), nativeUpload=upload, shaderSHA=H['sha'](raw))))


if __name__ == '__main__': main()
