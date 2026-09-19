"""Bounded original PS2b evidence: both opaque and sampled-alpha branches exist.

This intentionally does not infer the Dust2 material's static selector. That
consumer chain must be verified before enabling a runtime cloud alpha formula.
"""
from pathlib import Path
import hashlib
import importlib.util
import json
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.reference-assets/source-exports/dust2-foliage-audit/cloud-alpha'


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def decode(code):
    words = struct.unpack('<' + 'I'*(len(code)//4), code)
    assert words[0] == 0xffff0201  # Actual installed ps_2_b, not ps_3_0.
    rows = {}
    offset = 1
    while offset < len(words):
        opcode = words[offset] & 65535
        if opcode == 65535:
            assert offset == len(words)-1
            break
        if opcode == 65534:
            offset += 1+((words[offset] >> 16) & 32767)
            continue
        length = (words[offset] >> 24) & 15
        assert offset+length < len(words)
        rows[offset] = words[offset:offset+length+1]
        offset += length+1
    return rows


def main():
    m = module('cloud_alpha_encoding', 'inspect-source-vhv-encoding.py')
    index = module('cloud_alpha_vpk', 'inventory-source-map.py')
    vpk = index.VPKIndex(ROOT / '.reference-assets/csgo-legacy/platform/platform_pak01_dir.vpk')
    path = 'shaders/fxc/unlittwotexture_ps20b.vcs'
    raw = vpk.read(path)
    assert len(raw) == 5000 and struct.unpack_from('<7I', raw) == (6, 144, 4, 0, 0, 11, 1071602020)
    OUT.mkdir(exist_ok=True)
    programs = []
    for static in (0, 1):
        code, report = m.vcs_combo(raw, static, 0)
        rows = decode(code)
        name = f'unlittwotexture-ps20b-static{static}-dynamic0'
        (OUT / (name+'.dx9')).write_bytes(code)
        (OUT / (name+'.tokens.json')).write_text(json.dumps({str(k): [f'{v:08x}' for v in vs] for k, vs in rows.items()}, indent=2)+'\n')
        if static == 0:
            assert rows[181] == (0x02000001, 0x80080000, 0xa0000000)
            assert rows[184] == (0x02000001, 0x800f0800, 0x80e40000)
            definitions = [vs for vs in rows.values() if vs[0] == 0x05000051 and (vs[1] & 2047) == 0]
            assert len(definitions) == 1 and definitions[0][2] == 0x3f800000
            formula = 'Final alpha = local def c0.x = 1 (words181,184).'
        else:
            assert rows[142] == (0x03000042, 0x800f0001, 0xb0e40000, 0xa0e40800)
            assert rows[146] == (0x03000042, 0x800f0002, 0xb0e40001, 0xa0e40801)
            assert rows[150] == (0x03000005, 0x800f0001, 0x80e40001, 0x80e40002)
            assert rows[154] == (0x03000005, 0x800f0001, 0x80e40001, 0xa0e40001)
            assert rows[175] == (0x02000001, 0x800f0800, 0x80e40001)
            assert not any((vs[1] & 0x80000) and (vs[1] & 2047) == 1 for at, vs in rows.items() if 154 < at < 175)
            formula = 'Final alpha = texture0.a * texture1.a * external c1.a (words150,154,175).'
        programs.append({**report, 'file': name+'.dx9', 'verifiedAlpha': formula})
    evidence = {'format': 'source-cloud-alpha-branches-v1', 'vpkPath': path,
        'vcsSha256': hashlib.sha256(raw).hexdigest(), 'vcsBytes': len(raw), 'programs': programs,
        'conclusion': 'The installed shader contains both constant-alpha and texture-alpha products. Generic SDK constant-alpha is insufficient to identify Dust2 cloud behavior.',
        'boundary': 'No verified original material static selector, c1 upload, blend state, or TextureScroll consumer yet. This is exact token evidence, not GPU or native engine execution.'}
    (OUT / 'evidence.json').write_text(json.dumps(evidence, indent=2)+'\n')
    print(json.dumps(evidence, indent=2))


if __name__ == '__main__':
    main()
