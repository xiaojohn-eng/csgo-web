"""Execute the shipped client for the ten newly offered style-5 finishes.

The schema/KV ABI is supplied from pinned original catalogue/VMT records. All clone
arithmetic, style branches, later scalar arguments and shader-selector arithmetic
execute as original machine code. This does not claim original-client GPU output.

Run with the existing source-binary Python environment; writes only a new receipt
directory, research/source-style5-overrides.json and the generated low-factor data.
"""
from pathlib import Path
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
OUT = ROOT / '.reference-assets/source-exports/style5-albedo-overrides'
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
    p = module('style5_ctab', 'probe-source-redline-programs.py')
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
    weapons = {'weapon_m4a1': [780], 'weapon_awp': [51, 395],
               'weapon_glock': [48, 1119, 1120, 1121, 1122, 1123], 'weapon_deagle': [425]}
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
        receipt = json.loads((ROOT / f'public/source/csgo-12426148/kit-inputs/{weapon}/inputs.json').read_text())
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
            assert entry['style'] == 5 and entry['ignoreWeaponSizeScale'] == 1
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
            assert intensity == entry['phongIntensity']
            assert float(current['material']['$phongalbedoboost']) == max(float(original['$phongalbedoboost']), entry['phongAlbedoBoost'])
            assert current['material']['$phongalbedotint'] == 1
            cases.append(dict(weapon=weapon, paintKitId=id_, kit=entry, materialSource=material_path,
                              materialSha256=sha(raw), originalMaterial=original, phong=receipt['phong'],
                              nativeCompositeAlbedoFactor=factor, nativeCompositeIntensityInteger=intensity,
                              materialAfterBranch=dict(current['material']), keyValuesABIEvents=current['events'],
                              laterCompositeScalarArguments=scalars, selectors=selectors))
    index = v.VPKIndex(ROOT / '.reference-assets/csgo-legacy/platform/platform_pak01_dir.vpk')
    vcs = index.read('shaders/fxc/customweapon_ps30.vcs')
    assert sha(vcs) == '7115c936b78fa3762e9a729b60b1b2123f761ac32a41bf044b3bb34bde5ac0ce'
    count = struct.unpack_from('<7I', vcs)[5]
    table = dict(struct.iter_unpack('<2I', vcs[28:28 + count * 8]))
    alias_at = 28 + count * 8
    alias_count = struct.unpack_from('<I', vcs, alias_at)[0]
    aliases = dict(struct.iter_unpack('<2I', vcs[alias_at + 4:alias_at + 4 + alias_count * 8]))
    assert len(aliases) == alias_count and all(value in table for value in aliases.values())
    assert alias_at + 4 + alias_count * 8 == min(table.values())
    OUT.mkdir(parents=True, exist_ok=True)
    programs, data = {}, {}
    for static in sorted({value['static'] for case in cases for value in case['selectors'].values()}):
        selected = aliases.get(static, static)
        code, proof = m.vcs_combo(vcs, selected, 0)
        name = f'customweapon_ps30-static{static}-dynamic0'
        (OUT / (name + '.dx9')).write_bytes(code)
        tokens = [list(row) for row in m.instructions(code).values()]
        constants = p.ctab(code)['constants']
        row = dict(static=static, aliasResolvedStatic=selected, dynamic=0, sha256=sha(code), tokenCount=len(tokens),
                   samplers=sorted(c['index'] for c in constants if c['registerSet'] == 3),
                   constants=[dict(register=c['index'], name=c['name']) for c in constants if c['registerSet'] != 3],
                   tokens=tokens)
        if static < 160:
            control = ROOT / f'.reference-assets/source-exports/customweapon-style-programs/{name}.dx9'
            assert control.read_bytes() == code
        else:
            data['color' if static == 165 else 'exponent'] = row
        programs[str(static)] = {key: value for key, value in row.items() if key != 'tokens'}
    assert set(data) == {'color', 'exponent'}
    (OUT / 'tokens.json').write_text(json.dumps(data, separators=(',', ':')) + '\n')
    result = dict(format='source-style5-overrides-native-v1', status='native-clone-scalars-and-selector-executed',
                  client=client.identity(), shader=shader.identity(), catalogueSha256=sha(catalogue_path.read_bytes()),
                  vcsSha256=sha(vcs), cloneSpan=['0xf5277c', '0xf5291c'], selectorSpan=['0x65c3e', '0x65cb1'],
                  cases=cases, programs=programs,
                  boundary='Original machine-code arithmetic with original catalogue/VMT values at explicit schema/KeyValues ABI fixtures. '
                           'The original scalar format is %f; host formatting/parsing supplies that ABI. '
                           'VCS extraction is byte-verified against existing static5/15 controls. Original client GPU output is not executed.')
    (ROOT / 'research/source-style5-overrides.json').write_text(json.dumps(result, indent=2) + '\n')
    (OUT / 'evidence.json').write_text(json.dumps(result, indent=2) + '\n')
    (ROOT / 'game/source-customweapon-low-albedo-data.ts').write_text(
        '// Generated from original static165/175 DX9 bytes by probe-source-style5-overrides.py.\n'
        '// Non-preview style 5, material albedo factor < 1; both selectors execute in the original shader DLL.\n'
        'export const SOURCE_CUSTOMWEAPON_LOW_ALBEDO_DATA = '
        + json.dumps({'5': data}, separators=(',', ':')) + ' as const;\n')
    print(json.dumps(dict(cases=len(cases), programs=programs, output=str(OUT.relative_to(ROOT))), indent=2))


if __name__ == '__main__':
    main()
