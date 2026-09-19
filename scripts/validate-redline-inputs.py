"""Independent stdlib PNG readback; compares decoded pixels to the native VTF receipt.

This verifies lossless PNG storage, not the native VTF decompression algorithm or a skin.
Run: python3 scripts/validate-redline-inputs.py
"""
from pathlib import Path
import hashlib, json, struct, zlib

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.reference-assets/source-exports/ak47-redline-inputs'

def sha(data):
    return hashlib.sha256(data).hexdigest()

def rgba8_png(data):
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    offset, parts, header, ended = 8, [], None, False
    while offset < len(data):
        size = struct.unpack_from('>I', data, offset)[0]
        tag = data[offset + 4:offset + 8]
        payload = data[offset + 8:offset + 8 + size]
        assert zlib.crc32(tag + payload) == struct.unpack_from('>I', data, offset + 8 + size)[0]
        offset += size + 12
        if tag == b'IHDR':
            header = struct.unpack('>IIBBBBB', payload)
        elif tag == b'IDAT':
            parts.append(payload)
        elif tag == b'IEND':
            ended = True
            break
        elif tag[0] < 97:
            raise ValueError(f'Unsupported critical PNG chunk {tag!r}')
    assert ended and offset == len(data) and header
    width, height, depth, color, compression, filtering, interlace = header
    assert (depth, color, compression, filtering, interlace) == (8, 6, 0, 0, 0)
    raw = zlib.decompress(b''.join(parts))
    stride = width * 4
    assert len(raw) == height * (stride + 1)
    result = bytearray()
    previous = bytearray(stride)
    filters = set()
    for y in range(height):
        start = y * (stride + 1)
        kind = raw[start]
        filters.add(kind)
        assert 0 <= kind <= 4
        row = bytearray(raw[start + 1:start + 1 + stride])
        if kind:
            for i in range(stride):
                a, b, c = (row[i - 4] if i >= 4 else 0), previous[i], (previous[i - 4] if i >= 4 else 0)
                if kind == 1: predictor = a
                elif kind == 2: predictor = b
                elif kind == 3: predictor = (a + b) // 2
                else:
                    p = a + b - c
                    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                    predictor = a if pa <= pb and pa <= pc else b if pb <= pc else c
                row[i] = (row[i] + predictor) & 255
        result.extend(row)
        previous = row
    return width, height, bytes(result), sorted(filters)

receipt = json.loads((OUT / 'inputs.json').read_text())
assert receipt['status'] == 'inputs_extracted_no_composite'
checks = []
for texture in receipt['textures']:
    original = (OUT / 'raw' / texture['path']).read_bytes()
    png = (ROOT / texture['png']).read_bytes()
    assert sha(original) == texture['sha256']
    assert sha(png) == texture['pngSha256']
    width, height, pixels, filters = rgba8_png(png)
    assert (width, height) == (texture['width'], texture['height'])
    assert sha(pixels) == texture['rgba8Sha256']
    checks.append({'path': texture['path'], 'pixels': width * height, 'filters': filters, 'rgba8Sha256': sha(pixels)})
report = {'status': 'passed', 'textures': len(checks), 'pixels': sum(c['pixels'] for c in checks),
          'inputReceiptSha256': sha((OUT / 'inputs.json').read_bytes()),
          'scriptSha256': sha(Path(__file__).read_bytes()), 'checks': checks,
          'boundary': 'PNG CRC/filter reconstruction independent from SourceIO; comparison is to native decoded VTF pixels. No composite skin verified.'}
(OUT / 'png-readback.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({k: v for k, v in report.items() if k != 'checks'}))
