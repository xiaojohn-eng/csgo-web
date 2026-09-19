#!/usr/bin/env python3
"""Decode project-local VFONT1 files and validate SFNT tables without installing fonts.

VFONT1 decoding follows ValveResourceFormat/ValveFont at commit
f0ae3cb53765a07514689d0f76f5f0b277489b22. MIT notice is preserved in
docs/licenses/ValveResourceFormat-MIT.txt. Input font licenses are separate.
"""
import hashlib
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[1]


def decode(data):
    if len(data) < 8 or data[-6:] != b'VFONT1':
        raise ValueError('Expected VFONT1 trailer')
    salt_length = data[-7]
    end = len(data) - 6 - salt_length
    if salt_length < 1 or end < 12:
        raise ValueError('Invalid VFONT1 salt size')
    key = 167
    for byte in data[end:-7]:
        key ^= (byte + 167) & 255
    output = bytearray(end)
    for index, byte in enumerate(data[:end]):
        output[index] = byte ^ key
        key = (byte + 167) & 255
    return bytes(output)


def checksum(data):
    padded = data + b'\0' * (-len(data) % 4)
    return sum(struct.unpack('>' + 'I' * (len(padded) // 4), padded)) & 0xffffffff


def inspect_font(data):
    if data[:4] not in (b'\0\1\0\0', b'OTTO'):
        raise ValueError('Decoded file is not an SFNT TrueType/OpenType font')
    table_count = struct.unpack_from('>H', data, 4)[0]
    if not table_count or 12 + table_count * 16 > len(data):
        raise ValueError('Invalid SFNT table directory')
    tables = {}
    for i in range(table_count):
        raw_tag, expected, offset, size = struct.unpack_from('>4sIII', data, 12 + i * 16)
        tag = raw_tag.decode('ascii')
        if offset + size > len(data) or tag in tables:
            raise ValueError('Invalid SFNT table bounds or duplicate: ' + tag)
        table = data[offset:offset + size]
        if tag == 'head':
            table = table[:8] + b'\0' * 4 + table[12:]
        if checksum(table) != expected:
            raise ValueError('SFNT table checksum mismatch: ' + tag)
        tables[tag] = (offset, size)
    if checksum(data) != 0xb1b0afba:
        raise ValueError('SFNT whole-font checksum mismatch')
    if not {'head', 'name', 'cmap', 'maxp'} <= tables.keys():
        raise ValueError('Required SFNT table missing')
    names = []
    offset, size = tables['name']
    table = data[offset:offset + size]
    _, count, string_offset = struct.unpack_from('>HHH', table)
    for i in range(count):
        platform, encoding, language, name_id, length, start = struct.unpack_from('>HHHHHH', table, 6 + i * 12)
        if name_id not in (0, 1, 2, 4, 6, 13, 14):
            continue
        if string_offset + start + length > len(table):
            raise ValueError('SFNT name bounds mismatch')
        value = table[string_offset + start:string_offset + start + length]
        text = value.decode('utf-16-be' if platform in (0, 3) else 'mac_roman')
        row = {'id': name_id, 'platform': platform, 'encoding': encoding, 'language': language, 'value': text}
        if row not in names:
            names.append(row)
    maxp = tables['maxp'][0]
    return {'format': 'OpenType CFF' if data[:4] == b'OTTO' else 'TrueType',
            'tables': sorted(tables), 'glyphs': struct.unpack_from('>H', data, maxp + 4)[0],
            'names': names, 'tableChecksums': True, 'wholeFontChecksum': 'b1b0afba'}


def convert(path, directory):
    source = path.read_bytes()
    decoded = decode(source)
    report = inspect_font(decoded)
    directory.mkdir(parents=True, exist_ok=True)
    output = directory / (path.stem + ('.otf' if decoded[:4] == b'OTTO' else '.ttf'))
    output.write_bytes(decoded)
    if output.read_bytes() != decoded:
        raise IOError('Font output readback differs')
    return {**report, 'source': str(path.relative_to(ROOT)), 'output': str(output.relative_to(ROOT)),
            'sourceSha256': hashlib.sha256(source).hexdigest(),
            'outputSha256': hashlib.sha256(decoded).hexdigest(), 'bytes': len(decoded)}


if __name__ == '__main__':
    source = ROOT / '.reference-assets/csgo-legacy/csgo/panorama/fonts'
    target = ROOT / '.reference-assets/source-ui/fonts'
    fonts = ['stratum2regular', 'stratum2medium', 'stratum2bold', 'stratum2bold_monodigit', 'notosanssc-regular']
    reports = [convert(source / (name + '.vfont'), target) for name in fonts]
    (ROOT / 'research/source-fonts.json').write_text(json.dumps(reports, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps([{'output': r['output'], 'bytes': r['bytes'], 'glyphs': r['glyphs']} for r in reports], ensure_ascii=False))
