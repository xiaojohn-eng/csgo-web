"""What the client does with a paint kit's four colours - the half that was still missing.

The port's four-colour palettes come from `items_game.txt`, and 65 of the 212 finishes draw from
them. The other 147 were held back partly on a recorded assumption: that the original packs four
colours into the shader's three palette constants by some rule that had to be measured. Two client
functions say what actually happens, and neither of them packs anything:

  * **`0xf52b90` fills the object's palette** out of the kit record: four colours at
    `kit + 0xbc, 0xc0, 0xc4, 0xc8`, three bytes each (r, g, b) and a fourth the code never reads.
    Each byte is widened to a float (`cvtsi2ss`, so 0..255) and stored at
    `this + 0x9c4 + 12i + {0,4,8}`. The same function copies the record's other fields, which is
    where the kit's remaining inputs live.
  * **`0xf52040` uploads them**: each of the four `$camocolor0..3` variables is set to the
    `"[%f %f %f]"` rendering of one triple **multiplied by the global at `0x1936e9c`**, whose four
    bytes are exactly the float32 nearest `1/255`. So the material sees the kit's own bytes,
    normalised, three per colour.

What this settles is the shape of the data: four colours stay four, in the kit's own order, and no
packing happens on the client at all. What it does **not** settle is how the engine binds those four
material variables to a shader's three constants - that is still unread, and the port still refuses
the finishes whose program needs it. `boundary` says so.

Run: PYTHONPATH=.tools/source-binary-venv/lib/python3.9/site-packages python3\
 scripts/probe-source-camo-palette.py
"""
from __future__ import annotations
import hashlib
import importlib.util
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INSTALL = ROOT / '.reference-assets/csgo-legacy'
CLIENT64 = INSTALL / 'csgo/bin/linux64/client_client.so'
OUT = ROOT / 'research/source-camo-palette.json'
sha = lambda data: hashlib.sha256(data).hexdigest()  # noqa: E731


def load(name, path):
    """Import a sibling script by path, so the shared binary reader has one home."""
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def main():
    binary_index = load('source_binary_index', 'scripts/source-binary-index.py')
    client = binary_index.open_binary(CLIENT64)

    # --- the filler: this + 0x9c4 gets four RGB triples out of the kit record's bytes.
    FILLER = 0xf52b90
    assert client.function_of(FILLER) == (FILLER, 0x73F), client.function_of(FILLER)
    assert client.callers(FILLER) == [0xf533c8], client.callers(FILLER)
    binary_index.assert_bytes(client, {
        0xf52c0f: ('e81cd274ff', 'call 0x69fe30  (memset of the block that holds the palette)'),
        0xf52c14: ('448b6318', 'mov r12d, [rbx + 0x18]  (the kit index)'),
        0xf52c18: ('c783000a00000000803f', 'mov dword [rbx + 0xa00], 0x3f800000  (1.0f)'),
        0xf52c22: ('e829a6d9ff', 'call the schema getter'),
        0xf52c2d: ('e88e3fdcff', 'call 0xd16bc0  (find the kit record by that index)'),
        # The twelve widenings, in the order the object stores them.
        0xf52c50: ('410fb68424be000000', 'movzx eax, byte [r12 + 0xbe]  (c0.b)'),
        0xf52c73: ('f30f1183cc090000', 'movss [rbx + 0x9cc], xmm0'),
        0xf52c83: ('f30f118bc8090000', 'movss [rbx + 0x9c8], xmm1'),
        0xf52c8f: ('f30f1193c4090000', 'movss [rbx + 0x9c4], xmm2'),
        0xf52c9b: ('410fb68424c2000000', 'movzx eax, byte [r12 + 0xc2]  (c1.b)'),
        0xf52cbe: ('f30f1183d8090000', 'movss [rbx + 0x9d8], xmm0'),
        0xf52cf3: ('410fb68424c5000000', 'movzx eax, byte [r12 + 0xc5]  (c2.g)'),
        0xf52d09: ('f30f1183e4090000', 'movss [rbx + 0x9e4], xmm0'),
        0xf52d25: ('f30f1193dc090000', 'movss [rbx + 0x9dc], xmm2'),
        0xf52d54: ('f30f1183f0090000', 'movss [rbx + 0x9f0], xmm0  (c3.b)'),
        0xf52d6d: ('f30f1193e8090000', 'movss [rbx + 0x9e8], xmm2  (c3.r)'),
    })
    # The four colours sit four bytes apart in the record - three colour bytes and one the code never
    # reads - and land twelve bytes apart in the object, three floats each. So the record holds
    # {r, g, b, pad} per colour and the object holds (r, g, b) floats per colour: nothing is repacked.
    widenings = {ins.address: ins.op_str for ins in client.instructions(FILLER, 0x73F)
                 if ins.mnemonic == 'movzx' and '[r12 +' in ins.op_str}
    palette_bytes = [0xBC + 4 * colour + channel for colour in range(4) for channel in range(3)]
    read_bytes = sorted(int(part.split('+')[1].rstrip(']').strip(), 16)
                        for part in widenings.values())
    assert read_bytes == palette_bytes + [0xE9, 0xEA, 0xEB, 0x118], [hex(x) for x in read_bytes]
    palette = [{'firstByte': hex(0xBC + 4 * colour),
                'channels': [hex(0xBC + 4 * colour + channel) for channel in range(3)],
                'strideInRecord': 4,
                'to': [hex(0x9C4 + 12 * colour + 4 * channel) for channel in range(3)]}
               for colour in range(4)]

    # --- the uploader: the four variables, and the scale that normalises the bytes.
    UPLOADER = 0xf52040
    assert client.function_of(UPLOADER) == (UPLOADER, 0x6C5), client.function_of(UPLOADER)
    assert client.callers(UPLOADER) == [], 'the uploader is virtual, so it must have no direct caller'
    names = {}
    for index in range(4):
        site = 0xf52120 + index * 0x60
        names[client.string_at(client.lea_target(site))] = hex(site)
    assert names == {'$camocolor0': '0xf52120', '$camocolor1': '0xf52180',
                     '$camocolor2': '0xf521e0', '$camocolor3': '0xf52240'}, names
    binary_index.assert_bytes(client, {
        0xf520cf: ('f30f102dc54d9e00', 'movss xmm5, [rip + 0x9e4dc5]  (the scale)'),
        0xf520f4: ('f30f116d8c', 'movss [rbp - 0x74], xmm5  (spilled, then reloaded per colour)'),
        0xf52101: ('f30f5983c4090000', 'mulss xmm0, [rbx + 0x9c4]  (c0.r times the scale)'),
        0xf52115: ('e8f6604000', 'call 0x1358210  (the "[%f %f %f]" formatting)'),
    })
    scale_at = client.rip_target(0xf520cf)
    scale = struct.unpack('<f', client.bytes_at(scale_at, 4))[0]
    # The four bytes are exactly the float32 nearest 1/255, compared as bytes rather than as a
    # decimal, because that is what the multiply actually uses.
    assert client.bytes_at(scale_at, 4) == struct.pack('<f', 1 / 255), client.bytes_at(scale_at, 4).hex()
    assert scale == struct.unpack('<f', struct.pack('<f', 1 / 255))[0]
    formats = {client.string_at(client.lea_target(site))
               for site in (0xf520DF, 0xf52141, 0xf521A1, 0xf52201)}
    assert formats == {'[%f %f %f]'}, formats

    # --- the same function is the finish's material block generator, and it says which textures each
    # style sets. The four palette variables are emitted for **every** style: the two style-specific
    # branches jump back into the block that writes them, so the dispatch only decides which textures
    # are added. Every pair below is (material variable, where its value comes from), read as the
    # `lea rdx, ...` that precedes the key's `SetString`.
    def block(start, end):
        """The (variable, value source) pairs a range emits, in order.

        The value is whatever the `lea rdx, ...` before the key's `SetString` loaded. A `lea` of a
        literal resolves to the text itself, because that is what the material ends up carrying; a
        `lea` of a stack buffer stays the operand, because the text is built into it at run time.
        """
        pairs, value = [], None
        for ins in client.instructions(start, end - start):
            if ins.mnemonic == 'lea' and ins.op_str.startswith('rdx'):
                source = ins.op_str.split(', ', 1)[1]
                if '[rip' in source:
                    literal = client.string_at(client.lea_target(ins.address))
                    value = literal if literal is not None else source
                else:
                    value = source
            elif ins.mnemonic == 'lea' and ins.op_str.startswith('rsi, [rip'):
                key = client.string_at(client.lea_target(ins.address))
                if key:
                    pairs.append((key, value))
        return pairs

    shared = block(0xF52040, 0xF520AE)
    palette_block = block(0xF520C1, 0xF52540)
    style0 = block(0xF52540, 0xF52660)
    style1 = block(0xF52660, 0xF52705)
    assert [key for key, _ in shared] == ['$aotexture', '$weartexture'], shared
    assert shared[0][1] == '[rbx + 0x4a8]' and shared[1][1] == '[rbx + 0xb3c]', shared
    assert [key for key, _ in palette_block] == [
        '$camocolor0', '$camocolor1', '$camocolor2', '$camocolor3', '$wearprogress', '$paintstyle',
        '$patterntexturetransform', '$weartexturetransform', '$grungetexturetransform',
        '$phongalbedofactor', '$phongintensity', '$phongexponent'], [k for k, _ in palette_block]
    # The two style branches, and the style-0 one's own switch on the kit's style field.
    assert [key for key, _ in style0][:4] == ['$exponentmode', '$baseTexture', '$maskstexture',
                                             '$grungetexture'], style0
    assert dict(style0)['$baseTexture'] == '[rbx + 0x98]'
    assert dict(style0)['$maskstexture'] == '[rbx + 0x2a0]'
    assert dict(style0)['$grungetexture'] == '[rbx + 0xa38]'
    assert dict(style0)['$exptexture'] == '[rbx + 0x19c]'
    assert dict(style0)['$painttexture'] == '[rbx + 0x6b0]'
    assert dict(style0)['$postexture'] == '[rbx + 0x3a4]'
    assert dict(style0)['$surfacetexture'] == '[rbx + 0x5ac]'
    assert [key for key, _ in style1][:2] == ['$exponentmode', '$exptexture'], style1
    assert dict(style1)['$exptexture'] == '[rbx + 0x19c]'
    assert dict(style1)['$painttexture'] == '[rbx + 0x6b0]'
    assert dict(style1)['$maskstexture'] == '[rbx + 0x2a0]'
    binary_index.assert_bytes(client, {
        0xf520ae: ('4183fc01', 'cmp r12d, 1  (style 1 has its own block)'),
        0xf520b8: ('4585e4', 'test r12d, r12d  (style 0 has its own block)'),
        # The style-0 block switches on the kit's style field, which 0xf52b90 copied from kit + 0xb8.
        0xf52598: ('8b83bc090000', 'mov eax, [rbx + 0x9bc]  (the kit\'s style)'),
        0xf525b3: ('83f806', 'cmp eax, 6  (the switch tests 3 and 6 specially)'),
        # The style-1 block tests the style against a bitmask instead: 0x2a4 selects 2, 5, 7 and 9.
        0xf52692: ('83f809', 'cmp eax, 9'),
        0xf5269c: ('480fa3c2', 'bt rdx, rax  (rdx = 0x2a4)'),
        # And both style blocks end by jumping into the palette block, which is why every style gets it.
        0xf525e2: ('e9dafaffff', 'jmp 0xf520c1  (the palette block)'),
    })

    # --- the same filler function also builds every texture path the material block later names, and
    # the paths are what the port needs to stage the two textures it is missing. Each is formatted
    # into its own field; the source of both `%s` is one buffer, its two strings 0x100 apart.
    TEXTURE_FORMATS = {
        0x98: 'models/weapons/v_models/%s/%s.vtf',
        0x19C: 'models/weapons/v_models/%s/%s_exponent.vtf',
        0x3A4: 'models/weapons/customization/%s/%s_pos.vtf',
        0x4A8: 'models/weapons/customization/%s/%s_ao.vtf',
        0x5AC: 'models/weapons/customization/%s/%s_surface.vtf',
        0x2A0: 'models/weapons/customization/%s/%s_masks.vtf',
        0xA38: 'models/weapons/customization/shared/gun_grunge.vtf',
        0xB3C: 'models/weapons/customization/shared/paint_wear.vtf',
    }
    FORMAT_SITES = {0x98: 0xf5301A, 0x19C: 0xf53038, 0x3A4: 0xf5305F, 0x4A8: 0xf5307F,
                    0x5AC: 0xf5309F, 0x2A0: 0xF530BF, 0xA38: 0xF530D9, 0xB3C: 0xF530F3}
    formats = {}
    for field, site in FORMAT_SITES.items():
        text = client.string_at(client.lea_target(site))
        assert text == TEXTURE_FORMATS[field], (hex(field), text)
        formats[field] = text
    binary_index.assert_bytes(client, {
        0xf52f9e: ('4c8bab88000000', 'mov r13, [rbx + 0x88]  (the buffer the two %s come from)'),
        0xf52fa9: ('4d8da500010000', 'lea r12, [r13 + 0x100]  (its second string follows the first)'),
        0xf5302b: ('488dbb9c010000', 'lea rdi, [rbx + 0x19c]  (each path is built into its own field)'),
        0xf530c6: ('e845514000', 'call 0x1358210  (the formatting)'),
        # The object is a `CustomWeapon`, sized 0xc50, and the constructor keeps that buffer.
        0xcd65b7: ('bf500c0000', 'mov edi, 0xc50  (the object\'s size)'),
        0xcd6653: ('488d0d4c7bc900', 'lea rcx, [rip + 0xc97b4c]  ("CustomWeapon")'),
        0xcd665a: ('e871cc2700', 'call 0xf532d0  (its constructor)'),
        0xf53325: ('4c89bb88000000', 'mov [rbx + 0x88], r15  (which keeps the buffer)'),
    })
    assert client.string_at(client.lea_target(0xcd6653)) == 'CustomWeapon'
    # Six of the eight are per weapon and the other two are shared. The port already stages five of
    # these exact paths (its `ao`, `paintWear`, `weaponExponent`, `weaponAlbedo` and `gunGrunge`
    # roles), which is what identifies the two `%s` as the weapon's model folder; what it does not
    # have is the mask and the object-space position, and both files ship for every weapon.
    missing_roles = {'mask': formats[0x2A0], 'osPos': formats[0x3A4]}
    assert set(missing_roles.values()) == {'models/weapons/customization/%s/%s_masks.vtf',
                                           'models/weapons/customization/%s/%s_pos.vtf'}

    shipped = sorted((path for path in (INSTALL / 'csgo/bin').rglob('*')
                      if path.suffix in ('.so', '.dll')), key=lambda path: str(path))
    carried = {path.relative_to(INSTALL / 'csgo/bin').as_posix(): path.read_bytes()
               for path in shipped}
    carriers = {name: sorted(key for key, data in carried.items() if needle in data)
                for name, needle in (('$camocolor0', b'$camocolor0\x00'),
                                     ('$camocolor3', b'$camocolor3\x00'),
                                     ('CCamoMaterialProxy', b'CCamoMaterialProxy\x00'),
                                     ('CCamoTextureRegen', b'CCamoTextureRegen\x00'))}
    assert carriers['$camocolor0'] and carriers['$camocolor3'], carriers
    assert not any(name.startswith('server') or name.startswith('linux64/server')
                   for name in carriers['$camocolor0']), carriers['$camocolor0']

    report = {
        'format': 'source-camo-palette-v1',
        'sources': {'client64Sha256': sha(CLIENT64.read_bytes()),
                    'binariesSearched': len(shipped)},
        'filler': {'at': hex(FILLER), 'length': 0x73F, 'callers': [hex(x) for x in client.callers(FILLER)],
                   'kitIndexField': 'this + 0x18',
                   'recordLookup': ('A map lookup in the client\'s item schema: the getter returns a '
                                    'table whose entries are 0x20 bytes with the key at +0x10 and the '
                                    'object at +0x18 (0xd16bc0).'),
                   'blockCleared': {'at': 'this + 0x98', 'bytes': 0xBAC},
                   'scaleOut': {'at': 'this + 0xa00', 'value': 1.0},
                   'reading': ('The kit record\'s twelve bytes at +0xbc..+0xca are four RGB triples; '
                               'each byte is widened to a float and stored at this + 0x9c4 + 12i + '
                               '{0,4,8}, so the object holds four (r, g, b) triples in the record\'s '
                               'own order and nothing is repacked.')},
        'palette': palette,
        'recordFieldsCopied': ['+0xb8 -> this + 0x9bc', '+0xe9 -> this + 0x9f8',
                               '+0xea - 1 -> this + 0x9f4', '+0xeb -> this + 0x9fc',
                               '+0xec -> this + 0xa08', '+0x118 -> this + 0xc4c'],
        'uploader': {'at': hex(UPLOADER), 'length': 0x6C5,
                     'variables': names,
                     'format': '[%f %f %f]',
                     'scaleAt': hex(scale_at), 'scale': scale,
                     'scaleReading': ('The four bytes at 0x1936e9c are exactly the float32 nearest '
                                      '1/255, so a byte 0..255 becomes 0..1 before it is formatted.'),
                     'reading': ('Each of the four variables is set to the "[%f %f %f]" rendering of '
                                 'one triple times that scale. The four colours are uploaded as four '
                                 'colours: no packing happens here.')},
        'materialBlock': {
            'generator': hex(UPLOADER),
            'shapes': ('The generator builds one KeyValues for a finish. Two variables are set before '
                       'the style dispatch, so every style gets them; then style 0 and style 1 have '
                       'blocks of their own, and the block that writes the four palette variables is '
                       'shared - both style blocks jump back into it - so **every** style ends up with '
                       'the colours.'),
            'everyStyle': [{'variable': key, 'from': value} for key, value in shared],
            'paletteBlock': [{'variable': key, 'from': value} for key, value in palette_block],
            'style0': [{'variable': key, 'from': value} for key, value in style0],
            'style1': [{'variable': key, 'from': value} for key, value in style1],
            'styleSwitch': ('The style-0 block switches on the kit\'s own style field at this + 0x9bc '
                            '(copied from kit + 0xb8) and adds textures accordingly; the style-1 '
                            'block tests the same field against the bitmask 0x2a4, which selects '
                            'styles 2, 5, 7 and 9.'),
            'reading': ('So which textures a finish needs is not a guess: the generator names each '
                        'material variable and the field its value comes from, per style. The names '
                        'are the material variables (`$maskstexture`, `$exptexture`, '
                        '`$painttexture`, `$postexture`, `$surfacetexture`, `$grungetexture`, '
                        '`$baseTexture`, `$aotexture`, `$weartexture`), and every style sets '
                        '`$aotexture`, `$weartexture`, `$maskstexture` and the four colours. What is '
                        'not read is how those variables reach the shader program\'s samplers and '
                        'constants.')},
        'textureFormats': {
            'at': [hex(site) for site in FORMAT_SITES.values()],
            'formats': {hex(field): text for field, text in formats.items()},
            'argumentsFrom': ('this + 0x88, one buffer holding two strings 0x100 apart, kept by the '
                              'CustomWeapon constructor from its third argument'),
            'class': {'name': 'CustomWeapon', 'size': 0xC50},
            'reading': ('Each path is formatted into its own field, and six of the eight take the two '
                        '`%s` from that buffer while the other two are shared constants. The pak ships '
                        '`models/weapons/customization/<folder>/<folder>_ao.vtf` and the port already '
                        'stages exactly that path for its `ao` role, which identifies both `%s` as the '
                        'weapon\'s model folder. The two paths the port does not stage are the mask and '
                        'the object-space position, and both ship for every weapon - so what the '
                        'withheld finishes are missing is these two files, not an unread rule.')},
        'carriers': carriers,
        'boundary': ('What is read is where a kit\'s four colours come from and what form they are '
                     'uploaded in - four colours at kit + 0xbc, 0xc0, 0xc4 and 0xc8, three bytes each '
                     'and four bytes apart, widened, scaled by exactly 1/255 and written as four '
                     '"[%f %f %f]" strings. What is **not** read is '
                     'the bridge from those four material variables to a shader\'s three palette '
                     'constants: no shipped binary pairs `$camocolor*` with them by name, and the '
                     'constants\' CTAB entries carry no default, so which colour reaches which '
                     'constant is still unknown. The port therefore keeps refusing the finishes whose '
                     'program needs that mapping, and the earlier framing - that a "four colours into '
                     'three constants" packing rule had to be measured - is withdrawn: on the client '
                     'side there is no such rule. The kit record\'s other fields that the filler copies '
                     '(+0xb8, +0xe9, +0xea, +0xeb, +0xec, +0x118) are recorded but not identified.'),
    }
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n')
    print(json.dumps({'format': report['format'], 'scale': scale,
                      'scaleBytes': client.bytes_at(scale_at, 4).hex(),
                      'variables': list(names), 'binariesSearched': len(shipped),
                      'carrierCount': {k: len(v) for k, v in carriers.items()}},
                     ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
