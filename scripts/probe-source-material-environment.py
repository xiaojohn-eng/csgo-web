"""Read original AWP VMTs and interpret the installed Phong envmap token slice.

Sampler colours are explicit fixtures, not captured original GPU output. Never
writes original assets; the new receipt is research/source-material-environment.json.
"""
from pathlib import Path
import hashlib
import importlib.util
import json
import sys

ROOT = Path(__file__).resolve().parents[1]

def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / path)
    result = importlib.util.module_from_spec(spec)
    sys.modules[name] = result
    spec.loader.exec_module(result)
    return result

def main():
    v = module('env_vpk', 'inventory-source-map.py')
    m = module('env_encoding', 'inspect-source-vhv-encoding.py')
    oracle = module('env_phong_oracle', 'probe-source-redline-phong.py')
    source = ROOT / '.reference-assets/source-exports/ak47-redline-programs/phong_ps30-static2-dynamic16.dx9'
    code = source.read_bytes()
    assert hashlib.sha256(code).hexdigest() == oracle.DX9_SHA
    program = m.instructions(code)
    offsets = [732, 736, 755, 817, 822, 827, 832, 837, 841, 845, 850, 855, 859]
    assert program[755] == (0x04000012, 0x80040007, 0xa0ff0002, 0x80ff0006, 0x80ff0001)
    assert program[859] == (0x04000058, 0x80070006, 0xa000001a, 0x80e40006, 0x80e40007)
    content = v.VPKIndex(ROOT / '.reference-assets/csgo-legacy/csgo/pak01_dir.vpk')
    materials = []
    for name in ['materials/models/weapons/v_models/snip_awp/awp.vmt',
                 'materials/models/weapons/w_models/w_snip_awp/awp.vmt',
                 'materials/models/weapons/shared/scope/scope_awp.vmt']:
        raw = content.read(name)
        materials.append({'path': name, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw), 'text': raw.decode()})
    cases = []
    for tint, albedo in [([.1, .1, .1], True), ([.16, .2, .16], False)]:
        for mask_source in ['baseAlpha', 'phongMask']:
            for invert in [False, True]:
                for fresnel_enabled in [False, True]:
                    base = [.02, .12, .5, .15]
                    rgb, phong_mask, fresnel, red, green, scale = [.3, .8, 1.4], .8, .6, .45, .7, 1
                    result = oracle.execute_slice(program, offsets, {
                        (0, 10): [*rgb, 1], (0, 1): base, (0, 2): [0, 0, 0, fresnel],
                        (0, 6): [0, 0, 0, phong_mask], (0, 7): [red, green, 0, 0],
                        (2, 30): [0, 0, scale, 0], (2, 2): [*tint, int(mask_source == 'phongMask')],
                        (2, 10): [int(fresnel_enabled), 0, 0, 0], (2, 27): [0, 0, 0, int(invert)],
                        (2, 0): [0, 0, 0, 40], (2, 26): [-1 if albedo else 1, 1, 1, 0],
                    })[(0, 6)][:3]
                    mask = base[3] if mask_source == 'baseAlpha' else phong_mask
                    if invert: mask = 1 - mask
                    expected = [c*t*scale*mask*(fresnel if fresnel_enabled else 1)
                                *((1-green+green*b*40)*red if albedo else 1)
                                for c,t,b in zip(rgb,tint,base)]
                    assert max(abs(a-b) for a,b in zip(result, expected)) < 1e-6
                    cases.append({'baseRGBA': base, 'cubeRGB': rgb, 'phongMask': phong_mask,
                                  'fresnel': fresnel, 'fresnelEnabled': fresnel_enabled,
                                  'tint': tint, 'albedoTint': albedo, 'albedoBoost': 40,
                                  'exponentRG': [red,green], 'maskSource': mask_source,
                                  'invert': invert, 'scale': scale, 'nativeTokenResult': result})
    out = {'format': 'source-material-environment-v1', 'materials': materials,
           'program': {'path': str(source.relative_to(ROOT)), 'sha256': oracle.DX9_SHA,
                       'static': 2, 'dynamic': 16, 'sliceOffsets': offsets,
                       'exactFinalAWPSelectorVerified': False},
           'cases': cases,
           'formulas': {'mask': 'mix(baseAlpha,phongMask,c2.w), optionally inverted by c27.w',
                        'fresnel': 'mix(1,phongFresnel,c10.x)',
                        'environment': 'cubeRGB*cLightScale.z*envTint*mask*fresnel',
                        'albedoTintEnvironment': 'environment*mix(1,baseRGB*albedoBoost,exponent.G)*exponent.R'},
           'boundary': 'Original VMT bytes and installed diagnostic DX9 token slices. Host f32 interpretation with supplied sampler values; not original-client GPU/lighting/filter/selector parity.'}
    path = ROOT / 'research/source-material-environment.json'
    path.write_text(json.dumps(out, indent=2)+'\n')
    print(json.dumps({'receipt': str(path), 'cases': len(cases), 'materials': len(materials)}))

if __name__ == '__main__':
    main()
